const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const Game = require("./game");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// Serve static files from the client directory
const clientPath = path.join(__dirname, "../client");
app.use(express.static(clientPath));

app.get("/", (req, res) => {
  res.sendFile(path.join(clientPath, "index.html"));
});

// Game state variables
let games = {}; // { gameId: Game object }
let players = {}; // { socketId: { id, gameId, wins, losses } }
let globalGameStats = {
    totalGamesPlayed: 0
};

// Helper function to broadcast updated game list
function broadcastGameList() {
    const availableGames = Object.values(games)
        .filter(game => game.status === "waiting" && game.playerOrder.length < 4)
        .map(game => ({ id: game.id, playerCount: game.playerOrder.length }));

    Object.keys(players).forEach(socketId => {
        if (players[socketId] && !players[socketId].gameId) { // Check if player exists before accessing gameId
            io.to(socketId).emit("available_games", availableGames);
        }
    });
}

// Helper function to update stats and end game
function handleGameOver(game) {
    if (!game || game.status !== "finished") return;

    // Avoid processing game over multiple times if called again
    if (game.processedGameOver) return;
    game.processedGameOver = true; // Mark as processed

    globalGameStats.totalGamesPlayed++;
    console.log(`Global games played updated to: ${globalGameStats.totalGamesPlayed}`);

    const winnerId = game.winner;
    const playerIdsInGame = Object.keys(game.players); // Get players who were in the game instance

    // Update stats for players involved in the game
    playerIdsInGame.forEach(playerId => {
        // Find the current socket associated with this player ID
        const playerSocketEntry = Object.entries(players).find(([socketId, pData]) => pData.id === playerId);

        if (playerSocketEntry) {
            const [socketId, playerSocketData] = playerSocketEntry;
            if (playerId === winnerId) {
                playerSocketData.wins++;
                console.log(`Player ${playerId} wins updated to: ${playerSocketData.wins}`);
            } else {
                playerSocketData.losses++;
                console.log(`Player ${playerId} losses updated to: ${playerSocketData.losses}`);
            }
            // Send updated player-specific stats to that player
            io.to(socketId).emit("stats_update", {
                 globalStats: globalGameStats, // Include updated global stats
                 playerStats: { wins: playerSocketData.wins, losses: playerSocketData.losses }
            });
        } else {
            console.log(`Could not find active socket for player ${playerId} to update stats.`);
            // Consider persisting stats if players can reconnect and retain them
        }
    });

    // Broadcast updated global stats to ALL connected players (including those not in the game)
    io.emit("global_stats_update", globalGameStats);
    console.log("Broadcasting updated global stats to all clients.");

    // Notify players in the game room about the game over state
    io.to(game.id).emit("game_over", {
        message: winnerId ? `Player ${winnerId.substring(0,4)} won!` : "Game ended (Draw/Aborted).",
        winnerId: winnerId,
        finalState: game.getState() // Send final state
    });

    // Clean up game after a delay
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
         broadcastGameList(); // Update lobby list for players now out of the game
    }, 10000); // 10 second delay
}

// Handle client connections
io.on("connection", (socket) => {
    console.log(`Player connected: ${socket.id}`);
    players[socket.id] = {
        id: socket.id,
        gameId: null,
        wins: 0, // Reset stats on connection - needs persistence for real stats
        losses: 0
    };

    // Send initial data including current stats
    socket.emit("initial_data", {
        playerId: socket.id,
        globalStats: globalGameStats,
        playerStats: { wins: players[socket.id].wins, losses: players[socket.id].losses }
    });

    // Send available games list
    broadcastGameList();

    // --- Game Creation/Joining/Starting --- (Mostly unchanged)
    socket.on("create_game", () => {
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
    });

    socket.on("join_game", (gameId) => {
        if (players[socket.id]?.gameId) {
            return socket.emit("error_message", "You are already in a game.");
        }
        const game = games[gameId];
        if (!game) {
            return socket.emit("error_message", "Game not found.");
        }
        if (game.status !== "waiting") {
            return socket.emit("error_message", "Game already started or full.");
        }

        const result = game.addPlayer(socket.id);
        if (result.success) {
            players[socket.id].gameId = gameId;
            socket.join(gameId);
            console.log(`Player ${socket.id} joined game ${gameId}`);
            io.to(gameId).emit("game_update", game.getState());
            broadcastGameList();
        } else {
            socket.emit("error_message", result.message || "Could not join game.");
        }
    });

    socket.on("start_game", () => {
        const gameId = players[socket.id]?.gameId;
        const game = games[gameId];
        if (!game) {
            return socket.emit("error_message", "You are not in a game.");
        }
        if (game.playerOrder[0] !== socket.id) { // Only creator can start
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
    });

    // --- Disconnect Handling --- (Mostly unchanged)
    socket.on("disconnect", () => {
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
    });

    // --- Game Action Handling --- (Mostly unchanged)
    socket.on("game_action", (data) => {
        const gameId = players[socket.id]?.gameId;
        const game = games[gameId];

        if (!game || game.status !== "active") {
            return socket.emit("error_message", "Invalid action: Game not active.");
        }
        if (game.getCurrentPlayer() !== socket.id) {
            return socket.emit("error_message", "Not your turn.");
        }

        let result = { success: false, message: "Unknown action." };

        try {
            switch (data.action) {
                case "place_monster":
                    result = game.placeMonster(socket.id, data.type, data.x, data.y);
                    break;
                case "move_monster":
                    result = game.moveMonster(socket.id, data.monsterId, data.newX, data.newY);
                    break;
                case "end_turn":
                    result = game.endTurn(socket.id);
                    break;
                default:
                    console.warn(`Unknown game action received: ${data.action}`);
            }
        } catch (error) {
            console.error(`Error processing game action for game ${gameId} by player ${socket.id}:`, error);
            result = { success: false, message: "Internal server error processing action." };
        }

        if (result.success) {
            console.log(`Action ${data.action} successful for player ${socket.id} in game ${gameId}`);
            const newState = game.getState();
            io.to(gameId).emit("game_update", newState);

            if (game.status === "finished") {
                handleGameOver(game);
            }
        } else {
            console.log(`Action ${data.action} failed for player ${socket.id} in game ${gameId}: ${result.message}`);
            socket.emit("error_message", result.message || "Action failed.");
        }
    });

    // --- Lobby/Stats Update Requests ---
    socket.on("request_lobby_data", () => {
         // Check if player exists before sending data
        if (players[socket.id] && !players[socket.id].gameId) {
             // Send available games list specifically to the requester
             const availableGames = Object.values(games)
                .filter(game => game.status === "waiting" && game.playerOrder.length < 4)
                .map(game => ({ id: game.id, playerCount: game.playerOrder.length }));
             socket.emit("available_games", availableGames);

             // Send current stats specifically to the requester
             socket.emit("stats_update", {
                 globalStats: globalGameStats,
                 playerStats: { wins: players[socket.id].wins, losses: players[socket.id].losses }
             });
        }
    });

});

// Route for the main page - ADDED LOGGING
app.get("/", (req, res) => {
    console.log("GET / request received"); // Add log
    const filePath = path.join(clientPath, "index.html");
    console.log(`Attempting to send file: ${filePath}`); // Add log
    res.sendFile(filePath, (err) => { // Add callback to check for errors
        if (err) {
            console.error("Error sending index.html:", err);
            res.status(500).send("Internal Server Error");
        } else {
            console.log("index.html sent successfully.");
        }
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on port ${PORT}`);
});

