const { v4: uuidv4 } = require("uuid");

/**
 * Monster Mayhem Game Class
 * 
 * Implements the core game logic for the Monster Mayhem board game.
 * This class handles game state, player management, monster placement/movement,
 * combat resolution, and turn management.
 * 
 * Game Rules:
 * - 10x10 grid board
 * - Up to 4 players, each assigned an edge (top, bottom, left, right)
 * - Three monster types: vampire, werewolf, ghost
 * - Combat rules: vampire beats ghost, ghost beats werewolf, werewolf beats vampire
 * - Players eliminated when 10 monsters are lost
 * - Turn order based on fewest monsters (with random tiebreaker)
 */
class Game {
    constructor(gameId, creatorId) {
        this.id = gameId;
        this.players = {}; // { playerId: { id, edge, monsters: [], monstersLost: 0 } }
        this.board = Array(10).fill(null).map(() => Array(10).fill(null)); // 10x10 grid
        this.playerOrder = []; // Array of playerIds in turn order
        this.currentPlayerIndex = 0;
        this.round = 1;
        this.availableEdges = ["top", "bottom", "left", "right"];
        this.status = "waiting"; // waiting, active, finished
        this.winner = null;
        // Track turn actions to enforce game rules
        this.turnActions = {}; // { playerId: { placedMonster: boolean, placedMonsterId: string, movedMonsters: Set<monsterId> } }
        
        // Concurrency control - prevent simultaneous actions
        this.actionLock = false;

        this.addPlayer(creatorId);
    }

    /**
     * Add a player to the game
     * @param {string} playerId - Unique identifier for the player
     * @returns {Object} Success/failure result with message
     */
    addPlayer(playerId) {
        if (this.playerOrder.length >= 4 || this.status !== "waiting") {
            return { success: false, message: "Game full or already started." };
        }
        if (this.players[playerId]) {
            return { success: false, message: "Player already in game." };
        }

        const edge = this.availableEdges.shift();
        if (!edge) {
            console.error("Error: No available edges for new player in game", this.id);
            return { success: false, message: "Internal error: No available edges." };
        }

        this.players[playerId] = {
            id: playerId,
            edge: edge,
            monsters: [], // { id, type, x, y, owner }
            monstersLost: 0,
        };
        this.playerOrder.push(playerId);

        console.log(`Player ${playerId} joined game ${this.id} on edge ${edge}`);
        return { success: true };
    }

    /**
     * Remove a player from the game (e.g., on disconnect)
     * @param {string} playerId - Player to remove
     */
    removePlayer(playerId) {
        if (!this.players[playerId]) {
            return; // Player not in this game
        }

        const edge = this.players[playerId].edge;
        this.availableEdges.push(edge); // Make edge available again
        this.availableEdges.sort((a, b) => 
            ["top", "bottom", "left", "right"].indexOf(a) - 
            ["top", "bottom", "left", "right"].indexOf(b)
        ); // Keep original order

        // Remove player's monsters from board
        this.players[playerId].monsters.forEach(monster => {
            if (this.board[monster.y]?.[monster.x]?.owner === playerId) {
                this.board[monster.y][monster.x] = null;
            }
        });

        // Remove player from turn order
        const playerIndex = this.playerOrder.indexOf(playerId);
        if (playerIndex > -1) {
            // If the removed player was the current player, advance turn before removing
            if (this.status === "active" && playerIndex === this.currentPlayerIndex) {
                this.currentPlayerIndex = this.currentPlayerIndex % 
                    (this.playerOrder.length > 1 ? this.playerOrder.length - 1 : 1);
            }
            this.playerOrder.splice(playerIndex, 1);
            // Adjust index if the removed player was before the current player
            if (this.status === "active" && playerIndex < this.currentPlayerIndex) {
                this.currentPlayerIndex--;
            }
        }

        delete this.players[playerId];
        delete this.turnActions[playerId];
        console.log(`Player ${playerId} removed from game ${this.id}`);

        // Adjust current player index if it becomes invalid
        if (this.status === "active" && this.playerOrder.length > 0) {
            this.currentPlayerIndex = this.currentPlayerIndex % this.playerOrder.length;
        } else if (this.playerOrder.length === 0) {
            this.status = "finished"; // Game ends if no players left
            this.winner = null; // No winner
        }

        // If game was active, check for winner or end condition
        if (this.status === "active") {
            const winner = this.checkForWinner();
            if (winner) {
                this.endGame(winner);
            } else if (this.playerOrder.length < 2) {
                this.endGame(); // End game if fewer than 2 players remain
            }
        }
    }

