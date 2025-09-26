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

	// Assign player to a room
	room := assignRoom(playerID, conn)
	log.Printf("Player %s joined room", playerID)

	player := room.Players[0]
	if room.Players[1] != nil && room.Players[1].ID == playerID {
		player = room.Players[1]
	}

	go readPump(player, room)
	go writePump(player)
}

// Assigns a player to a room (creates new room if needed)
func assignRoom(playerID string, conn *websocket.Conn) *Room {
	roomsMutex.Lock()
	defer roomsMutex.Unlock()

	// Find room with only 1 player
	for _, room := range rooms {
		room.Mutex.Lock()
		if room.Players[1] == nil {
			room.Players[1] = &Player{
				ID:              playerID,
				Conn:            conn,
				Send:            make(chan []byte, 256),
				BricksRemaining: 40, // example initial count
			}
			room.Mutex.Unlock()
			return room
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
	return room
}

// Reads input from player and forwards to opponent
func readPump(player *Player, room *Room) {
	defer func() {
		player.Conn.Close()
	}()

	for {
		_, message, err := player.Conn.ReadMessage()
		if err != nil {
			log.Println("Read error:", err)
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

		// Optional: handle win / brick count messages
		room.Mutex.Unlock()
	}
}

// Writes messages to player
func writePump(player *Player) {
	for {
		msg, ok := <-player.Send
		if !ok {
			return
		}
		err := player.Conn.WriteMessage(websocket.TextMessage, msg)
		if err != nil {
			log.Println("Write error:", err)
			return
		}
	}
}

func main() {
	http.HandleFunc("/ws", handleWS)
	log.Println("Server started on :8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
