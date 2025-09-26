package main

import (
	"fmt"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

// Player represents a connected player
type Player struct {
	ID              string
	Conn            *websocket.Conn
	Send            chan []byte
	BricksRemaining int
}

// Room represents a two-player game
type Room struct {
	Players [2]*Player
	Mutex   sync.Mutex
}

var (
	upgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}

	rooms      = make(map[string]*Room)
	roomsMutex sync.Mutex
)

// Handle incoming WebSocket connections
func handleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Upgrade error:", err)
		return
	}

	// For simplicity, generate player ID
	playerID := fmt.Sprintf("%p", conn)

	// Assign player to a room and get their index
	room, playerIndex := assignRoom(playerID, conn)
	log.Printf("Player %s joined room as player %d", playerID, playerIndex)

	player := room.Players[playerIndex]

	// Notify both players about room status
	notifyRoomStatus(room)

	go readPump(player, room)
	go writePump(player)
}

// Assigns a player to a room (creates new room if needed)
func assignRoom(playerID string, conn *websocket.Conn) (*Room, int) {
	roomsMutex.Lock()
	defer roomsMutex.Unlock()

	// Find room with only 1 player
	for roomID, room := range rooms {
		room.Mutex.Lock()
		if room.Players[1] == nil {
			room.Players[1] = &Player{
				ID:              playerID,
				Conn:            conn,
				Send:            make(chan []byte, 256),
				BricksRemaining: 40,
			}
			room.Mutex.Unlock()
			log.Printf("Player %s joined existing room %s as player 1", playerID, roomID)
			return room, 1
		}
		room.Mutex.Unlock()
	}

	// No available room, create new
	roomID := fmt.Sprintf("room-%d", len(rooms)+1)
	room := &Room{
		Players: [2]*Player{
			{
				ID:              playerID,
				Conn:            conn,
				Send:            make(chan []byte, 256),
				BricksRemaining: 40,
			},
			nil,
		},
	}

	rooms[roomID] = room
	log.Printf("Player %s created new room %s as player 0", playerID, roomID)
	return room, 0
}

// Notify players about room status
func notifyRoomStatus(room *Room) {
	room.Mutex.Lock()
	defer room.Mutex.Unlock()

	if room.Players[0] != nil && room.Players[1] != nil {
		// Both players connected
		message := []byte(`{"type":"opponentConnected"}`)

		select {
		case room.Players[0].Send <- message:
		default:
			log.Println("Player 0 channel full, dropping room status message")
		}

		select {
		case room.Players[1].Send <- message:
		default:
			log.Println("Player 1 channel full, dropping room status message")
		}

		log.Println("Notified both players that opponent connected")
	}
}

// Reads input from player and forwards to opponent
func readPump(player *Player, room *Room) {
	defer func() {
		player.Conn.Close()
		// Clean up player from room when they disconnect
		cleanupPlayer(player, room)
	}()

	for {
		_, message, err := player.Conn.ReadMessage()
		if err != nil {
			log.Printf("Read error for player %s: %v", player.ID, err)
			break
		}

		// Forward to opponent
		room.Mutex.Lock()
		var opponent *Player
		if room.Players[0] == player {
			opponent = room.Players[1]
		} else {
			opponent = room.Players[0]
		}

		if opponent != nil {
			select {
			case opponent.Send <- message:
			default:
				log.Println("Opponent channel full, dropping message")
			}
		}
		room.Mutex.Unlock()
	}
}

// Clean up player when they disconnect
func cleanupPlayer(player *Player, room *Room) {
	room.Mutex.Lock()
	defer room.Mutex.Unlock()

	// Remove player from room
	if room.Players[0] == player {
		room.Players[0] = nil
	} else if room.Players[1] == player {
		room.Players[1] = nil
	}

	// Notify remaining player if any
	var remainingPlayer *Player
	if room.Players[0] != nil {
		remainingPlayer = room.Players[0]
	} else if room.Players[1] != nil {
		remainingPlayer = room.Players[1]
	}

	if remainingPlayer != nil {
		disconnectMessage := []byte(`{"type":"opponentDisconnected"}`)
		select {
		case remainingPlayer.Send <- disconnectMessage:
		default:
		}
	}

	log.Printf("Player %s disconnected and cleaned up", player.ID)
}

// Writes messages to player
func writePump(player *Player) {
	defer player.Conn.Close()

	for {
		msg, ok := <-player.Send
		if !ok {
			// Channel closed
			return
		}

		err := player.Conn.WriteMessage(websocket.TextMessage, msg)
		if err != nil {
			log.Printf("Write error for player %s: %v", player.ID, err)
			return
		}
	}
}

func main() {
	http.HandleFunc("/ws", handleWS)
	log.Println("Server started on :8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