    /**
     * Start the game (minimum 2 players required)
     * @returns {boolean} True if game started successfully
     */
    startGame() {
        if (this.status !== "waiting" || this.playerOrder.length < 2) {
            return false; // Cannot start game
        }
        this.status = "active";
        // Determine initial turn order (randomly)
        this.playerOrder.sort(() => Math.random() - 0.5);
        this.currentPlayerIndex = 0;
        this.round = 1;
        this.resetTurnActions();
        console.log(`Game ${this.id} started. Turn order: ${this.playerOrder.join(", ")}`);
        return true;
    }

    /**
     * Reset turn actions for players
     * @param {string|null} playerId - Specific player or null for all players
     */
    resetTurnActions(playerId = null) {
        if (playerId) {
            this.turnActions[playerId] = { 
                placedMonster: false, 
                placedMonsterId: null, // FIXED: Track which monster was placed
                movedMonsters: new Set() 
            };
        } else {
            // Reset for all players (e.g., at start of round)
            this.playerOrder.forEach(pid => {
                this.turnActions[pid] = { 
                    placedMonster: false, 
                    placedMonsterId: null, // FIXED: Track which monster was placed
                    movedMonsters: new Set() 
                };
            });
        }
    }

    /**
     * Get the current player whose turn it is
     * @returns {string|null} Current player ID or null
     */
    getCurrentPlayer() {
        if (this.status !== "active" || this.playerOrder.length === 0) {
            return null;
        }
        return this.playerOrder[this.currentPlayerIndex];
    }

    /**
     * Check if a monster placement is valid
     * @param {string} playerId - Player attempting placement
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @returns {boolean} True if placement is valid
     */
    isValidPlacement(playerId, x, y) {
        const player = this.players[playerId];
        if (!player) return false;

        if (x < 0 || x > 9 || y < 0 || y > 9) return false; // Out of bounds
        if (this.board[y][x] !== null) return false; // Square occupied

        // Check if placement is on player's edge
        switch (player.edge) {
            case "top": return y === 0;
            case "bottom": return y === 9;
            case "left": return x === 0;
            case "right": return x === 9;
            default: return false;
        }
    }

    /**
     * Place a monster on the board
     * @param {string} playerId - Player placing the monster
     * @param {string} type - Monster type (vampire, werewolf, ghost)
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @returns {Object} Success/failure result with message
     */
    placeMonster(playerId, type, x, y) {
        // Concurrency control - prevent simultaneous actions
        if (this.actionLock) {
            return { success: false, message: "Another action is in progress. Please wait." };
        }
        this.actionLock = true;

        try {
            if (this.getCurrentPlayer() !== playerId) {
                return { success: false, message: "Not your turn." };
            }
            if (this.turnActions[playerId]?.placedMonster) {
                return { success: false, message: "You have already placed a monster this turn." };
            }
            if (!["vampire", "werewolf", "ghost"].includes(type)) {
                return { success: false, message: "Invalid monster type." };
            }
            if (!this.isValidPlacement(playerId, x, y)) {
                return { success: false, message: "Invalid position to place monster (must be on your edge and empty)." };
            }

            const monsterId = uuidv4();
            const newMonster = { id: monsterId, type, x, y, owner: playerId };

            this.players[playerId].monsters.push(newMonster);
            this.board[y][x] = newMonster;
            this.turnActions[playerId].placedMonster = true;
            this.turnActions[playerId].placedMonsterId = monsterId; // FIXED: Store the placed monster ID

            console.log(`Player ${playerId} placed ${type} (${monsterId}) at (${x}, ${y})`);
            return { success: true, message: `Monster ${type} placed at (${x}, ${y}).` };
        } finally {
            this.actionLock = false; // Always release lock
        }
    }

