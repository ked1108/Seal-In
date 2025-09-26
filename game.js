const Game = (function () {
    let { init, initKeys, keyPressed, Sprite, GameLoop } = kontra;
    let { canvas, context } = init();
    initKeys();

    let lives = 3;
    let gameState = "playing";

    // Collision helper
    function collides(a, b) {
        return a.x < b.x + b.width &&
            a.x + a.width > b.x &&
            a.y < b.y + b.height &&
            a.y + a.height > b.y;
    }

    // Paddle
    const paddle = Sprite({
        x: 200,
        y: 470,
        width: 100,
        height: 20,
        color: 'blue',
        update() {
            if (gameState !== "playing") return;
            if ((keyPressed('arrowleft') || keyPressed('a')) && this.x > 0) this.x -= 6;
            if ((keyPressed('arrowright') || keyPressed('d')) && this.x + this.width < canvas.width) this.x += 6;
        }
    });

    // Ball
    const ball = Sprite({
        x: 250,
        y: 300,
        width: 10,
        height: 10,
        color: 'red',
        dx: 3,
        dy: -3,
        update() {
            if (gameState !== "playing") return;

            this.advance();

            // bounce off walls
            if (this.x <= 0 || this.x + this.width >= canvas.width) this.dx *= -1;
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

    // Bricks
    let bricks = [];
    const brickTypes = [
        { color: 'green', hits: 1 },
        { color: 'yellow', hits: 2 },
        { color: 'orange', hits: 3 }
    ];
    for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 8; col++) {
            if (row === 0) type = 2;
            else if (row < 3) type = 1;
            else type = 0;
            bricks.push(Sprite({
                x: col * 60 + 20,
                y: row * 25 + 30,
                width: 50,
                height: 15,
                color: brickTypes[type].color,
                hits: brickTypes[type].hits
            }));
        }
    }

    // Lives Display
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
                render() {
                    this.context.fillStyle = this.color;
                    this.context.beginPath();
                    this.context.arc(this.x + this.width / 2, this.y + this.height / 2, this.width / 2, 0, Math.PI * 2);
                    this.context.fill();
                }
            }));
        }
    }
    updateLivesDisplay();

    // Game Loop
    const loop = GameLoop({
        update() {
            if (gameState !== "playing") return;

            paddle.update();
            ball.update();

            // Bricks collision
            bricks.forEach((brick, i) => {
                if (collides(ball, brick)) {
                    ball.dy *= -1;
                    brick.hits -= 1;
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
            }

            // Ball falls below paddle
            if (ball.y > canvas.height) {
                ball.x = 250;
                ball.y = 300;
                ball.dx = 3;
                ball.dy = -3;

                lives -= 1;
                updateLivesDisplay();

                if (lives <= 0) {
                    gameState = "gameover";
                }
            }
        },
        render() {
            paddle.render();
            ball.render();
            bricks.forEach(brick => brick.render());
            livesDisplay.forEach(life => life.render());

            const restartBtn = document.getElementById('restartBtn');

            if (gameState === "gameover") {
                context.fillStyle = "white";
                context.font = "30px Arial";
                context.fillText("Game Over", canvas.width / 2 - 80, canvas.height / 2);
                restartBtn.style.display = "block";
            } else if (gameState === "win") {
                context.fillStyle = "white";
                context.font = "30px Arial";
                context.fillText("You Win!", canvas.width / 2 - 70, canvas.height / 2);
                restartBtn.style.display = "block";
            } else {
                restartBtn.style.display = "none";
            }
        }
    });

    loop.start();

    // Restart button
    document.getElementById('restartBtn').addEventListener('click', () => {
        document.location.reload();
    });

    // Expose only controlled API
    return {
        getLives: () => lives,
        resetGame: () => document.location.reload()
    };
})();