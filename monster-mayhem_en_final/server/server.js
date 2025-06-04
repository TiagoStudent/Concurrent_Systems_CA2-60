/**
 * Monster Mayhem Server
 * 
 * This is the main server file for the Monster Mayhem multiplayer board game.
 * It implements a real-time multiplayer game server using Node.js, Express, and Socket.IO.
 * 
 * Key Features:
 * - Real-time multiplayer communication via WebSockets
 * - Multiple concurrent games support
 * - Player statistics tracking
 * - Robust error handling and concurrency control
 * - Game state synchronization across all clients
 * 
 * Concurrency Considerations:
 * - Uses Socket.IO's built-in event serialization for basic concurrency
 * - Implements action locks in Game class to prevent race conditions
 * - Validates game state before processing actions
 * - Handles player disconnections gracefully
 */

const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const Game = require("./game");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    // Configure Socket.IO for better concurrency handling
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    // Prevent timeout issues
    pingTimeout: 60000,
    pingInterval: 25000
});

const PORT = process.env.PORT || 3000;

// Serve static files from the client directory
const clientPath = path.join(__dirname, "../client");
app.use(express.static(clientPath));

// Main route
app.get("/", (req, res) => {
    console.log("GET / request received");
    const filePath = path.join(clientPath, "index.html");
    console.log(`Attempting to send file: ${filePath}`);
    res.sendFile(filePath, (err) => {
        if (err) {
            console.error("Error sending index.html:", err);
            res.status(500).send("Internal Server Error");
        } else {
            console.log("index.html sent successfully.");
        }
    });
});

// 
// GAME STATE MANAGEMENT
// 

let games = {}; // { gameId: Game object }
let players = {}; // { socketId: { id, gameId, wins, losses, lastActivity } }
let globalGameStats = {
    totalGamesPlayed: 0,
    totalPlayersConnected: 0
};

// Concurrency control for critical operations
let statsLock = false;

/**
 * Safely update global statistics with concurrency control
 * @param {Function} updateFunction - Function to perform the update
 */
function safeStatsUpdate(updateFunction) {
    if (statsLock) {
        console.warn("Stats update skipped due to concurrent access");
        return;
    }
    statsLock = true;
    try {
        updateFunction();
    } finally {
        statsLock = false;
    }
}

/**
 * Broadcast the list of available games to players in lobby
 */
function broadcastGameList() {
    const availableGames = Object.values(games)
        .filter(game => game.status === "waiting" && game.playerOrder.length < 4)
        .map(game => ({ 
            id: game.id, 
            playerCount: game.playerOrder.length,
            maxPlayers: 4
        }));

    // Only send to players not currently in a game
    Object.keys(players).forEach(socketId => {
        if (players[socketId] && !players[socketId].gameId) {
            io.to(socketId).emit("available_games", availableGames);
        }
    });
}

/**
 * Handle game completion and update statistics
 * @param {Game} game - The completed game
 */
function handleGameOver(game) {
    if (!game || game.status !== "finished") return;

    // Prevent processing the same game multiple times
    if (game.processedGameOver) return;
    game.processedGameOver = true;

    // Update global statistics safely
    safeStatsUpdate(() => {
        globalGameStats.totalGamesPlayed++;
        console.log(`Global games played updated to: ${globalGameStats.totalGamesPlayed}`);
    });

    const winnerId = game.winner;
    const playerIdsInGame = Object.keys(game.players);

    // Update individual player statistics
    playerIdsInGame.forEach(playerId => {
        const playerSocketEntry = Object.entries(players).find(([socketId, pData]) => pData.id === playerId);

        if (playerSocketEntry) {
            const [socketId, playerSocketData] = playerSocketEntry;
            
            // Update win/loss statistics
            if (playerId === winnerId) {
                playerSocketData.wins++;
                console.log(`Player ${playerId} wins updated to: ${playerSocketData.wins}`);
            } else {
                playerSocketData.losses++;
                console.log(`Player ${playerId} losses updated to: ${playerSocketData.losses}`);
            }
            
            // Send updated stats to the specific player
            io.to(socketId).emit("stats_update", {
                globalStats: globalGameStats,
                playerStats: { wins: playerSocketData.wins, losses: playerSocketData.losses }
            });
        } else {
            console.log(`Could not find active socket for player ${playerId} to update stats.`);
        }
    });

    // Broadcast updated global stats to all connected players
    io.emit("global_stats_update", globalGameStats);
    console.log("Broadcasting updated global stats to all clients.");

    // Notify players in the game about the game over state
    io.to(game.id).emit("game_over", {
        message: winnerId ? `Player ${winnerId.substring(0,4)} won!` : "Game ended (Draw/Aborted).",
        winnerId: winnerId,
        finalState: game.getState()
    });

    // Clean up game after a delay to allow players to see results
    setTimeout(() => {
        // Remove players' gameId reference
        playerIdsInGame.forEach(playerId => {
            const playerSocketEntry = Object.entries(players).find(([socketId, pData]) => pData.id === playerId);
            if (playerSocketEntry && playerSocketEntry[1].gameId === game.id) {
                playerSocketEntry[1].gameId = null;
            }
        });
        
        delete games[game.id];
        console.log(`Game ${game.id} removed after finishing.`);
        broadcastGameList(); // Update lobby list
    }, 10000); // 10 second delay
}

