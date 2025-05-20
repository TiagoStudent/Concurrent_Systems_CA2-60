const { v4: uuidv4 } = require("uuid");

class Game {
    constructor(gameId, creatorId) {
        this.id = gameId;
        this.players = {}; // { playerId: { id, edge, monsters: [], monstersLost: 0, hasPlacedMonsterThisTurn: false } }
        this.board = Array(10).fill(null).map(() => Array(10).fill(null)); // 10x10 grid { owner, type, id }
        this.playerOrder = []; // Array of playerIds in turn order
        this.currentPlayerIndex = 0;
        this.round = 1;
        this.availableEdges = ["top", "bottom", "left", "right"];
        this.status = "waiting"; // waiting, active, finished
        this.winner = null;
        this.turnActions = {}; // { playerId: { placedMonster: boolean, movedMonsters: Set<monsterId> } }

        this.addPlayer(creatorId);
    }

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
            monsters: [], // { id, type, x, y }
            monstersLost: 0,
        };
        this.playerOrder.push(playerId);

        console.log(`Player ${playerId} joined game ${this.id} on edge ${edge}`);
        return { success: true };
    }

    removePlayer(playerId) {
        if (!this.players[playerId]) {
            return; // Player not in this game
        }

        const edge = this.players[playerId].edge;
        this.availableEdges.push(edge); // Make edge available again
        this.availableEdges.sort((a, b) => ["top", "bottom", "left", "right"].indexOf(a) - ["top", "bottom", "left", "right"].indexOf(b)); // Keep original order

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
                 // Need to carefully advance turn *before* splicing
                 this.currentPlayerIndex = this.currentPlayerIndex % (this.playerOrder.length > 1 ? this.playerOrder.length -1 : 1);
            }
            this.playerOrder.splice(playerIndex, 1);
             // Adjust index if the removed player was before the current player in the array
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

    resetTurnActions(playerId = null) {
        if (playerId) {
            this.turnActions[playerId] = { placedMonster: false, movedMonsters: new Set() };
        } else {
            // Reset for all players (e.g., at start of round)
            this.playerOrder.forEach(pid => {
                this.turnActions[pid] = { placedMonster: false, movedMonsters: new Set() };
            });
        }
    }

    getCurrentPlayer() {
        if (this.status !== "active" || this.playerOrder.length === 0) {
            return null;
        }
        return this.playerOrder[this.currentPlayerIndex];
    }

    isValidPlacement(playerId, x, y) {
        const player = this.players[playerId];
        if (!player) return false;

        if (x < 0 || x > 9 || y < 0 || y > 9) return false; // Out of bounds
        if (this.board[y][x] !== null) return false; // Square occupied

        switch (player.edge) {
            case "top": return y === 0;
            case "bottom": return y === 9;
            case "left": return x === 0;
            case "right": return x === 9;
            default: return false;
        }
    }

    placeMonster(playerId, type, x, y) {
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
        this.turnActions[playerId].placedMonster = true; // Mark that a monster was placed

        console.log(`Player ${playerId} placed ${type} (${monsterId}) at (${x}, ${y})`);
        return { success: true, message: `Monster ${type} placed at (${x}, ${y}).` };
    }

    isValidMove(playerId, monster, newX, newY) {
        if (newX < 0 || newX > 9 || newY < 0 || newY > 9) return false; // Out of bounds

        const dx = Math.abs(newX - monster.x);
        const dy = Math.abs(newY - monster.y);

        // Check movement type
        const isDiagonal = dx > 0 && dy > 0;
        const isStraight = (dx > 0 && dy === 0) || (dx === 0 && dy > 0);

        if (!isStraight && !isDiagonal) return false; // No movement
        if (isDiagonal && (dx > 2 || dy > 2)) return false; // Diagonal limit is 2 squares

        // Check path for obstacles (other players' monsters)
        // This requires checking intermediate squares
        let currentX = monster.x;
        let currentY = monster.y;
        const stepX = Math.sign(newX - currentX);
        const stepY = Math.sign(newY - currentY);
        const steps = Math.max(dx, dy);

        for (let i = 1; i <= steps; i++) {
            let checkX = currentX + stepX * (isStraight && dx > 0 || isDiagonal ? i : 0);
            let checkY = currentY + stepY * (isStraight && dy > 0 || isDiagonal ? i : 0);

            // Adjust for diagonal steps beyond 1
             if (isDiagonal) {
                 checkX = currentX + stepX * Math.min(i, dx);
                 checkY = currentY + stepY * Math.min(i, dy);
             }

            if (checkX < 0 || checkX > 9 || checkY < 0 || checkY > 9) continue; // Should not happen if bounds check passed, but safety first

            const squareContent = this.board[checkY][checkX];

            // Cannot land on own monster (unless it's the final square, handled later)
            if (i < steps && squareContent && squareContent.owner === playerId) {
                 // Allow moving *over* own monsters
                 continue;
            }

            // Cannot move over or onto other player's monsters
            if (squareContent && squareContent.owner !== playerId) {
                return false; // Path blocked
            }

             // Check landing square specifically
             if (i === steps) {
                 if (squareContent && squareContent.owner !== playerId) {
                     return false; // Cannot land on opponent's monster square
                 }
             }
        }

        return true;
    }

    moveMonster(playerId, monsterId, newX, newY) {
        if (this.getCurrentPlayer() !== playerId) {
            return { success: false, message: "Not your turn." };
        }

        const player = this.players[playerId];
        const monsterIndex = player.monsters.findIndex(m => m.id === monsterId);
        if (monsterIndex === -1) {
            return { success: false, message: "Monster not found." };
        }

        const monster = player.monsters[monsterIndex];

        // Check if this monster was just placed this turn
        if (this.turnActions[playerId]?.placedMonster && this.board[monster.y]?.[monster.x]?.id === monsterId) {
             // This check might be tricky if IDs match but it wasn't the one placed.
             // A better check might be needed, perhaps storing the ID of the placed monster.
             // For now, assume if a monster exists at the original placement coords and was placed this turn, it can't move.
             // Let's refine: Check if the monster *object* is the one that was placed.
             // This requires storing the placed monster object/ID in turnActions.
             // Let's simplify: The rules say "They may not move *that* monster this turn."
             // We need to track which monster ID was placed.
             // Let's add `placedMonsterId` to `turnActions`
             if (this.turnActions[playerId]?.placedMonsterId === monsterId) {
                 return { success: false, message: "You cannot move the monster you just placed this turn." };
             }
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
        this.board[newY][newX] = monster; // Place monster temporarily

        // Update monster's position in player's list
        monster.x = newX;
        monster.y = newY;

        // Mark monster as moved this turn
        this.turnActions[playerId].movedMonsters.add(monsterId);

        console.log(`Player ${playerId} moved ${monster.type} (${monsterId}) from (${oldX}, ${oldY}) to (${newX}, ${newY})`);

        // Handle conflicts on the destination square
        if (destinationContent) {
            // If the destination had one of the player's own monsters, they moved onto it.
            this.handleConflict(newX, newY, playerId, destinationContent); // Pass the monster that was there before
        } else {
             // Check if other monsters moved to the same square in the same turn (less common, maybe handle later)
        }

        // Check for elimination and winner after potential conflict resolution
        const winner = this.checkForWinner();
        if (winner) {
            this.endGame(winner);
        }

        return { success: true, message: `Monster moved to (${newX}, ${newY}).` };
    }

    handleConflict(x, y, movingPlayerId, existingMonster) {
        const movingMonster = this.board[y][x]; // The monster that just arrived
        if (!movingMonster || !existingMonster || movingMonster.owner === existingMonster.owner) {
            // If moving onto own square, or something went wrong
            if (movingMonster && existingMonster && movingMonster.owner === existingMonster.owner) {
                 // Rule: If two of the same kind of monster, both are removed
                 if (movingMonster.type === existingMonster.type) {
                     console.log(`Conflict at (${x},${y}): Two ${movingMonster.type} from player ${movingMonster.owner}. Both removed.`);
                     this.removeMonster(movingMonster.id, movingMonster.owner);
                     this.removeMonster(existingMonster.id, existingMonster.owner);
                 } else {
                     // Landed on own monster of different type - this shouldn't happen based on isValidMove
                     console.warn(`Conflict Warning at (${x},${y}): Player ${movingPlayerId} landed on own different monster ${existingMonster.type}.`);
                 }
            } else {
                 console.log(`Conflict check at (${x},${y}): No conflict or self-conflict.`);
            }
            return;
        }

        const type1 = movingMonster.type;
        const type2 = existingMonster.type;
        let removedMonster = null;
        let removedPlayerId = null;

        console.log(`Conflict at (${x}, ${y}): ${type1} (Player ${movingMonster.owner}) vs ${type2} (Player ${existingMonster.owner})`);

        if ((type1 === "vampire" && type2 === "werewolf") || (type1 === "werewolf" && type2 === "vampire")) {
            removedMonster = (type1 === "werewolf") ? movingMonster : existingMonster;
            console.log(` -> Werewolf removed.`);
        } else if ((type1 === "werewolf" && type2 === "ghost") || (type1 === "ghost" && type2 === "werewolf")) {
            removedMonster = (type1 === "ghost") ? movingMonster : existingMonster;
            console.log(` -> Ghost removed.`);
        } else if ((type1 === "ghost" && type2 === "vampire") || (type1 === "vampire" && type2 === "ghost")) {
            removedMonster = (type1 === "vampire") ? movingMonster : existingMonster;
            console.log(` -> Vampire removed.`);
        }

        if (removedMonster) {
            this.removeMonster(removedMonster.id, removedMonster.owner);
        } else {
            console.log(" -> No conflict resolution needed (e.g., different owners, same type - should not happen based on move logic).");
        }
    }

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
            // Player is kept in players{} but marked as eliminated (implicitly by monstersLost >= 10)
            // They should be removed from turn order effectively, or skipped.
            // Let's handle skipping in endTurn.
        }
    }

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
        while (this.isPlayerEliminated(this.getCurrentPlayer()) && this.status === "active") {
             console.log(`Skipping eliminated player ${this.getCurrentPlayer()}`);
             this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.playerOrder.length;
             // Check if skipping caused a round end unexpectedly
             if (this.currentPlayerIndex === 0) {
                 // This indicates all remaining players might be eliminated, or only one is left.
                 // Check for winner again.
                 const winner = this.checkForWinner();
                 if (winner) {
                     this.endGame(winner);
                     return { success: true, gameState: this.getState() }; // Return state immediately on game end
                 } else if (this.playerOrder.filter(pid => !this.isPlayerEliminated(pid)).length === 0) {
                     // All players eliminated simultaneously? Draw?
                     this.endGame(null);
                     return { success: true, gameState: this.getState() };
                 }
                 // If not ended, proceed to the next round logic (which might have already run)
                 // This logic might need refinement if skipping causes infinite loops in edge cases.
             }
        }

        // Reset actions for the *new* current player
        this.resetTurnActions(this.getCurrentPlayer());

        console.log(`Turn ended. Next player: ${this.getCurrentPlayer()}`);
        return { success: true, gameState: this.getState() };
    }

    isPlayerEliminated(playerId) {
        // A player might be removed entirely if they disconnect.
        // If they are still in the game, check their lost count.
        return !this.players[playerId] || this.players[playerId].monstersLost >= 10;
    }

    checkForWinner() {
        const activePlayers = this.playerOrder.filter(pid => !this.isPlayerEliminated(pid));
        if (activePlayers.length === 1 && this.playerOrder.length > 1) { // Need > 1 player initially to have a winner
            return activePlayers[0]; // Winner found
        }
        return null; // No winner yet
    }

    endGame(winnerId = null) {
        if (this.status === "finished") return; // Avoid ending multiple times

        this.status = "finished";
        this.winner = winnerId;
        console.log(`Game ${this.id} finished. Winner: ${winnerId || 'None (Draw/Abort)'}`);
        // Stats update will be handled in server.js based on this state
    }

    getState(requestingPlayerId = null) {
        // Return a serializable representation of the game state for clients
        // We might want to tailor the state slightly based on the requesting player if needed
        return {
            id: this.id,
            // Filter player data to avoid sending excessive info if needed
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
            // Include turn action state if useful for client UI?
            // turnActions: this.turnActions
        };
    }
}

module.exports = Game;

