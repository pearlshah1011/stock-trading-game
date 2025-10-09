const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const XLSX = require('xlsx');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static('public'));

let players = {};
let gameSettings = {
    initialCash: 1000000,
    maxPlayers: 20,
    currentRound: 1,
    tradingOpen: true,
    currentNews: "Welcome to the Stock Trading Adventure! A new game is starting."
};

let fullStockData = [];
let activeStockData = [];

function loadStockDataFromExcel() {
    try {
        const filePath = 'companies.xlsx';
        if (!fs.existsSync(filePath)) {
            console.error("ERROR: companies.xlsx not found!");
            process.exit(1);
        }
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet);

        fullStockData = data.map(row => {
            const prices = [];
            for (const key in row) {
                if (key.startsWith('Round') && key.endsWith('Price')) {
                    const roundNum = parseInt(key.match(/\d+/)[0]);
                    prices[roundNum - 1] = row[key];
                }
            }
            return { name: row.CompanyName, initialQuantity: row.InitialQuantity, prices: prices };
        });
        console.log("Successfully loaded stock data from companies.xlsx");
        updateActiveStockDataForRound(gameSettings.currentRound);
    } catch (error) {
        console.error("Failed to load or parse companies.xlsx:", error);
        process.exit(1);
    }
}

function updateActiveStockDataForRound(round) {
    const roundIndex = round - 1;
    // If resetting the game, ensure we use the initial quantities
    const sourceData = activeStockData.length === 0 ? fullStockData : activeStockData;

    activeStockData = fullStockData.map(stock => {
        const currentStock = sourceData.find(s => s.name === stock.name);
        const quantity = currentStock ? (currentStock.quantity !== undefined ? currentStock.quantity : stock.initialQuantity) : stock.initialQuantity;
        return {
            name: stock.name,
            price: stock.prices[roundIndex] || 0,
            previousPrice: roundIndex > 0 ? stock.prices[roundIndex - 1] : stock.prices[roundIndex],
            quantity: quantity
        };
    });
    console.log(`Updated active stock prices for Round ${round}`);
}

// --- WebSocket Server Logic ---
let adminWs = null;
wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        const data = JSON.parse(message);
        if (data.type === 'register_admin' && data.secret === 'gamemaster123') {
            adminWs = ws;
            ws.isAdmin = true;
            console.log('Game Master connected.');
            ws.send(JSON.stringify({ type: 'admin_ok' }));
            broadcastGameState();
            return;
        }
        if (ws.isAdmin) handleAdminCommands(data);
        else handlePlayerCommands(ws, data);
    });
    ws.on('close', () => {
        if (ws.isAdmin) {
            adminWs = null;
            console.log('Game Master disconnected.');
        } else if (ws.id) {
            delete players[ws.id];
            broadcastGameState();
        }
    });
});

function handlePlayerCommands(ws, data) {
    switch (data.type) {
        case 'register': registerPlayer(ws, data.nickname); break;
        case 'buy': if (gameSettings.tradingOpen) handleBuy(ws.id, data.stockName, data.quantity); break;
        case 'sell': if (gameSettings.tradingOpen) handleSell(ws.id, data.stockName, data.quantity); break;
    }
}

function handleAdminCommands(data) {
    switch (data.type) {
        case 'broadcast_news': gameSettings.currentNews = data.message; break;
        case 'toggle_trading':
            gameSettings.tradingOpen = !gameSettings.tradingOpen;
            gameSettings.currentNews = `--- Trading is now ${gameSettings.tradingOpen ? "OPEN" : "CLOSED"} ---`;
            break;
        case 'advance_round':
            gameSettings.currentRound++;
            updateActiveStockDataForRound(gameSettings.currentRound);
            gameSettings.tradingOpen = true;
            gameSettings.currentNews = `--- Round ${gameSettings.currentRound} has begun! ---`;
            break;
        case 'delete_player':
            const playerToDelete = Object.values(players).find(p => p.nickname === data.nickname);
            if (playerToDelete) {
                wss.clients.forEach(client => {
                    if (client.id === playerToDelete.id) {
                        client.send(JSON.stringify({ type: 'kicked', message: 'The Game Master has removed you from the game.' }));
                        client.close();
                    }
                });
                delete players[playerToDelete.id];
            }
            break;
        // --- NEW FEATURE: Reset Game Logic ---
        case 'reset_game':
            // Notify all players that the game is ending
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN && !client.isAdmin) {
                    client.send(JSON.stringify({ type: 'game_over', message: 'The Game Master has ended the game. You will be returned to the main screen.' }));
                    client.close();
                }
            });
            // Reset all game state variables
            players = {};
            gameSettings.currentRound = 1;
            gameSettings.tradingOpen = true;
            gameSettings.currentNews = "Welcome! A new game is starting.";
            // Force a full reset of stock quantities
            activeStockData = [];
            updateActiveStockDataForRound(1);
            break;
    }
    broadcastGameState();
}

function registerPlayer(ws, nickname) {
    if (Object.values(players).some(p => p.nickname === nickname)) {
        ws.send(JSON.stringify({ type: 'error', message: 'This nickname is already taken.' }));
        ws.close();
        return;
    }
    const playerId = Date.now().toString();
    ws.id = playerId;
    players[playerId] = { id: playerId, nickname, cash: gameSettings.initialCash, portfolio: {} };
    ws.send(JSON.stringify({ type: 'registered', playerId }));
    broadcastGameState();
}

function handleBuy(playerId, stockName, quantity) {
    const player = players[playerId];
    const stock = activeStockData.find(s => s.name === stockName);
    if (!player || !stock || quantity <= 0) return;
    const cost = stock.price * quantity;
    if (player.cash >= cost && stock.quantity >= quantity) {
        player.cash -= cost;
        stock.quantity -= quantity;
        player.portfolio[stockName] = (player.portfolio[stockName] || 0) + Number(quantity);
        broadcastGameState();
    }
}

function handleSell(playerId, stockName, quantity) {
    const player = players[playerId];
    const stock = activeStockData.find(s => s.name === stockName);
    if (!player || !stock || quantity <= 0 || !player.portfolio[stockName] || player.portfolio[stockName] < quantity) return;
    const earnings = stock.price * quantity;
    player.cash += earnings;
    stock.quantity += Number(quantity);
    player.portfolio[stockName] -= Number(quantity);
    if (player.portfolio[stockName] === 0) delete player.portfolio[stockName];
    broadcastGameState();
}

function broadcastGameState() {
    const leaderboard = Object.values(players).map(player => {
        let stockValue = 0;
        for (const stockName in player.portfolio) {
            const stock = activeStockData.find(s => s.name === stockName);
            if (stock) stockValue += player.portfolio[stockName] * stock.price;
        }
        return { nickname: player.nickname, totalValue: player.cash + stockValue };
    }).sort((a, b) => b.totalValue - a.totalValue);

    const gameState = {
        type: 'update',
        players,
        stockData: activeStockData,
        fullStockData: fullStockData,
        gameSettings,
        leaderboard
    };

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(gameState));
        }
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
    loadStockDataFromExcel();
});