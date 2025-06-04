# 
Monster Mayhem – Multiplayer Board Game

## 📖 About the Project

Monster Mayhem is a web-based multiplayer board game developed as part of a Concurrent Systems assignment. The game implements a robust client-server architecture with real-time communication, supporting multiple simultaneous games and up to 4 players per match.

### ✅ Public Demo Available:
To make multiplayer testing easier, a live version of the game is hosted on Render:

## 🔗 Play Now: https://monster-mayhem-server.onrender.com

⸻

### 🎮 Key Features
	•	Real-Time Multiplayer: Up to 4 players per game
	•	Multiple Concurrent Matches: Server supports multiple ongoing games
	•	Modern Interface: Responsive and visually appealing design
	•	Real-Time Stats: Tracks wins, losses, and global gameplay data
	•	Concurrency Handling: Race condition prevention and validation
	•	Auto-Reconnect: Smart handling of player disconnections

## 🎯 Game Rules

### Objective

Be the last remaining player by eliminating enemy monsters through strategic combat.

### Basic Mechanics

### Board
	•	10x10 grid, with each player owning one edge (Top, Bottom, Left, or Right)

### Monsters
	•	🧛 Vampire: Beats Ghost, loses to Werewolf
	•	🐺 Werewolf: Beats Vampire, loses to Ghost
	•	👻 Ghost: Beats Werewolf, loses to Vampire

### Turns
	1.	Player with the fewest monsters on the board goes first
	2.	If tied, turn order is random
	3.	On their turn, a player can:
	•	Place ONE monster on their border
	•	Move any number of existing monsters
	•	Newly placed monsters cannot be moved the same turn

### Movement
	•	Horizontal/Vertical: Unlimited range
	•	Diagonal: Max 2 squares
	•	Can move through friendly monsters
	•	Cannot move through enemy monsters

### Combat

When two monsters land on the same cell:
	•	Vampire vs Werewolf → Werewolf is removed
	•	Werewolf vs Ghost → Ghost is removed
	•	Ghost vs Vampire → Vampire is removed
	•	Same type → Both are removed

### Win/Lose Conditions
	•	Elimination: Player loses when 10 of their monsters are removed
	•	Victory: Last remaining player wins
	•	Round Ends: When all players have taken their turn

## 🚀 Installation & Execution

### Requirements
	•	Node.js 18+
	•	npm or yarn
	•	Modern web browser

### Steps
	1.	Clone or Extract the Project

### cd monster-mayhem_en_final

	2.	Install Server Dependencies

cd server
npm install

	3.	Start the Server

npm start

	4.	Access the Game

	•	Open your browser
	•	Go to http://localhost:3000
	•	To test multiplayer, open multiple tabs or browser windows

Advanced Configuration

## Environment Variables

Create a .env file inside server/:

PORT=3000
NODE_ENV=production

#### Network Configuration

By default, the server listens on 0.0.0.0:3000, allowing access from other devices on the same network.

## 🏗️ System Architecture

## Overview

┌──────────────┐    WebSocket    ┌──────────────┐
│  Web Client  │ ←──────────────→ │ Node Server  │
│ (HTML/CSS/JS)│                 │ (Express + IO)│
└──────────────┘                 └──────────────┘
                                       │
                                       ▼
                               ┌──────────────┐
                               │ Game Logic   │
                               │  (Game Class)│
                               └──────────────┘

## Key Components

1. Server (server/server.js)
	•	Express.js: Serves static files
	•	Socket.IO: Real-time WebSocket communication
	•	Game & Player Management
	•	Concurrency Control: Locks and validations

2. Game Logic (server/game.js)
	•	Game Class: Implements all game rules
	•	Movement Validation
	•	Combat System
	•	Turn Management

3. Client (client/)
	•	Responsive UI: Modern HTML5 + CSS3
	•	Interactive: Vanilla JavaScript with Socket.IO
	•	Visual Feedback: Real-time animations and indicators
	•	State Sync: Client-server synchronization

## 🔧 Concurrency Issues

### Identified Problems & Solutions

1. Race Conditions in Game Actions

Problem: Multiple simultaneous actions may corrupt game state.

Solution:

class Game {
    constructor() {
        this.actionLock = false;
    }

    placeMonster(playerId, type, x, y) {
        if (this.actionLock) {
            return { success: false, message: "Action in progress" };
        }
        this.actionLock = true;
        try {
            // Execute logic
        } finally {
            this.actionLock = false;
        }
    }
}

