// public/main.js

document.addEventListener('DOMContentLoaded', () => {
    // --- SETUP ---
    const playerColor = localStorage.getItem('playerColor');
    if (!playerColor) {
        // If no player color is chosen, send them back to the selection screen
        window.location.href = 'index.html';
        return;
    }
    document.getElementById('player-nickname').textContent = playerColor;
    document.body.classList.add(`theme-${playerColor.toLowerCase()}`); // Optional: for styling

    // Chart.js Instances
    const portfolioCtx = document.getElementById('portfolioChart').getContext('2d');
    const historyCtx = document.getElementById('historyChart').getContext('2d');
    let portfolioChart = null;
    let historyChart = null;

    // --- WEBSOCKET CONNECTION ---
    const host = window.location.host;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${host}`);
    
    // --- MODIFICATION: Claim player on connect ---
    ws.onopen = () => ws.send(JSON.stringify({ type: 'claim_player', playerColor: playerColor }));

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        switch (data.type) {
            case 'claimed': console.log(`Successfully claimed player: ${data.playerColor}`); break;
            case 'update': updateGameState(data); break;
            case 'error':
            case 'kicked':
            case 'game_over':
                alert(data.message);
                localStorage.removeItem('playerColor'); // Clear player choice
                window.location.href = 'index.html';
                break;
        }
    };
    ws.onerror = (error) => console.error('WebSocket Error:', error);

    // --- SVG ICONS ---
    const arrowUpSVG = `<svg class="arrow-up" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path d="M12 8l-6 6h12z"/></svg>`;
    const arrowDownSVG = `<svg class="arrow-down" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path d="M12 16l6-6H6z"/></svg>`;

    // --- UI UPDATE FUNCTIONS ---
    function updateGameState(gameState) {
        // --- MODIFICATION: Find player by color ---
        const myPlayer = gameState.players[playerColor];
        if (!myPlayer) return;

        updateStockTable(gameState.stockData, gameState.gameSettings.tradingOpen, myPlayer.portfolio);
        updatePortfolio(myPlayer, gameState.stockData);
        updateGameStatus(gameState.gameSettings);
        updateNews(gameState.gameSettings.currentNews);
        updateHistoryChart(gameState.fullStockData, gameState.gameSettings.currentRound);
    }

    function updateGameStatus(gameSettings) {
        document.getElementById('round-info').textContent = `Round: ${gameSettings.currentRound}`;
        const statusEl = document.getElementById('trading-status-info');
        const isOpen = gameSettings.tradingOpen;
        statusEl.textContent = `Trading: ${isOpen ? "OPEN" : "CLOSED"}`;
        statusEl.className = isOpen ? 'status-open' : 'status-closed';
    }

    function updateNews(message) {
        const newsTicker = document.getElementById('news-ticker');
        newsTicker.textContent = message || '';
        newsTicker.style.display = message ? 'block' : 'none';
    }

    function updateStockTable(stocks, tradingOpen, playerPortfolio) {
        const tableBody = document.getElementById('stock-table');
        tableBody.innerHTML = '';
        stocks.forEach(stock => {
            const row = document.createElement('tr');
            const hasStock = playerPortfolio && playerPortfolio[stock.name] > 0;
            const tradeDisabled = !tradingOpen ? 'disabled' : '';
            const sellDisabled = !hasStock || !tradingOpen ? 'disabled' : '';

            let priceChangeClass = 'price-same';
            let priceIcon = '';
            if (stock.price > stock.previousPrice) {
                priceChangeClass = 'price-up';
                priceIcon = arrowUpSVG;
            } else if (stock.price < stock.previousPrice) {
                priceChangeClass = 'price-down';
                priceIcon = arrowDownSVG;
            }

            row.innerHTML = `
                <td data-label="Company">${stock.name}</td>
                <td data-label="Price (INR)" class="price-cell ${priceChangeClass}">
                    <span>${stock.price}</span> ${priceIcon}
                </td>
                <td data-label="Available">${stock.quantity}</td>
                <td data-label="Quantity" class="quantity-cell"><input type="number" min="1" class="quantity-input" placeholder="0" ${tradeDisabled}></td>
                <td data-label="Actions" class="actions-cell">
                    <div class="buy-sell-wrapper">
                        <button class="buy-btn" ${tradeDisabled}>Buy</button>
                        <button class="sell-btn" ${sellDisabled}>Sell</button>
                    </div>
                </td>
            `;
            tableBody.appendChild(row);

            const quantityInput = row.querySelector('.quantity-input');
            
            row.querySelector('.buy-btn').addEventListener('click', () => {
                const quantity = parseInt(quantityInput.value, 10);
                if (quantity > 0) {
                    ws.send(JSON.stringify({ type: 'buy', stockName: stock.name, quantity: quantity }));
                    quantityInput.value = '';
                }
            });

            row.querySelector('.sell-btn').addEventListener('click', () => {
                const quantity = parseInt(quantityInput.value, 10);
                if (quantity > 0) {
                    ws.send(JSON.stringify({ type: 'sell', stockName: stock.name, quantity: quantity }));
                    quantityInput.value = '';
                }
            });
        });
    }

    function updatePortfolio(player, stockData) {
        if (!player) return;
        document.getElementById('cash-balance').textContent = player.cash.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 });
        const stockList = document.getElementById('owned-stocks');
        const ownedStocks = Object.keys(player.portfolio).filter(key => player.portfolio[key] > 0);
        stockList.innerHTML = '';
        if (ownedStocks.length === 0) {
            stockList.innerHTML = '<li class="empty-list">You do not own any stocks.</li>';
        } else {
            ownedStocks.forEach(stockName => {
                stockList.innerHTML += `<li>${stockName}: ${player.portfolio[stockName]} shares</li>`;
            });
        }
        updatePortfolioChart(player, stockData, ownedStocks.length > 0);
    }

    function updatePortfolioChart(player, stockData, hasStocks) {
        const chartCanvas = document.getElementById('portfolioChart');
        const emptyMessage = document.getElementById('empty-portfolio-message');
        if (!hasStocks) {
            chartCanvas.style.display = 'none';
            emptyMessage.style.display = 'flex';
            if (portfolioChart) portfolioChart.destroy();
            return;
        }
        chartCanvas.style.display = 'block';
        emptyMessage.style.display = 'none';

        const labels = ['Cash'];
        const data = [player.cash];
        const colors = ['#28a745'];
        const stockColors = ['#0052D4', '#6f42c1', '#fd7e14', '#17a2b8', '#ffc107', '#4364F7'];
        let colorIndex = 0;

        for (const stockName in player.portfolio) {
            if (player.portfolio[stockName] > 0) {
                const stock = stockData.find(s => s.name === stockName);
                if (stock) {
                    labels.push(stockName);
                    data.push(player.portfolio[stockName] * stock.price);
                    colors.push(stockColors[colorIndex % stockColors.length]);
                    colorIndex++;
                }
            }
        }
        
        if (portfolioChart) portfolioChart.destroy();
        portfolioChart = new Chart(portfolioCtx, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{ data, backgroundColor: colors, borderColor: '#fff', borderWidth: 3 }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom', labels: { font: { family: "'Poppins', sans-serif" }, padding: 20 } } },
                animation: { animateScale: true, animateRotate: true }
            }
        });
    }

    function updateHistoryChart(fullStockData, currentRound) {
        if (!fullStockData || fullStockData.length === 0) return;
        const labels = Array.from({ length: currentRound }, (_, i) => `Round ${i + 1}`);
        const stockColors = ['#0052D4', '#6f42c1', '#fd7e14', '#17a2b8', '#ffc107', '#4364F7'];

        const datasets = fullStockData.map((stock, index) => ({
            label: stock.name,
            data: stock.prices.slice(0, currentRound),
            borderColor: stockColors[index % stockColors.length],
            backgroundColor: stockColors[index % stockColors.length] + '33',
            fill: false,
            tension: 0.3,
            borderWidth: 3
        }));

        if (historyChart) historyChart.destroy();
        historyChart = new Chart(historyCtx, {
            type: 'line',
            data: { labels, datasets },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom', labels: { font: { family: "'Poppins', sans-serif" }, padding: 20 } } },
                scales: { 
                    y: { ticks: { font: { family: "'Poppins', sans-serif" } } }, 
                    x: { ticks: { font: { family: "'Poppins', sans-serif" } } } 
                }
            }
        });
    }
});