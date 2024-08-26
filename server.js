const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let gameState = null;
let moveHistory = [];

function initializeGame() {
    gameState = {
        board: Array(5).fill(null).map(() => Array(5).fill(null)),
        players: {
            A: { pieces: [] },
            B: { pieces: [] },
        },
        currentPlayer: 'A',
    };
    moveHistory = [];
}

function resetGame() {
    initializeGame();
    broadcast({
        type: 'update',
        gameState,
    });
}

wss.on('connection', (ws) => {
    if (!gameState) initializeGame();

    ws.send(JSON.stringify({
        type: 'init',
        gameState,
    }));

    ws.on('message', (message) => {
        const parsedMessage = JSON.parse(message);

        if (parsedMessage.type === 'setup') {
            handleSetup(parsedMessage.data, ws);
        } else if (parsedMessage.type === 'move') {
            handleMove(parsedMessage.data, ws);
        } else if (parsedMessage.type === 'reset') {
            resetGame();
        }
    });
});

function handleSetup(data, ws) {
    const { setupPositions } = data;
    const player = gameState.currentPlayer;

    if (gameState.players[player].pieces.length > 0) {
        ws.send(JSON.stringify({ type: 'error', message: 'Setup already completed.' }));
        return;
    }

    gameState.players[player].pieces = setupPositions.map((piece, index) => {
        const row = player === 'A' ? 0 : 4;
        const col = index;
        gameState.board[row][col] = `${player}-${piece}`;
        return { name: piece, row, col };
    });

    // Switch to the other player for setup
    gameState.currentPlayer = player === 'A' ? 'B' : 'A';

    // If both players have finished setup, switch back to player A to start the game
    if (gameState.players.A.pieces.length > 0 && gameState.players.B.pieces.length > 0) {
        gameState.currentPlayer = 'A';
    }

    broadcast({
        type: 'update',
        gameState,
    });
}

function handleMove(data, ws) {
    const { character, move } = data;
    const player = gameState.currentPlayer;

    const piece = findPiece(player, character);

    if (!piece) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid character.' }));
        return;
    }

    const validMove = processMove(player, character, move);
    if (!validMove) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid move.' }));
        return;
    }

    // Check if game over
    if (gameState.players['A'].pieces.length === 0 || gameState.players['B'].pieces.length === 0) {
        const winner = gameState.players['A'].pieces.length === 0 ? 'B' : 'A';
        broadcast({
            type: 'end',
            winner,
        });
        initializeGame();
        return;
    }

    // Switch turns
    gameState.currentPlayer = player === 'A' ? 'B' : 'A';

    broadcast({
        type: 'update',
        gameState,
    });

    // Send move history
    broadcast({
        type: 'moveHistory',
        data: moveHistory,
    });
}

function findPiece(player, character) {
    return gameState.players[player].pieces.find(p => p.name === character.split('-')[1]);
}

function processMove(player, character, move) {
    const directions = {
        'L': [0, -1],
        'R': [0, 1],
        'F': player === 'A' ? [1, 0] : [-1, 0],
        'B': player === 'A' ? [-1, 0] : [1, 0],
        'FL': player === 'A' ? [1, -1] : [-1, 1],
        'FR': player === 'A' ? [1, 1] : [-1, -1],
        'BL': player === 'A' ? [-1, -1] : [1, 1],
        'BR': player === 'A' ? [-1, 1] : [1, -1],
    };

    // Find the character's current position
    let from;
    for (let x = 0; x < 5; x++) {
        for (let y = 0; y < 5; y++) {
            if (gameState.board[x][y] === character) {
                from = [x, y];
            }
        }
    }

    if (!from) return false;

    const to = [from[0] + directions[move][0], from[1] + directions[move][1]];
    if (to[0] < 0 || to[0] >= 5 || to[1] < 0 || to[1] >= 5) return false;

    let moved = false;
    switch (character.split('-')[1][0]) {
        case 'P': moved = movePawn(from, to); break;
        case 'H':
            moved = character.endsWith('1')
                ? moveHero1(from, to)
                : moveHero2(from, to);
            break;
        default: return false;
    }

    if (moved) {
        // Add move to history
        const moveDesc = `${player}-${character.split('-')[1]}: ${move}`;
        moveHistory.push(moveDesc);

        // Broadcast the updated move history to all players
        broadcast({
            type: 'moveHistory',
            data: moveHistory
        });
    }

    return moved;
}

function movePawn(from, to) {
    const [x, y] = to;
    if (gameState.board[x][y] && gameState.board[x][y][0] === gameState.currentPlayer) {
        return false;
    }

    // Move pawn and capture if needed
    gameState.board[to[0]][to[1]] = gameState.board[from[0]][from[1]];
    gameState.board[from[0]][from[1]] = null;

    capturePiece(to);

    return true;
}

function moveHero1(from, to) {
    const [x, y] = to;
    if (gameState.board[x][y] && gameState.board[x][y][0] === gameState.currentPlayer) {
        return false;
    }

    // Move hero1 and capture in the straight path
    const [fx, fy] = from;
    const dx = Math.sign(x - fx);
    const dy = Math.sign(y - fy);

    for (let i = 1; i <= 2; i++) {
        const nx = fx + i * dx;
        const ny = fy + i * dy;
        if (nx < 0 || nx >= 5 || ny < 0 || ny >= 5) return false;
        if (gameState.board[nx][ny] && gameState.board[nx][ny][0] !== gameState.currentPlayer) {
            capturePiece([nx, ny]);
        }
    }

    gameState.board[x][y] = gameState.board[from[0]][from[1]];
    gameState.board[from[0]][from[1]] = null;

    return true;
}

function moveHero2(from, to) {
    const [x, y] = to;
    if (gameState.board[x][y] && gameState.board[x][y][0] === gameState.currentPlayer) {
        return false;
    }

    // Move hero2 and capture in the diagonal path
    const [fx, fy] = from;
    const dx = Math.sign(x - fx);
    const dy = Math.sign(y - fy);

    for (let i = 1; i <= 2; i++) {
        const nx = fx + i * dx;
        const ny = fy + i * dy;
        if (nx < 0 || nx >= 5 || ny < 0 || ny >= 5) return false;
        if (gameState.board[nx][ny] && gameState.board[nx][ny][0] !== gameState.currentPlayer) {
            capturePiece([nx, ny]);
        }
    }

    gameState.board[x][y] = gameState.board[from[0]][from[1]];
    gameState.board[from[0]][from[1]] = null;

    return true;
}

function capturePiece(position) {
    const [x, y] = position;
    const character = gameState.board[x][y];
    if (character) {
        const player = character[0];
        gameState.players[player].pieces = gameState.players[player].pieces.filter(p => p.row !== x || p.col !== y);
        gameState.board[x][y] = null;
    }
}

function broadcast(message) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

server.listen(9000, () => {
    console.log('Server is listening on port 9000');
});