2. Concurrent Stats Update

Problem: Global stats can be corrupted by concurrent updates.

Solution:

let statsLock = false;

function safeStatsUpdate(updateFunction) {
    if (statsLock) return;
    statsLock = true;
    try {
        updateFunction();
    } finally {
        statsLock = false;
    }
}

3. State Synchronization

Problem: Client state may become out of sync with the server.

Solution:
	•	Server-side validation of all actions
	•	Broadcast updated state after every change
	•	Auto-reconnect with resync

Strategies Used
	1.	Event Serialization: Socket.IO queues events per client
	2.	Optimistic Locking: Validate before applying actions
	3.	Atomic Operations: All-or-nothing logic blocks
	4.	State Validation: Continuous integrity checks

## 📊 Data Structure

### Game State

{
  id: "uuid",
  players: {
    "playerId": {
      id: "playerId",
      edge: "top|bottom|left|right",
      monsters: [{ id, type, x, y, owner }],
      monstersLost: 0
    }
  },
  board: Array(10).fill(Array(10).fill(null)),
  playerOrder: ["playerId1", "playerId2"],
  currentPlayerIndex: 0,
  round: 1,
  status: "waiting|active|finished",
  winner: "playerId|null"
}

## Client-Server Communication

###Client → Server Events
	•	create_game
	•	join_game
	•	start_game
	•	game_action
	•	request_lobby_data

### Server → Client Events
	•	initial_data
	•	available_games
	•	game_joined
	•	game_update
	•	game_started
	•	game_over
	•	stats_update
	•	error_message

### 🧪 Testing & Validation

### Test Scenarios
	1.	Load Test: Many concurrent games
	2.	Concurrency Test: Multiple players acting simultaneously
	3.	Disconnect Test: Handling unexpected disconnections
	4.	Rules Test: Validating all rule logic
	5.	UI Test: Responsiveness and user feedback

### How to Test
	1.	Local:
	•	Open multiple browser tabs
	•	Simulate different players
	2.	Network:
	•	Connect from different devices
	•	Test http://[SERVER_IP]:3000
	3.	Stress:
	•	Start multiple games
	•	Simulate disconnects/reconnects

## 🐛 Fixed Bugs

1. Moving Just-Placed Monsters

Fix: Used placedMonsterId to block movement in the same turn.

2. Diagonal Movement Validation

Fix: Refactored isValidMove for accuracy.

3. Combat Conflicts

Fix: Fully implemented clear combat rules.

4. Race Conditions

Fix: Added locks and atomic validations.

## 📈 Improvements

## UI
	•	✅ Modern responsive layout
	•	✅ Smooth animations
	•	✅ Move validation indicators
	•	✅ Toast notifications
	•	✅ Loading states
	•	✅ Dark/light theme support

## Features
	•	✅ Visual monster selection
	•	✅ Valid cell highlights
	•	✅ Real-time message log
	•	✅ Detailed stats
	•	✅ Auto-reconnect

## Performance
	•	✅ Render optimization
	•	✅ Event debounce
	•	✅ Lazy loading assets
	•	✅ Data compression

## 🔮 Future Features
	•	🔄 Data persistence (database)
	•	👥 Global ranking system
	•	🎥 Game replay
	•	👀 Spectator mode
	•	🤖 AI opponents
	•	🏆 Achievements system
	•	💬 Real-time chat
	•	🎨 Customizable themes

## 👥 Contributing

### How to Contribute
	1.	Fork the repo
	2.	Create a feature branch (git checkout -b feature/AmazingFeature)
	3.	Commit changes (git commit -m 'Add AmazingFeature')
	4.	Push to your branch (git push origin feature/AmazingFeature)
	5.	Open a Pull Request

### Code Guidelines
	•	Use ESLint for JavaScript
	•	Follow existing naming conventions
	•	Comment complex logic
	•	Test all changes before submitting

## 📄 License

This project was developed as an academic assignment for the Concurrent Systems course.

## 🙏 Acknowledgements
	•	CCT College Dublin – For the learning opportunity
	•	Professor Sam Weiss – For guidance and mentorship
	•	Socket.IO Team – For the real-time communication library
	•	Express.js Team – For the solid web framework

## 📞 Support

For questions or issues:
	1.	Check the Troubleshooting section
	2.	Review server logs
	3.	Open an issue in the repository

⸻

Made with ❤️ for the Concurrent Systems subject

