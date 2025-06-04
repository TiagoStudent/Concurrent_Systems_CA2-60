/**
 * Monster Mayhem Client JavaScript
 * 
 * This file handles all client-side functionality for the Monster Mayhem game.
 * It manages the user interface, game state, and communication with the server.
 * 
 * Key Features:
 * - Real-time game state updates
 * - Interactive game board with visual feedback
 * - Monster placement and movement controls
 * - Player statistics and game information
 * - Responsive design and animations
 * - Error handling and user notifications
 */

document.addEventListener("DOMContentLoaded", () => {
    // Initialize Socket.IO connection
    const socket = io();

    
    // UI ELEMENT REFERENCES


    // Connection and Status
    const connectionStatus = document.getElementById("connection-status");
    const playerIdDisplay = document.getElementById("player-id");
    const globalGamesPlayed = document.getElementById("global-games-played");
    const playerWins = document.getElementById("player-wins");
    const playerLosses = document.getElementById("player-losses");

    // Lobby Elements
    const lobbyDiv = document.getElementById("lobby");
    const createGameBtn = document.getElementById("create-game-btn");
    const availableGamesList = document.getElementById("available-games-list");
    const noGamesMessage = document.getElementById("no-games-message");

    // Game Area Elements
    const gameAreaDiv = document.getElementById("game-area");
    const gameIdDisplay = document.getElementById("game-id");
    const gameStatus = document.getElementById("game-status");
    const turnInfo = document.getElementById("turn-info");
    const roundNumber = document.getElementById("round-number");
    const playersContainer = document.getElementById("players-container");
    const startGameBtn = document.getElementById("start-game-btn");

    // Game Board
    const boardContainer = document.getElementById("board-container");
    const gameBoard = document.getElementById("game-board");

    // Controls
    const controlsDiv = document.getElementById("controls");
    const monsterSelection = document.getElementById("monster-selection");
    const endTurnBtn = document.getElementById("end-turn-btn");
    const clearSelectionBtn = document.getElementById("clear-selection-btn");
    const selectionIndicator = document.getElementById("selection-indicator");

    // Messages and Notifications
    const messageLog = document.getElementById("message-log");
    const errorToast = document.getElementById("error-toast");
    const successToast = document.getElementById("success-toast");
    const errorMessage = document.getElementById("error-message");
    const successMessage = document.getElementById("success-message");
    const loadingOverlay = document.getElementById("loading-overlay");

    // 
    // GAME STATE VARIABLES
     

    let myPlayerId = null;
    let currentGameState = null;
    let selectedMonsterType = null;
    let selectedMonsterToMove = null;
    let validMoves = [];
    let validPlacements = [];

    
    // UTILITY FUNCTIONS
    

    
    //Show the lobby and hide game area
    
    function showLobby() {
        lobbyDiv.classList.remove("hidden");
        gameAreaDiv.classList.add("hidden");
        lobbyDiv.classList.add("animate-fade-in");
        clearGameSelections();
    }

    
    //Show the game area and hide lobby
    
    function showGameArea() {
        lobbyDiv.classList.add("hidden");
        gameAreaDiv.classList.remove("hidden");
        gameAreaDiv.classList.add("animate-fade-in");
    }

    //Show loading overlay
    
    function showLoading(text = "Carregando...") {
        loadingOverlay.querySelector(".loading-text").textContent = text;
        loadingOverlay.classList.remove("hidden");
    }

    /**
     * Hide loading overlay
     */
    function hideLoading() {
        loadingOverlay.classList.add("hidden");
    }

    /**
     * Show toast notification
     * @param {string} type - 'error' or 'success'
     * @param {string} message - Message to display
     */
    function showToast(type, message) {
        const toast = type === 'error' ? errorToast : successToast;
        const messageElement = type === 'error' ? errorMessage : successMessage;
        
        messageElement.textContent = message;
        toast.classList.remove("hidden");
        toast.classList.add("show");
        
        // Auto-hide after 5 seconds
        setTimeout(() => hideToast(toast.id), 5000);
    }

    /**
     * Hide toast notification
     * @param {string} toastId - ID of toast to hide
     */
    function hideToast(toastId) {
        const toast = document.getElementById(toastId);
        toast.classList.remove("show");
        setTimeout(() => toast.classList.add("hidden"), 300);
    }

    // Make hideToast globally available for onclick handlers
    window.hideToast = hideToast;

    /**
     * Add message to the game log
     * @param {string} msg - Message to log
     * @param {string} type - Message type ('system', 'error', 'success', 'normal')
     */
    function logMessage(msg, type = 'normal') {
        const item = document.createElement("div");
        item.className = `message-item ${type}`;
        item.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        messageLog.appendChild(item);
        messageLog.scrollTop = messageLog.scrollHeight;
        
        // Limit log to 100 messages
        while (messageLog.children.length > 100) {
            messageLog.removeChild(messageLog.firstChild);
        }
    }

    /**
     * Update player statistics display
     * @param {Object} globalStats - Global game statistics
     * @param {Object} playerStats - Individual player statistics
     */
    function updateStats(globalStats, playerStats) {
        globalGamesPlayed.textContent = globalStats.totalGamesPlayed || 0;
        playerWins.textContent = playerStats.wins || 0;
        playerLosses.textContent = playerStats.losses || 0;
        
        // Add animation to updated stats
        [globalGamesPlayed, playerWins, playerLosses].forEach(el => {
            el.style.transform = 'scale(1.1)';
            setTimeout(() => el.style.transform = 'scale(1)', 200);
        });
    }

    /**
     * Update the list of available games
     * @param {Array} games - Array of available games
     */
    function updateAvailableGames(games) {
        availableGamesList.innerHTML = "";
        
        if (games.length === 0) {
            noGamesMessage.classList.remove("hidden");
            return;
        }
        
        noGamesMessage.classList.add("hidden");
        
        games.forEach(game => {
            const li = document.createElement("li");
            li.className = "game-item animate-slide-in-left";
            
            li.innerHTML = `
                <div class="game-info">
                    <div class="game-id">Jogo ${game.id.substring(0, 8)}...</div>
                    <div class="game-players">${game.playerCount}/${game.maxPlayers || 4} jogadores</div>
                </div>
                <button class="btn btn-primary join-game-btn" data-game-id="${game.id}">
                    <i class="fas fa-sign-in-alt"></i>
                    Entrar
                </button>
            `;
            
            // Add join button event listener
            const joinBtn = li.querySelector('.join-game-btn');
            joinBtn.addEventListener('click', () => {
                showLoading("Entrando no jogo...");
                socket.emit("join_game", game.id);
            });
            
            availableGamesList.appendChild(li);
        });
    }

    /**
     * Clear all game selections and visual indicators
     */
    function clearGameSelections() {
        selectedMonsterType = null;
        selectedMonsterToMove = null;
        validMoves = [];
        validPlacements = [];
        
        // Clear visual selections
        document.querySelectorAll('.monster-btn.selected').forEach(btn => {
            btn.classList.remove('selected');
        });
        
        document.querySelectorAll('.square.selected, .square.valid-move, .square.valid-placement').forEach(square => {
            square.classList.remove('selected', 'valid-move', 'valid-placement');
        });
        
        updateSelectionIndicator();
    }

    /**
     * Update the selection indicator text
     */
    function updateSelectionIndicator() {
        let text = "Clique em um monstro para selecionar";
        
        if (selectedMonsterType) {
            text = `${selectedMonsterType} selecionado - Clique em uma casa válida na sua borda`;
        } else if (selectedMonsterToMove) {
            text = `Monstro selecionado - Clique em uma casa válida para mover`;
        }
        
        selectionIndicator.textContent = text;
    }

    /**
     * Get valid placement positions for current player
     * @returns {Array} Array of valid {x, y} positions
     */
    function getValidPlacements() {
        if (!currentGameState || !currentGameState.players[myPlayerId]) {
            return [];
        }
        
        const player = currentGameState.players[myPlayerId];
        const edge = Object.values(currentGameState.players)
            .find(p => p.id === myPlayerId)?.edge;
        
        if (!edge) return [];
        
        const positions = [];
        
        for (let x = 0; x < 10; x++) {
            for (let y = 0; y < 10; y++) {
                let isValidEdge = false;
                
                switch (edge) {
                    case "top": isValidEdge = y === 0; break;
                    case "bottom": isValidEdge = y === 9; break;
                    case "left": isValidEdge = x === 0; break;
                    case "right": isValidEdge = x === 9; break;
                }
                
                if (isValidEdge && !currentGameState.board[y][x]) {
                    positions.push({ x, y });
                }
            }
        }
        
        return positions;
    }

    /**
     * Get valid move positions for a monster
     * @param {Object} monster - Monster object
     * @returns {Array} Array of valid {x, y} positions
     */
    function getValidMoves(monster) {
        if (!monster || !currentGameState) return [];
        
        const positions = [];
        
        // Check all possible positions
        for (let newX = 0; newX < 10; newX++) {
            for (let newY = 0; newY < 10; newY++) {
                if (newX === monster.x && newY === monster.y) continue;
                
                if (isValidMovePosition(monster, newX, newY)) {
                    positions.push({ x: newX, y: newY });
                }
            }
        }
        
        return positions;
    }

    /**
     * Check if a move to a specific position is valid
     * @param {Object} monster - Monster to move
     * @param {number} newX - Target X coordinate
     * @param {number} newY - Target Y coordinate
     * @returns {boolean} True if move is valid
     */
    function isValidMovePosition(monster, newX, newY) {
        const dx = Math.abs(newX - monster.x);
        const dy = Math.abs(newY - monster.y);
        
        // Check movement type
        const isDiagonal = dx > 0 && dy > 0;
        const isStraight = (dx > 0 && dy === 0) || (dx === 0 && dy > 0);
        
        if (!isStraight && !isDiagonal) return false;
        if (isDiagonal && (dx > 2 || dy > 2)) return false;
        
        // Check path for obstacles
        const stepX = Math.sign(newX - monster.x);
        const stepY = Math.sign(newY - monster.y);
        
        let currentX = monster.x;
        let currentY = monster.y;
        
        while (currentX !== newX || currentY !== newY) {
            if (currentX !== newX) currentX += stepX;
            if (currentY !== newY) currentY += stepY;
            
            if (currentX < 0 || currentX > 9 || currentY < 0 || currentY > 9) {
                return false;
            }
            
            const squareContent = currentGameState.board[currentY][currentX];
            
            if (currentX === newX && currentY === newY) {
                // Final destination: can land on empty square or opponent's monster
                return !squareContent || squareContent.owner !== myPlayerId;
            } else {
                // Intermediate squares: can pass over own monsters, but not opponents'
                if (squareContent && squareContent.owner !== myPlayerId) {
                    return false;
                }
            }
        }
        
        return true;
    }

    /**
     * Update visual indicators on the board
     */
    function updateBoardVisuals() {
        // Clear existing indicators
        document.querySelectorAll('.square.valid-move, .square.valid-placement').forEach(square => {
            square.classList.remove('valid-move', 'valid-placement');
        });
        
        // Show valid placements
        if (selectedMonsterType && validPlacements.length > 0) {
            validPlacements.forEach(pos => {
                const square = gameBoard.querySelector(`[data-x="${pos.x}"][data-y="${pos.y}"]`);
                if (square) {
                    square.classList.add('valid-placement');
                }
            });
        }
        
        // Show valid moves
        if (selectedMonsterToMove && validMoves.length > 0) {
            validMoves.forEach(pos => {
                const square = gameBoard.querySelector(`[data-x="${pos.x}"][data-y="${pos.y}"]`);
                if (square) {
                    square.classList.add('valid-move');
                }
            });
        }
    }

    /**
     * Update the main game view with current state
     * @param {Object} gameState - Current game state
     */
    function updateGameView(gameState) {
        currentGameState = gameState;
        gameIdDisplay.textContent = gameState.id.substring(0, 8) + "...";
        
        // Update round number
        if (roundNumber) {
            roundNumber.textContent = gameState.round || 1;
        }
        
        // Update players list
        updatePlayersDisplay(gameState);
        
        // Update game status and controls based on game state
        if (gameState.status === "waiting") {
            gameStatus.textContent = `Aguardando jogadores (${gameState.playerOrder.length}/4)...`;
            gameStatus.className = "game-status";
            
            // Show start button only if >= 2 players and I am the creator
            if (gameState.playerOrder.length >= 2 && gameState.playerOrder[0] === myPlayerId) {
                startGameBtn.classList.remove("hidden");
            } else {
                startGameBtn.classList.add("hidden");
            }
            
            turnInfo.textContent = "";
            controlsDiv.classList.add("hidden");
            
        } else if (gameState.status === "active") {
            gameStatus.textContent = `Jogo em andamento - Rodada ${gameState.round}`;
            gameStatus.className = "game-status";
            startGameBtn.classList.add("hidden");
            controlsDiv.classList.remove("hidden");
            
            // Update turn information
            if (gameState.currentPlayerId === myPlayerId) {
                turnInfo.textContent = "É o seu turno!";
                turnInfo.className = "turn-indicator your-turn";
                
                // Enable controls
                endTurnBtn.disabled = false;
                monsterSelection.querySelectorAll("button").forEach(btn => btn.disabled = false);
                
                // Update valid placements if monster type is selected
                if (selectedMonsterType) {
                    validPlacements = getValidPlacements();
                    updateBoardVisuals();
                }
                
            } else {
                const currentPlayerName = gameState.currentPlayerId.substring(0, 4);
                turnInfo.textContent = `Turno: ${currentPlayerName}`;
                turnInfo.className = "turn-indicator waiting";
                
                // Disable controls
                endTurnBtn.disabled = true;
                monsterSelection.querySelectorAll("button").forEach(btn => btn.disabled = true);
                clearGameSelections();
            }
            
        } else if (gameState.status === "finished") {
            gameStatus.textContent = "Jogo finalizado!";
            gameStatus.className = "game-status";
            turnInfo.textContent = "";
            controlsDiv.classList.add("hidden");
            clearGameSelections();
        }
        
        renderBoard(gameState.board);
    }

    /**
     * Update the players display
     * @param {Object} gameState - Current game state
     */
    function updatePlayersDisplay(gameState) {
        playersContainer.innerHTML = "";
        
        gameState.playerOrder.forEach(playerId => {
            const player = gameState.players[playerId];
            const isCurrentPlayer = gameState.currentPlayerId === playerId;
            const isMe = playerId === myPlayerId;
            const isEliminated = player.isEliminated;
            
            const playerCard = document.createElement("div");
            playerCard.className = `player-card-game ${isCurrentPlayer ? 'current-player' : ''} ${isEliminated ? 'eliminated' : ''}`;
            
            const edgeColors = {
                top: '#6366f1',
                bottom: '#ec4899',
                left: '#10b981',
                right: '#f59e0b'
            };
            
            playerCard.innerHTML = `
                <div class="player-edge" style="background-color: ${edgeColors[player.edge] || '#6b7280'}">
                    ${player.edge.toUpperCase()}
                </div>
                <div class="player-name">
                    ${isMe ? 'VOCÊ' : playerId.substring(0, 6)}
                    ${isCurrentPlayer ? ' 🎯' : ''}
                    ${isEliminated ? ' ☠️' : ''}
                </div>
                <div class="player-stats">
                    <span>Monstros: ${player.monsterCount}</span>
                    <span>Perdidos: ${player.monstersLost}</span>
                </div>
            `;
            
            playersContainer.appendChild(playerCard);
        });
    }

    /**
     * Render the game board
     * @param {Array} boardData - 2D array representing the board state
     */
    function renderBoard(boardData) {
        gameBoard.innerHTML = "";
        
        for (let y = 0; y < 10; y++) {
            for (let x = 0; x < 10; x++) {
                const square = document.createElement("div");
                square.className = "square";
                square.dataset.x = x;
                square.dataset.y = y;
                
                const monster = boardData[y][x];
                if (monster) {
                    const monsterElement = document.createElement("div");
                    monsterElement.className = `monster ${monster.type} ${monster.owner === myPlayerId ? 'own' : ''}`;
                    
                    // Set monster emoji based on type
                    const monsterEmojis = {
                        vampire: '🧛',
                        werewolf: '🐺',
                        ghost: '👻'
                    };
                    
                    monsterElement.textContent = monsterEmojis[monster.type] || '?';
                    monsterElement.dataset.monsterId = monster.id;
                    square.appendChild(monsterElement);
                }
                
                // Add click listener for game actions
                square.addEventListener('click', () => handleSquareClick(x, y));
                
                gameBoard.appendChild(square);
            }
        }
        
        // Update visual indicators after rendering
        updateBoardVisuals();
    }

    /**
     * Handle clicks on board squares
     * @param {number} x - X coordinate of clicked square
     * @param {number} y - Y coordinate of clicked square
     */
    function handleSquareClick(x, y) {
        if (!currentGameState || currentGameState.status !== "active" || currentGameState.currentPlayerId !== myPlayerId) {
            return; // Not player's turn or game not active
        }
        
        const clickedSquare = gameBoard.querySelector(`[data-x="${x}"][data-y="${y}"]`);
        const monsterOnSquare = currentGameState.board[y][x];
        
        if (selectedMonsterType) {
            // Attempting to place a new monster
            const isValidPlacement = validPlacements.some(pos => pos.x === x && pos.y === y);
            
            if (isValidPlacement) {
                logMessage(`Colocando ${selectedMonsterType} em (${x}, ${y})`, 'system');
                showLoading("Colocando monstro...");
                socket.emit("game_action", { action: "place_monster", type: selectedMonsterType, x, y });
                clearGameSelections();
            } else {
                showToast('error', 'Posição inválida para colocar monstro');
            }
            
        } else if (selectedMonsterToMove) {
            // Attempting to move the selected monster
            const isValidMove = validMoves.some(pos => pos.x === x && pos.y === y);
            
            if (isValidMove) {
                logMessage(`Movendo monstro para (${x}, ${y})`, 'system');
                showLoading("Movendo monstro...");
                socket.emit("game_action", { action: "move_monster", monsterId: selectedMonsterToMove.id, newX: x, newY: y });
                clearGameSelections();
            } else {
                showToast('error', 'Movimento inválido');
            }
            
        } else if (monsterOnSquare && monsterOnSquare.owner === myPlayerId) {
            // Selecting own monster to move
            selectedMonsterToMove = monsterOnSquare;
            validMoves = getValidMoves(monsterOnSquare);
            
            // Visual feedback
            clickedSquare.classList.add('selected');
            updateBoardVisuals();
            updateSelectionIndicator();
            
            logMessage(`Selecionou seu ${monsterOnSquare.type} em (${x}, ${y})`, 'system');
            
        } else {
            // Invalid click
            showToast('error', 'Clique inválido');
        }
    }

    
    // SOCKET EVENT HANDLERS
    

    socket.on("connect", () => {
        connectionStatus.textContent = "Conectado ao servidor";
        connectionStatus.className = "status-connected";
        showLobby();
        hideLoading();
        logMessage("Conectado ao servidor", 'success');
    });

    socket.on("disconnect", () => {
        connectionStatus.textContent = "Desconectado do servidor";
        connectionStatus.className = "status-disconnected";
        showLobby();
        lobbyDiv.classList.add("hidden");
        gameAreaDiv.classList.add("hidden");
        currentGameState = null;
        myPlayerId = null;
        clearGameSelections();
        showToast('error', 'Conexão perdida com o servidor');
        logMessage("Desconectado do servidor", 'error');
    });

    socket.on("initial_data", (data) => {
        myPlayerId = data.playerId;
        playerIdDisplay.textContent = myPlayerId.substring(0, 8) + "...";
        updateStats(data.globalStats, data.playerStats);
        logMessage(`Conectado como jogador ${myPlayerId.substring(0, 8)}`, 'success');
    });

    socket.on("available_games", (games) => {
        if (!currentGameState) { // Only update if in lobby
            updateAvailableGames(games);
        }
    });

    socket.on("game_joined", (gameState) => {
        hideLoading();
        logMessage(`Entrou no jogo ${gameState.id.substring(0, 8)}`, 'success');
        showGameArea();
        updateGameView(gameState);
        showToast('success', 'Entrou no jogo com sucesso!');
    });

    socket.on("game_update", (gameState) => {
        hideLoading();
        logMessage("Estado do jogo atualizado", 'system');
        updateGameView(gameState);
    });

    socket.on("game_started", (gameState) => {
        hideLoading();
        logMessage("O jogo começou!", 'success');
        updateGameView(gameState);
        showToast('success', 'O jogo começou!');
    });

    socket.on("game_over", (data) => {
        hideLoading();
        logMessage(`Fim de jogo: ${data.message}`, 'system');
        showToast('success', data.message);
        
        if (currentGameState) {
            currentGameState.status = "finished";
            updateGameView(currentGameState);
        }
        
        // Return to lobby after delay
        setTimeout(() => {
            currentGameState = null;
            clearGameSelections();
            showLobby();
            socket.emit("request_lobby_data");
        }, 5000);
    });

    socket.on("stats_update", (data) => {
        updateStats(data.globalStats, data.playerStats);
    });

    socket.on("global_stats_update", (globalStats) => {
        updateStats(globalStats, { wins: playerWins.textContent, losses: playerLosses.textContent });
    });

    socket.on("error_message", (msg) => {
        hideLoading();
        showToast('error', msg);
        logMessage(`Erro: ${msg}`, 'error');
    });

    
    // UI EVENT HANDLERS
    

    createGameBtn.addEventListener('click', () => {
        showLoading("Criando jogo...");
        socket.emit("create_game");
    });

    startGameBtn.addEventListener('click', () => {
        showLoading("Iniciando jogo...");
        socket.emit("start_game");
    });

    endTurnBtn.addEventListener('click', () => {
        if (currentGameState && currentGameState.currentPlayerId === myPlayerId) {
            logMessage("Finalizando turno...", 'system');
            showLoading("Finalizando turno...");
            socket.emit("game_action", { action: "end_turn" });
            clearGameSelections();
        }
    });

    clearSelectionBtn.addEventListener('click', () => {
        clearGameSelections();
        logMessage("Seleção limpa", 'system');
    });

    // Monster selection buttons
    monsterSelection.addEventListener('click', (e) => {
        const button = e.target.closest('.monster-btn');
        if (!button || button.disabled) return;
        
        const monsterType = button.dataset.type;
        if (!monsterType) return;
        
        // Clear previous selections
        clearGameSelections();
        
        // Set new selection
        selectedMonsterType = monsterType;
        validPlacements = getValidPlacements();
        
        // Visual feedback
        button.classList.add('selected');
        updateBoardVisuals();
        updateSelectionIndicator();
        
        logMessage(`Selecionou ${monsterType} para colocar`, 'system');
    });

    // 
    // INITIALIZATION
    

    // Render empty board initially
    renderBoard(Array(10).fill(null).map(() => Array(10).fill(null)));
    
    // Show loading initially
    showLoading("Conectando ao servidor...");
    
    logMessage("Cliente Monster Mayhem iniciado", 'system');
});

