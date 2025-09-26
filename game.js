const Game = (function () {
    let { init, initKeys, keyPressed, Sprite, GameLoop } = kontra;
    
    // Initialize two separate canvases
    let localCanvas = document.getElementById('localCanvas');
    let opponentCanvas = document.getElementById('opponentCanvas');
    
    let { context: localContext } = init(localCanvas);
    let { context: opponentContext } = init(opponentCanvas);
    
    initKeys();

    // WebSocket connection
    let ws = null;
    let isConnected = false;
    let opponentConnected = false;

    // Game states
    let lives = 3;
    let gameState = "waiting"; // waiting, playing, win, gameover
    let opponentLives = 3;
    let opponentGameState = "waiting";

    // Connect to WebSocket server
    function connectToServer() {
        try {
            ws = new WebSocket('ws://localhost:8080/ws');
            
            ws.onopen = function() {
                console.log('Connected to server');
                isConnected = true;
                gameState = "waiting";
            };
            
            ws.onmessage = function(event) {
                try {
                    const data = JSON.parse(event.data);
                    handleServerMessage(data);
                } catch (e) {
                    console.error('Error parsing message:', e);
                }
            };
            
            ws.onclose = function() {
                console.log('Disconnected from server');
                isConnected = false;
                opponentConnected = false;
            };
            
            ws.onerror = function(error) {
                console.error('WebSocket error:', error);
            };
        } catch (error) {
            console.error('Failed to connect to server:', error);
        }
    }

    // Send message to server
    function sendMessage(message) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    }

    // Handle incoming server messages
    function handleServerMessage(data) {
        switch (data.type) {
            case 'opponentConnected':
                opponentConnected = true;
                gameState = "playing";
                opponentGameState = "playing";
                resetGame();
                break;
            case 'opponentDisconnected':
                opponentConnected = false;
                gameState = "waiting";
                break;
            case 'paddleInput':
                handleOpponentInput(data.direction);
                break;
            case 'gameOver':
                opponentGameState = data.state; // "win" or "gameover"
                break;
            case 'brickDestroyed':
                destroyOpponentBrick(data.x, data.y);
                break;
            case 'livesUpdate':
                opponentLives = data.lives;
                updateOpponentLivesDisplay();
                break;
        }
    }

    // Collision helper
    function collides(a, b) {
        return a.x < b.x + b.width &&
            a.x + a.width > b.x &&
            a.y < b.y + b.height &&
            a.y + a.height > b.y;
    }

    // ===== LOCAL GAME (Left Canvas) =====
    
    // Local Player Paddle
    const paddle = Sprite({
        x: 200,
        y: 470,
        width: 100,
        height: 20,
        color: 'blue',
        context: localContext,
        update() {
            if (gameState !== "playing") return;
            
            if ((keyPressed('arrowleft') || keyPressed('a')) && this.x > 0) {
                this.x -= 6;
                sendMessage({ type: 'paddleInput', direction: 'left' });
            }
            if ((keyPressed('arrowright') || keyPressed('d')) && this.x + this.width < localCanvas.width) {
                this.x += 6;
                sendMessage({ type: 'paddleInput', direction: 'right' });
            }
        }
    });

    // Local Ball
    const ball = Sprite({
        x: 250,
        y: 300,
        width: 10,
        height: 10,
        color: 'red',
        context: localContext,
        dx: 3,
        dy: -3,
        update() {
            if (gameState !== "playing") return;

            this.advance();

            // bounce off walls
            if (this.x <= 0 || this.x + this.width >= localCanvas.width) this.dx *= -1;
            if (this.y <= 0) this.dy *= -1;

            // bounce off paddle
            if (collides(this, paddle)) {
                let paddleCenter = paddle.x + paddle.width / 2;
                let ballCenter = this.x + this.width / 2;
                let hitPos = (ballCenter - paddleCenter) / (paddle.width / 2);
                let maxBounceAngle = Math.PI / 3; // 60 degrees
                let bounceAngle = hitPos * maxBounceAngle;
                let speed = Math.sqrt(this.dx * this.dx + this.dy * this.dy);
                this.dx = speed * Math.sin(bounceAngle);
                this.dy = -Math.abs(speed * Math.cos(bounceAngle));
                this.y = paddle.y - this.height - 1;
            }
        }
    });

    // Local Bricks
    let bricks = [];
    
    const brickTypes = [
        { color: 'green', hits: 1 },
        { color: 'yellow', hits: 2 },
        { color: 'orange', hits: 3 }
    ];

    function createLocalBricks() {
        bricks.length = 0;
        
        for (let row = 0; row < 5; row++) {
            for (let col = 0; col < 8; col++) {
                let type;
                if (row === 0) type = 2;
                else if (row < 3) type = 1;
                else type = 0;
                
                bricks.push(Sprite({
                    x: col * 60 + 20,
                    y: row * 25 + 30,
                    width: 50,
                    height: 15,
                    color: brickTypes[type].color,
                    context: localContext,
                    hits: brickTypes[type].hits
                }));
            }
        }
    }

    // Local Lives Display
    let livesDisplay = [];

    function updateLivesDisplay() {
        livesDisplay = [];
        for (let i = 0; i < lives; i++) {
            livesDisplay.push(Sprite({
                x: 10 + i * 20,
                y: 220,
                width: 15,
                height: 15,
                color: 'red',
                context: localContext,
                render() {
                    this.context.fillStyle = this.color;
                    this.context.beginPath();
                    this.context.arc(this.x + this.width / 2, this.y + this.height / 2, this.width / 2, 0, Math.PI * 2);
                    this.context.fill();
                }
            }));
        }
    }

    // ===== OPPONENT GAME (Right Canvas) =====
    
    // Opponent Paddle
    const opponentPaddle = Sprite({
        x: 200,
        y: 470,
        width: 100,
        height: 20,
        color: 'lightblue',
        context: opponentContext,
        update() {
            // Opponent paddle is updated by input messages
        }
    });

    // Handle opponent paddle input
    function handleOpponentInput(direction) {
        if (opponentGameState !== "playing") return;
        
        if (direction === 'left' && opponentPaddle.x > 0) {
            opponentPaddle.x -= 6;
        }
        if (direction === 'right' && opponentPaddle.x + opponentPaddle.width < opponentCanvas.width) {
            opponentPaddle.x += 6;
        }
    }

    // Opponent Ball
    const opponentBall = Sprite({
        x: 250,
        y: 300,
        width: 10,
        height: 10,
        color: 'pink',
        context: opponentContext,
        dx: 3,
        dy: -3,
        update() {
            if (opponentGameState !== "playing") return;

            this.advance();

            // bounce off walls
            if (this.x <= 0 || this.x + this.width >= opponentCanvas.width) this.dx *= -1;
            if (this.y <= 0) this.dy *= -1;

            // bounce off opponent paddle
            if (collides(this, opponentPaddle)) {
                let paddleCenter = opponentPaddle.x + opponentPaddle.width / 2;
                let ballCenter = this.x + this.width / 2;
                let hitPos = (ballCenter - paddleCenter) / (opponentPaddle.width / 2);
                let maxBounceAngle = Math.PI / 3;
                let bounceAngle = hitPos * maxBounceAngle;
                let speed = Math.sqrt(this.dx * this.dx + this.dy * this.dy);
                this.dx = speed * Math.sin(bounceAngle);
                this.dy = -Math.abs(speed * Math.cos(bounceAngle));
                this.y = opponentPaddle.y - this.height - 1;
            }
        }
    });

    // Opponent Bricks
    let opponentBricks = [];

    function createOpponentBricks() {
        opponentBricks.length = 0;
        
        for (let row = 0; row < 5; row++) {
            for (let col = 0; col < 8; col++) {
                let type;
                if (row === 0) type = 2;
                else if (row < 3) type = 1;
                else type = 0;
                
                opponentBricks.push(Sprite({
                    x: col * 60 + 20,
                    y: row * 25 + 30,
                    width: 50,
                    height: 15,
                    color: brickTypes[type].color,
                    context: opponentContext,
                    hits: brickTypes[type].hits
                }));
            }
        }
    }

    // Destroy opponent brick based on position
    function destroyOpponentBrick(x, y) {
        const index = opponentBricks.findIndex(brick => 
            Math.abs(brick.x - x) < 5 && Math.abs(brick.y - y) < 5
        );
        if (index !== -1) {
            opponentBricks[index].hits -= 1;
            if (opponentBricks[index].hits <= 0) {
                opponentBricks.splice(index, 1);
            } else {
                if (opponentBricks[index].hits === 2) opponentBricks[index].color = 'yellow';
                if (opponentBricks[index].hits === 1) opponentBricks[index].color = 'green';
            }
        }
    }

    // Opponent Lives Display
    let opponentLivesDisplay = [];

    function updateOpponentLivesDisplay() {
        opponentLivesDisplay = [];
        for (let i = 0; i < opponentLives; i++) {
            opponentLivesDisplay.push(Sprite({
                x: 10 + i * 20,
                y: 220,
                width: 15,
                height: 15,
                color: 'pink',
                context: opponentContext,
                render() {
                    this.context.fillStyle = this.color;
                    this.context.beginPath();
                    this.context.arc(this.x + this.width / 2, this.y + this.height / 2, this.width / 2, 0, Math.PI * 2);
                    this.context.fill();
                }
            }));
        }
    }

    // ===== GAME MANAGEMENT =====

    function resetGame() {
        lives = 3;
        opponentLives = 3;
        gameState = "playing";
        opponentGameState = "playing";
        
        // Reset ball positions
        ball.x = 250;
        ball.y = 300;
        ball.dx = 3;
        ball.dy = -3;
        
        opponentBall.x = 250;
        opponentBall.y = 300;
        opponentBall.dx = 3;
        opponentBall.dy = -3;
        
        // Reset paddle positions
        paddle.x = 200;
        opponentPaddle.x = 200;
        
        // Recreate bricks
        createLocalBricks();
        createOpponentBricks();
        
        updateLivesDisplay();
        updateOpponentLivesDisplay();
    }

    // Initialize
    createLocalBricks();
    createOpponentBricks();
    updateLivesDisplay();
    updateOpponentLivesDisplay();
    connectToServer();

    // Game Loop for Local Game
    const localLoop = GameLoop({
        update() {
            if (gameState === "playing") {
                paddle.update();
                ball.update();

                // Local bricks collision
                bricks.forEach((brick, i) => {
                    if (collides(ball, brick)) {
                        ball.dy *= -1;
                        brick.hits -= 1;
                        
                        // Send brick destruction to opponent
                        sendMessage({
                            type: 'brickDestroyed',
                            x: brick.x,
                            y: brick.y
                        });
                        
                        if (brick.hits <= 0) {
                            bricks.splice(i, 1);
                        } else {
                            if (brick.hits === 2) brick.color = 'yellow';
                            if (brick.hits === 1) brick.color = 'green';
                        }
                    }
                });

                // Win condition
                if (bricks.length === 0) {
                    gameState = "win";
                    sendMessage({ type: 'gameOver', state: 'win' });
                }

                // Ball falls below paddle
                if (ball.y > localCanvas.height) {
                    ball.x = 250;
                    ball.y = 300;
                    ball.dx = 3;
                    ball.dy = -3;

                    lives -= 1;
                    updateLivesDisplay();
                    sendMessage({ type: 'livesUpdate', lives: lives });

                    if (lives <= 0) {
                        gameState = "gameover";
                        sendMessage({ type: 'gameOver', state: 'gameover' });
                    }
                }
            }
        },
        render() {
            // Clear local canvas
            localContext.clearRect(0, 0, localCanvas.width, localCanvas.height);

            // Render local game
            paddle.render();
            ball.render();
            bricks.forEach(brick => brick.render());
            livesDisplay.forEach(life => life.render());

            // Game state messages for local player
            if (!isConnected) {
                localContext.fillStyle = "white";
                localContext.font = "20px Arial";
                localContext.fillText("Connecting...", localCanvas.width / 2 - 60, localCanvas.height / 2);
            } else if (!opponentConnected) {
                localContext.fillStyle = "white";
                localContext.font = "20px Arial";
                localContext.fillText("Waiting for opponent...", localCanvas.width / 2 - 100, localCanvas.height / 2);
            } else if (gameState === "gameover") {
                localContext.fillStyle = "white";
                localContext.font = "30px Arial";
                localContext.fillText("You Lost!", localCanvas.width / 2 - 70, localCanvas.height / 2);
            } else if (gameState === "win") {
                localContext.fillStyle = "white";
                localContext.font = "30px Arial";
                localContext.fillText("You Win!", localCanvas.width / 2 - 70, localCanvas.height / 2);
            }

            // Player label
            localContext.fillStyle = "white";
            localContext.font = "16px Arial";
            localContext.fillText("You", 10, 20);
        }
    });

    // Game Loop for Opponent Game
    const opponentLoop = GameLoop({
        update() {
            if (opponentGameState === "playing") {
                opponentBall.update();
                
                // Opponent bricks collision (simulated locally)
                opponentBricks.forEach((brick, i) => {
                    if (collides(opponentBall, brick)) {
                        opponentBall.dy *= -1;
                        brick.hits -= 1;
                        
                        if (brick.hits <= 0) {
                            opponentBricks.splice(i, 1);
                        } else {
                            if (brick.hits === 2) brick.color = 'yellow';
                            if (brick.hits === 1) brick.color = 'green';
                        }
                    }
                });

                // Opponent ball falls below paddle
                if (opponentBall.y > opponentCanvas.height) {
                    opponentBall.x = 250;
                    opponentBall.y = 300;
                    opponentBall.dx = 3;
                    opponentBall.dy = -3;
                }
            }
        },
        render() {
            // Clear opponent canvas
            opponentContext.clearRect(0, 0, opponentCanvas.width, opponentCanvas.height);

            // Render opponent game
            if (opponentConnected) {
                opponentPaddle.render();
                opponentBall.render();
                opponentBricks.forEach(brick => brick.render());
                opponentLivesDisplay.forEach(life => life.render());

                // Opponent state messages
                if (opponentGameState === "gameover") {
                    opponentContext.fillStyle = "white";
                    opponentContext.font = "24px Arial";
                    opponentContext.fillText("Lost", opponentCanvas.width / 2 - 30, opponentCanvas.height / 2);
                } else if (opponentGameState === "win") {
                    opponentContext.fillStyle = "white";
                    opponentContext.font = "24px Arial";
                    opponentContext.fillText("Won!", opponentCanvas.width / 2 - 30, opponentCanvas.height / 2);
                }
            } else {
                opponentContext.fillStyle = "gray";
                opponentContext.font = "20px Arial";
                opponentContext.fillText("No opponent", opponentCanvas.width / 2 - 70, opponentCanvas.height / 2);
            }

            // Opponent label
            opponentContext.fillStyle = "white";
            opponentContext.font = "16px Arial";
            opponentContext.fillText("Opponent", 10, 20);
        }
    });

    localLoop.start();
    opponentLoop.start();

    // Restart button
    document.getElementById('restartBtn').addEventListener('click', () => {
        document.location.reload();
    });

    // Show/hide restart button based on game state
    setInterval(() => {
        const restartBtn = document.getElementById('restartBtn');
        if (gameState === "win" || gameState === "gameover") {
            restartBtn.style.display = "block";
        } else {
            restartBtn.style.display = "none";
        }
    }, 100);

    // Expose only controlled API
    return {
        getLives: () => lives,
        resetGame: resetGame,
        disconnect: () => {
            if (ws) {
                ws.close();
            }
        }
    };
})();