/**
 * Validate that a player can perform an action in a game
 * @param {string} socketId - Player's socket ID
 * @param {string} gameId - Game ID
 * @returns {Object} Validation result with game and player info
 */
function validatePlayerAction(socketId, gameId) {
    const playerInfo = players[socketId];
    if (!playerInfo) {
        return { valid: false, message: "Player not found." };
    }

    if (playerInfo.gameId !== gameId) {
        return { valid: false, message: "You are not in this game." };
    }

    const game = games[gameId];
    if (!game) {
        return { valid: false, message: "Game not found." };
    }

    if (game.status !== "active") {
        return { valid: false, message: "Game is not active." };
    }

    return { valid: true, game, playerInfo };
}

// 
// SOCKET.IO EVENT HANDLERS
// 

io.on("connection", (socket) => {
    console.log(`Player connected: ${socket.id}`);
    
    // Initialize player data
    players[socket.id] = {
        id: socket.id,
        gameId: null,
        wins: 0, // Note: In production, this should be loaded from a database
        losses: 0,
        lastActivity: Date.now()
    };

    // Update global connection count
    safeStatsUpdate(() => {
        globalGameStats.totalPlayersConnected = Object.keys(players).length;
    });

    // Send initial data to the newly connected player
    socket.emit("initial_data", {
        playerId: socket.id,
        globalStats: globalGameStats,
        playerStats: { wins: players[socket.id].wins, losses: players[socket.id].losses }
    });

    // Send available games list
    broadcastGameList();

    // 
    // GAME MANAGEMENT EVENTS
    // 

    /**
     * Handle game creation request
     */
    socket.on("create_game", () => {
        try {
            if (players[socket.id]?.gameId) {
                return socket.emit("error_message", "You are already in a game.");
            }

            const gameId = uuidv4();
            const newGame = new Game(gameId, socket.id);
            games[gameId] = newGame;
            players[socket.id].gameId = gameId;
            socket.join(gameId);
            
            console.log(`Player ${socket.id} created game ${gameId}`);
            socket.emit("game_joined", newGame.getState(socket.id));
            broadcastGameList();
        } catch (error) {
            console.error(`Error creating game for player ${socket.id}:`, error);
            socket.emit("error_message", "Failed to create game. Please try again.");
        }
    });

    /**
     * Handle game join request
     */
    socket.on("join_game", (gameId) => {
        try {
            if (players[socket.id]?.gameId) {
                return socket.emit("error_message", "You are already in a game.");
            }

            const game = games[gameId];
            if (!game) {
                return socket.emit("error_message", "Game not found.");
            }

            if (game.status !== "waiting") {
                return socket.emit("error_message", "Game already started or finished.");
            }

            if (game.playerOrder.length >= 4) {
                return socket.emit("error_message", "Game is full.");
            }

            const result = game.addPlayer(socket.id);
            if (result.success) {
                players[socket.id].gameId = gameId;
                socket.join(gameId);
                console.log(`Player ${socket.id} joined game ${gameId}`);
                
                // Send game_joined to the new player (triggers showGameArea)
                socket.emit("game_joined", game.getState());
                
                // Send game_update to other players in the game
                socket.to(gameId).emit("game_update", game.getState());
                
                broadcastGameList();
            } else {
                socket.emit("error_message", result.message || "Could not join game.");
            }
        } catch (error) {
            console.error(`Error joining game ${gameId} for player ${socket.id}:`, error);
            socket.emit("error_message", "Failed to join game. Please try again.");
        }
    });

    /**
     * Handle game start request
     */
    socket.on("start_game", () => {
        try {
            const gameId = players[socket.id]?.gameId;
            const game = games[gameId];
            
            if (!game) {
                return socket.emit("error_message", "You are not in a game.");
            }

            if (game.playerOrder[0] !== socket.id) {
                return socket.emit("error_message", "Only the creator can start the game.");
            }

            if (game.playerOrder.length < 2) {
                return socket.emit("error_message", "The game needs at least 2 players to start.");
            }

            if (game.status === "active") {
                return socket.emit("error_message", "The game has already started.");
            }

            if (game.startGame()) {
                console.log(`Game ${gameId} started by ${socket.id}`);
                io.to(gameId).emit("game_started", game.getState());
                broadcastGameList();
            } else {
                socket.emit("error_message", "Could not start the game.");
            }
        } catch (error) {
            console.error(`Error starting game for player ${socket.id}:`, error);
            socket.emit("error_message", "Failed to start game. Please try again.");
        }
    });

    // 
    // GAME ACTION EVENTS
    // 

    /**
     * Handle game actions (place monster, move monster, end turn)
     */
    socket.on("game_action", (data) => {
        try {
            const gameId = players[socket.id]?.gameId;
            const validation = validatePlayerAction(socket.id, gameId);
            
            if (!validation.valid) {
                return socket.emit("error_message", validation.message);
            }

            const { game } = validation;

            if (game.getCurrentPlayer() !== socket.id) {
                return socket.emit("error_message", "Not your turn.");
            }

            // Update player activity
            players[socket.id].lastActivity = Date.now();

            let result = { success: false, message: "Unknown action." };

            // Process the action based on type
            switch (data.action) {
                case "place_monster":
                    if (!data.type || typeof data.x !== 'number' || typeof data.y !== 'number') {
                        result = { success: false, message: "Invalid placement data." };
                    } else {
                        result = game.placeMonster(socket.id, data.type, data.x, data.y);
                    }
                    break;

                case "move_monster":
                    if (!data.monsterId || typeof data.newX !== 'number' || typeof data.newY !== 'number') {
                        result = { success: false, message: "Invalid movement data." };
                    } else {
                        result = game.moveMonster(socket.id, data.monsterId, data.newX, data.newY);
                    }
                    break;

                case "end_turn":
                    result = game.endTurn(socket.id);
                    break;

                default:
                    console.warn(`Unknown game action received: ${data.action}`);
                    result = { success: false, message: "Unknown action type." };
            }

            // Handle the result
            if (result.success) {
                console.log(`Action ${data.action} successful for player ${socket.id} in game ${gameId}`);
                const newState = game.getState();
                io.to(gameId).emit("game_update", newState);

                // Check if game finished
                if (game.status === "finished") {
                    handleGameOver(game);
                }
            } else {
                console.log(`Action ${data.action} failed for player ${socket.id} in game ${gameId}: ${result.message}`);
                socket.emit("error_message", result.message || "Action failed.");
            }
        } catch (error) {
            console.error(`Error processing game action for player ${socket.id}:`, error);
            socket.emit("error_message", "Internal server error. Please try again.");
        }
    });

    // 
    // UTILITY EVENTS
    // 

    /**
     * Handle lobby data requests
     */
    socket.on("request_lobby_data", () => {
        try {
            if (players[socket.id] && !players[socket.id].gameId) {
                const availableGames = Object.values(games)
                    .filter(game => game.status === "waiting" && game.playerOrder.length < 4)
                    .map(game => ({ 
                        id: game.id, 
                        playerCount: game.playerOrder.length,
                        maxPlayers: 4
                    }));

                socket.emit("available_games", availableGames);
                socket.emit("stats_update", {
                    globalStats: globalGameStats,
                    playerStats: { wins: players[socket.id].wins, losses: players[socket.id].losses }
                });
            }
        } catch (error) {
            console.error(`Error handling lobby data request for player ${socket.id}:`, error);
        }
    });

    // 
    // DISCONNECT HANDLING
    // 

    /**
     * Handle player disconnection
     */
    socket.on("disconnect", () => {
        try {
            console.log(`Player disconnected: ${socket.id}`);
            const playerInfo = players[socket.id];
            
            if (!playerInfo) return;

            const gameId = playerInfo.gameId;
            if (gameId && games[gameId]) {
                const game = games[gameId];
                const wasActive = game.status === "active";

                game.removePlayer(socket.id);
                console.log(`Player ${socket.id} removed from game ${gameId} due to disconnect.`);

                if (game.playerOrder.length === 0) {
                    console.log(`Game ${gameId} is empty, deleting.`);
                    delete games[gameId];
                } else {
                    io.to(gameId).emit("game_update", game.getState());
                    if (game.status === "finished" && wasActive) {
                        console.log(`Game ${gameId} ended due to player disconnect.`);
                        handleGameOver(game);
                    }
                }
                broadcastGameList();
            }

            delete players[socket.id];

            // Update global connection count
            safeStatsUpdate(() => {
                globalGameStats.totalPlayersConnected = Object.keys(players).length;
            });
        } catch (error) {
            console.error(`Error handling disconnect for player ${socket.id}:`, error);
        }
    });
});

// 
// SERVER STARTUP
// 

server.listen(PORT, "0.0.0.0", () => {
    console.log(`Monster Mayhem server listening on port ${PORT}`);
    console.log(`Server started at ${new Date().toISOString()}`);
    console.log("Ready to accept connections...");
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    server.close(() => {
        console.log('Server closed.');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully...');
    server.close(() => {
        console.log('Server closed.');
        process.exit(0);
    });
});