    /**
     * Check if a monster movement is valid
     * @param {string} playerId - Player attempting the move
     * @param {Object} monster - Monster object to move
     * @param {number} newX - Target X coordinate
     * @param {number} newY - Target Y coordinate
     * @returns {boolean} True if move is valid
     */
    isValidMove(playerId, monster, newX, newY) {
        if (newX < 0 || newX > 9 || newY < 0 || newY > 9) return false; // Out of bounds

        const dx = Math.abs(newX - monster.x);
        const dy = Math.abs(newY - monster.y);

        // Check movement type
        const isDiagonal = dx > 0 && dy > 0;
        const isStraight = (dx > 0 && dy === 0) || (dx === 0 && dy > 0);

        if (!isStraight && !isDiagonal) return false; // No movement
        if (isDiagonal && (dx > 2 || dy > 2)) return false; // Diagonal limit is 2 squares

        // FIXED: Improved path checking for diagonal movement
        const stepX = Math.sign(newX - monster.x);
        const stepY = Math.sign(newY - monster.y);
        
        // Check each step in the path
        let currentX = monster.x;
        let currentY = monster.y;
        
        while (currentX !== newX || currentY !== newY) {
            // Move one step towards destination
            if (currentX !== newX) currentX += stepX;
            if (currentY !== newY) currentY += stepY;
            
            // Check bounds
            if (currentX < 0 || currentX > 9 || currentY < 0 || currentY > 9) {
                return false;
            }
            
            const squareContent = this.board[currentY][currentX];
            
            // If this is the final destination
            if (currentX === newX && currentY === newY) {
                // Can land on empty square or opponent's monster (for combat)
                if (!squareContent || squareContent.owner !== playerId) {
                    return true;
                }
                // Cannot land on own monster
                return false;
            } else {
                // Intermediate squares: can pass over own monsters, but not opponents'
                if (squareContent && squareContent.owner !== playerId) {
                    return false; // Path blocked by opponent
                }
            }
        }

        return true;
    }

    /**
     * Move a monster on the board
     * @param {string} playerId - Player moving the monster
     * @param {string} monsterId - ID of monster to move
     * @param {number} newX - Target X coordinate
     * @param {number} newY - Target Y coordinate
     * @returns {Object} Success/failure result with message
     */
    moveMonster(playerId, monsterId, newX, newY) {
        // Concurrency control - prevent simultaneous actions
        if (this.actionLock) {
            return { success: false, message: "Another action is in progress. Please wait." };
        }
        this.actionLock = true;

        try {
            if (this.getCurrentPlayer() !== playerId) {
                return { success: false, message: "Not your turn." };
            }

            const player = this.players[playerId];
            const monsterIndex = player.monsters.findIndex(m => m.id === monsterId);
            if (monsterIndex === -1) {
                return { success: false, message: "Monster not found." };
            }

            const monster = player.monsters[monsterIndex];

            // FIXED: Check if this monster was just placed this turn
            if (this.turnActions[playerId]?.placedMonsterId === monsterId) {
                return { success: false, message: "You cannot move the monster you just placed this turn." };
            }

            // Check if this monster has already moved this turn
            if (this.turnActions[playerId]?.movedMonsters?.has(monsterId)) {
                return { success: false, message: "This monster has already moved this turn." };
            }

            if (!this.isValidMove(playerId, monster, newX, newY)) {
                return { success: false, message: "Invalid move (distance, obstacle, or out of bounds)." };
            }

            const oldX = monster.x;
            const oldY = monster.y;

            // Check destination square for conflicts *before* moving
            const destinationContent = this.board[newY][newX];

            // Update board: remove from old position, place in new position
            this.board[oldY][oldX] = null;
            this.board[newY][newX] = monster;

            // Update monster's position in player's list
            monster.x = newX;
            monster.y = newY;

            // Mark monster as moved this turn
            this.turnActions[playerId].movedMonsters.add(monsterId);

            console.log(`Player ${playerId} moved ${monster.type} (${monsterId}) from (${oldX}, ${oldY}) to (${newX}, ${newY})`);

            // Handle conflicts on the destination square
            if (destinationContent) {
                this.handleConflict(newX, newY, monster, destinationContent);
            }

            // Check for elimination and winner after potential conflict resolution
            const winner = this.checkForWinner();
            if (winner) {
                this.endGame(winner);
            }

            return { success: true, message: `Monster moved to (${newX}, ${newY}).` };
        } finally {
            this.actionLock = false; // Always release lock
        }
    }

