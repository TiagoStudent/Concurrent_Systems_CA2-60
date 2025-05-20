document.addEventListener("DOMContentLoaded", () => {
    const socket = io();

    // UI Elements
    const connectionStatus = document.getElementById("connection-status");
    const playerIdDisplay = document.getElementById("player-id");
    const globalGamesPlayed = document.getElementById("global-games-played");
    const playerWins = document.getElementById("player-wins");
    const playerLosses = document.getElementById("player-losses");
    const lobbyDiv = document.getElementById("lobby");
    const createGameBtn = document.getElementById("create-game-btn");
    const availableGamesList = document.getElementById("available-games-list");
    const gameAreaDiv = document.getElementById("game-area");
    const gameIdDisplay = document.getElementById("game-id");
    const gameStatus = document.getElementById("game-status");
    const turnInfo = document.getElementById("turn-info");
    const playersList = document.getElementById("players-list");
    const startGameBtn = document.getElementById("start-game-btn");
    const boardContainer = document.getElementById("board-container");
    const gameBoard = document.getElementById("game-board");
    const controlsDiv = document.getElementById("controls");
    const monsterSelection = document.getElementById("monster-selection");
    const endTurnBtn = document.getElementById("end-turn-btn");
    const messageLog = document.getElementById("message-log");
    const errorMessage = document.getElementById("error-message");

    let myPlayerId = null;
    let currentGameState = null;
    let selectedMonsterType = null;
    let selectedMonsterToMove = null;

    // --- Helper Functions ---
    function showLobby() {
        lobbyDiv.classList.remove("hidden");
        gameAreaDiv.classList.add("hidden");
        errorMessage.textContent = "";
    }

    function showGameArea() {
        lobbyDiv.classList.add("hidden");
        gameAreaDiv.classList.remove("hidden");
        errorMessage.textContent = "";
    }

    function logMessage(msg) {
        const item = document.createElement("div");
        item.textContent = msg;
        messageLog.appendChild(item);
        messageLog.scrollTop = messageLog.scrollHeight; // Auto-scroll
    }

    function updateStats(globalStats, playerStats) {
        globalGamesPlayed.textContent = globalStats.totalGamesPlayed;
        playerWins.textContent = playerStats.wins;
        playerLosses.textContent = playerStats.losses;
    }

    function updateAvailableGames(games) {
        availableGamesList.innerHTML = ""; // Clear list
        if (games.length === 0) {
            availableGamesList.innerHTML = "<li>No games available at the moment.</li>";
            return;
        }
        games.forEach(game => {
            const li = document.createElement("li");
            li.textContent = `Jogo ${game.id.substring(0, 6)}... (${game.playerCount}/4 players)`;
            const joinBtn = document.createElement("button");
            joinBtn.textContent = "Join";
            joinBtn.onclick = () => socket.emit("join_game", game.id);
            li.appendChild(joinBtn);
            availableGamesList.appendChild(li);
        });
    }

    function updateGameView(gameState) {
        currentGameState = gameState;
        gameIdDisplay.textContent = gameState.id.substring(0, 8) + "...";

        // Update player list
        playersList.innerHTML = "Jogadores: ";
        gameState.playerOrder.forEach((pid, index) => {
            const player = gameState.players[pid];
            const span = document.createElement("span");
            span.textContent = ` ${pid.substring(0, 4)} (${player.edge})${index === gameState.playerOrder.length - 1 ? "" : ","}`;
            if (pid === myPlayerId) {
                span.style.fontWeight = "bold";
            }
            playersList.appendChild(span);
        });

        if (gameState.status === "waiting") {
            gameStatus.textContent = `Waiting for players (${gameState.playerOrder.length}/4)...`;
            // Show start button only if >= 2 players and I am the first player (creator)
            if (gameState.playerOrder.length >= 2 && gameState.playerOrder[0] === myPlayerId) {
                startGameBtn.classList.remove("hidden");
            } else {
                startGameBtn.classList.add("hidden");
            }
            turnInfo.textContent = "";
            controlsDiv.classList.add("hidden");
        } else if (gameState.status === "active") {
            gameStatus.textContent = `Game in progress - Round ${gameState.round}`;
            startGameBtn.classList.add("hidden");
            controlsDiv.classList.remove("hidden");
            if (gameState.currentPlayerId === myPlayerId) {
                turnInfo.textContent = "It's your turn!";
                turnInfo.style.color = "green";
                // Enable controls
                endTurnBtn.disabled = false;
                monsterSelection.querySelectorAll("button").forEach(btn => btn.disabled = false);
            } else {
                turnInfo.textContent = `Turn: ${gameState.currentPlayerId.substring(0, 4)}`;
                turnInfo.style.color = "black";
                // Disable controls
                endTurnBtn.disabled = true;
                monsterSelection.querySelectorAll("button").forEach(btn => btn.disabled = true);
            }
        } else if (gameState.status === "finished") {
            // Handle finished state properly (show winner, etc.)
            gameStatus.textContent = "Game finished!";
            turnInfo.textContent = "";
            controlsDiv.classList.add("hidden");
        }

        renderBoard(gameState.board);
    }

    function renderBoard(boardData) {
        gameBoard.innerHTML = ""; // Clear board
        for (let y = 0; y < 10; y++) {
            for (let x = 0; x < 10; x++) {
                const square = document.createElement("div");
                square.classList.add("square");
                square.dataset.x = x;
                square.dataset.y = y;

                const monster = boardData[y][x];
                if (monster) {
                    // Display monster visually (e.g., icon or letter)
                    let monsterChar = "?";
                    let monsterClass = "";
                    switch (monster.type) {
                        case "vampire": monsterChar = "V"; monsterClass = "monster-vampire"; break;
                        case "werewolf": monsterChar = "W"; monsterClass = "monster-werewolf"; break;
                        case "ghost": monsterChar = "G"; monsterClass = "monster-ghost"; break;
                    }
                    square.textContent = monsterChar;
                    square.classList.add(monsterClass);
                    if (monster.owner === myPlayerId) {
                        square.style.fontWeight = "bold"; // Highlight own monsters
                        square.dataset.monsterId = monster.id;
                    }
                }

                // Add click listener for game actions
                square.onclick = () => handleSquareClick(x, y);

                gameBoard.appendChild(square);
            }
        }
    }

    function handleSquareClick(x, y) {
        if (!currentGameState || currentGameState.status !== "active" || currentGameState.currentPlayerId !== myPlayerId) {
            return; // Not player's turn or game not active
        }

        const clickedSquare = gameBoard.querySelector(`.square[data-x="${x}"][data-y="${y}"]`);
        const monsterOnSquare = currentGameState.board[y][x];

        if (selectedMonsterType) {
            // Attempting to place a new monster
            logMessage(`Tentando colocar ${selectedMonsterType} em (${x}, ${y})`);
            socket.emit("game_action", { action: "place_monster", type: selectedMonsterType, x, y });
            selectedMonsterType = null; // Reset selection
            // Visually deselect monster type button
        } else if (selectedMonsterToMove) {
            // Attempting to move the selected monster
            logMessage(`Tentando mover monstro ${selectedMonsterToMove.id} para (${x}, ${y})`);
            socket.emit("game_action", { action: "move_monster", monsterId: selectedMonsterToMove.id, newX: x, newY: y });
            selectedMonsterToMove = null; // Reset selection
            // Visually deselect monster on board
        } else if (monsterOnSquare && monsterOnSquare.owner === myPlayerId) {
            // Selecting own monster to move
            selectedMonsterToMove = monsterOnSquare;
            logMessage(`Selecionou seu monstro ${monsterOnSquare.type} (${monsterOnSquare.id}) em (${x}, ${y}) para mover.`);
            // Visually highlight selected monster
        } else {
            logMessage("Invalid click.");
        }
    }

    // --- Socket Event Listeners ---
    socket.on("connect", () => {
        connectionStatus.textContent = "Connected to server.";
        connectionStatus.style.color = "green";
        showLobby(); // Show lobby on successful connection
    });

    socket.on("disconnect", () => {
        connectionStatus.textContent = "Disconnected from server.";
        connectionStatus.style.color = "red";
        showLobby(); // Or maybe a disconnected screen
        lobbyDiv.classList.add("hidden"); // Hide lobby content on disconnect
        gameAreaDiv.classList.add("hidden");
        currentGameState = null;
        myPlayerId = null;
    });

    socket.on("initial_data", (data) => {
        myPlayerId = data.playerId;
        playerIdDisplay.textContent = myPlayerId;
        updateStats(data.globalStats, data.playerStats);
        logMessage(`Connected as player ${myPlayerId}`);
    });

    socket.on("available_games", (games) => {
        if (!currentGameState) { // Only update if in lobby
            updateAvailableGames(games);
        }
    });

    socket.on("game_joined", (gameState) => {
        logMessage(`Joined game ${gameState.id}`);
        showGameArea();
        updateGameView(gameState);
    });

    socket.on("game_update", (gameState) => {
        logMessage("Game state updated.");
        updateGameView(gameState);
    });

    socket.on("game_started", (gameState) => {
        logMessage("The game has started!");
        updateGameView(gameState);
    });

    socket.on("game_over", (data) => {
        logMessage(`Game Over: ${data.message || "Game ended."}`);
        // Show winner, update final stats, provide option to return to lobby
        if (currentGameState) {
            currentGameState.status = "finished"; // Mark locally as finished
            updateGameView(currentGameState);
        }
        // Maybe automatically return to lobby after a delay?
        setTimeout(() => {
            currentGameState = null;
            showLobby();
            socket.emit("request_lobby_data"); // Ask server for fresh lobby data
        }, 5000);
    });

    socket.on("error_message", (msg) => {
        errorMessage.textContent = `Error: ${msg}`;
        logMessage(`Server error: ${msg}`);
        // Clear error message after a few seconds
        setTimeout(() => { errorMessage.textContent = ""; }, 5000);
    });

    // --- UI Event Listeners ---
    createGameBtn.onclick = () => {
        socket.emit("create_game");
    };

    startGameBtn.onclick = () => {
        socket.emit("start_game");
    };

    endTurnBtn.onclick = () => {
        if (currentGameState && currentGameState.currentPlayerId === myPlayerId) {
            logMessage("Ending turn...");
            socket.emit("game_action", { action: "end_turn" });
            selectedMonsterType = null;
            selectedMonsterToMove = null;
        }
    };

    monsterSelection.querySelectorAll("button").forEach(button => {
        button.onclick = () => {
            selectedMonsterType = button.dataset.type;
            selectedMonsterToMove = null; // Deselect any monster selected for moving
            logMessage(`Selecionou ${selectedMonsterType} para colocar. Clique em uma casa válida na sua borda.`);
            // Visually indicate selected type
        };
    });

    // Initial setup
    renderBoard(Array(10).fill(null).map(() => Array(10).fill(null))); // Render empty board initially
});