    /**
     * Handle combat between two monsters on the same square
     * @param {number} x - X coordinate of conflict
     * @param {number} y - Y coordinate of conflict
     * @param {Object} movingMonster - Monster that just moved to this square
     * @param {Object} existingMonster - Monster that was already on this square
     */
    handleConflict(x, y, movingMonster, existingMonster) {
        // FIXED: Improved conflict handling logic
        if (!movingMonster || !existingMonster) {
            console.log(`Conflict check at (${x},${y}): Missing monster data.`);
            return;
        }

        // If same owner, this shouldn't happen due to movement validation
        if (movingMonster.owner === existingMonster.owner) {
            console.warn(`Conflict Warning at (${x},${y}): Same player monsters on same square - this should not happen.`);
            return;
        }

        const type1 = movingMonster.type;
        const type2 = existingMonster.type;
        let removedMonster = null;

        console.log(`Conflict at (${x}, ${y}): ${type1} (Player ${movingMonster.owner}) vs ${type2} (Player ${existingMonster.owner})`);

        // Apply combat rules
        if (type1 === type2) {
            // Same type monsters: both are removed
            console.log(` -> Both ${type1} monsters removed.`);
            this.removeMonster(movingMonster.id, movingMonster.owner);
            this.removeMonster(existingMonster.id, existingMonster.owner);
            return;
        }

        // Different types: apply rock-paper-scissors rules
        if ((type1 === "vampire" && type2 === "werewolf") || (type1 === "werewolf" && type2 === "vampire")) {
            removedMonster = (type2 === "werewolf") ? existingMonster : movingMonster;
            console.log(` -> Werewolf removed (vampire wins).`);
        } else if ((type1 === "werewolf" && type2 === "ghost") || (type1 === "ghost" && type2 === "werewolf")) {
            removedMonster = (type2 === "ghost") ? existingMonster : movingMonster;
            console.log(` -> Ghost removed (werewolf wins).`);
        } else if ((type1 === "ghost" && type2 === "vampire") || (type1 === "vampire" && type2 === "ghost")) {
            removedMonster = (type2 === "vampire") ? existingMonster : movingMonster;
            console.log(` -> Vampire removed (ghost wins).`);
        }

        if (removedMonster) {
            this.removeMonster(removedMonster.id, removedMonster.owner);
        }
    }

    /**
     * Remove a monster from the game
     * @param {string} monsterId - ID of monster to remove
     * @param {string} ownerId - Owner of the monster
     */
    removeMonster(monsterId, ownerId) {
        const player = this.players[ownerId];
        if (!player) return;

        const monsterIndex = player.monsters.findIndex(m => m.id === monsterId);
        if (monsterIndex === -1) return;

        const monster = player.monsters[monsterIndex];

        // Remove from board
        if (this.board[monster.y]?.[monster.x]?.id === monsterId) {
            this.board[monster.y][monster.x] = null;
        }

        // Remove from player list
        player.monsters.splice(monsterIndex, 1);
        player.monstersLost++;
        console.log(`Player ${ownerId} lost a ${monster.type}. Total lost: ${player.monstersLost}`);

        // Check elimination
        if (this.isPlayerEliminated(ownerId)) {
            console.log(`Player ${ownerId} has been eliminated!`);
        }
    }

    /**
     * End the current player's turn
     * @param {string} playerId - Player ending their turn
     * @returns {Object} Success/failure result with game state
     */
    endTurn(playerId) {
        if (this.getCurrentPlayer() !== playerId) {
            return { success: false, message: "Not your turn." };
        }

        // Move to the next player in the order
        this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.playerOrder.length;

        // Check if a round has ended (back to the first player)
        if (this.currentPlayerIndex === 0) {
            this.round++;
            console.log(`Starting Round ${this.round}`);
            // Determine next turn order based on fewest monsters
            this.playerOrder.sort((a, b) => {
                const countA = this.players[a] ? this.players[a].monsters.length : Infinity;
                const countB = this.players[b] ? this.players[b].monsters.length : Infinity;
                if (countA === countB) {
                    return Math.random() - 0.5; // Random tie-breaker
                }
                return countA - countB;
            });
            this.currentPlayerIndex = 0; // Start with the player with the fewest monsters
            console.log(`New turn order for Round ${this.round}: ${this.playerOrder.join(", ")}`);
        }

        // Skip eliminated players
        let skippedPlayers = 0;
        while (this.isPlayerEliminated(this.getCurrentPlayer()) && this.status === "active") {
            console.log(`Skipping eliminated player ${this.getCurrentPlayer()}`);
            this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.playerOrder.length;
            skippedPlayers++;
            
            // Prevent infinite loop
            if (skippedPlayers >= this.playerOrder.length) {
                const winner = this.checkForWinner();
                if (winner) {
                    this.endGame(winner);
                } else {
                    this.endGame(null); // Draw
                }
                return { success: true, gameState: this.getState() };
            }
        }

        // Reset actions for the *new* current player
        this.resetTurnActions(this.getCurrentPlayer());

        console.log(`Turn ended. Next player: ${this.getCurrentPlayer()}`);
        return { success: true, gameState: this.getState() };
    }

    /**
     * Check if a player is eliminated
     * @param {string} playerId - Player to check
     * @returns {boolean} True if player is eliminated
     */
    isPlayerEliminated(playerId) {
        return !this.players[playerId] || this.players[playerId].monstersLost >= 10;
    }

    /**
     * Check if there's a winner
     * @returns {string|null} Winner player ID or null if no winner yet
     */
    checkForWinner() {
        const activePlayers = this.playerOrder.filter(pid => !this.isPlayerEliminated(pid));
        if (activePlayers.length === 1 && this.playerOrder.length > 1) {
            return activePlayers[0]; // Winner found
        }
        return null; // No winner yet
    }

    /**
     * End the game
     * @param {string|null} winnerId - Winner player ID or null for draw
     */
    endGame(winnerId = null) {
        if (this.status === "finished") return; // Avoid ending multiple times

        this.status = "finished";
        this.winner = winnerId;
        console.log(`Game ${this.id} finished. Winner: ${winnerId || 'None (Draw/Abort)'}`);
    }

    /**
     * Get the current game state for clients
     * @param {string|null} requestingPlayerId - Player requesting the state (for future customization)
     * @returns {Object} Serializable game state
     */
    getState(requestingPlayerId = null) {
        return {
            id: this.id,
            players: Object.values(this.players).reduce((acc, p) => {
                acc[p.id] = {
                    id: p.id,
                    edge: p.edge,
                    monsterCount: p.monsters.length,
                    monstersLost: p.monstersLost,
                    isEliminated: this.isPlayerEliminated(p.id)
                };
                return acc;
            }, {}),
            board: this.board,
            currentPlayerId: this.getCurrentPlayer(),
            round: this.round,
            status: this.status,
            winner: this.winner,
            playerOrder: this.playerOrder,
            // Include turn action state for client UI
            turnActions: this.turnActions
        };
    }
}

module.exports = Game;

