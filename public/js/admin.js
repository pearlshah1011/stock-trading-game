document.addEventListener('DOMContentLoaded', () => {
    const statusDiv = document.getElementById('connection-status');
    const ws = new WebSocket(`${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`);

    ws.onopen = () => ws.send(JSON.stringify({ type: 'register_admin', secret: 'gamemaster123' }));
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'admin_ok') {
            statusDiv.textContent = 'Connected as Game Master.';
            statusDiv.style.color = 'var(--green)';
        }
        if (data.type === 'update') updateDashboard(data);
    };
    ws.onerror = () => { statusDiv.textContent = 'Connection failed.'; statusDiv.style.color = 'var(--red)'; };

    function updateDashboard({ gameSettings, leaderboard }) {
        document.getElementById('current-round').textContent = gameSettings.currentRound;
        const statusEl = document.getElementById('trading-status');
        statusEl.textContent = gameSettings.tradingOpen ? 'OPEN' : 'CLOSED';
        document.getElementById('toggle-trading-btn').textContent = gameSettings.tradingOpen ? 'Close Trading' : 'Open Trading';
        
        const leaderboardBody = document.querySelector('#leaderboard-table tbody');
        leaderboardBody.innerHTML = '';
        leaderboard.forEach((player, index) => {
            leaderboardBody.innerHTML += `
                <tr>
                    <td>${index + 1}</td>
                    <td>${player.nickname}</td>
                    <td>${player.totalValue.toLocaleString()}</td>
                    <td><button class="delete-btn" data-nickname="${player.nickname}">Delete</button></td>
                </tr>
            `;
        });
        document.querySelectorAll('.delete-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const nickname = e.target.dataset.nickname;
                if (confirm(`Are you sure you want to delete player: ${nickname}?`)) {
                    ws.send(JSON.stringify({ type: 'delete_player', nickname }));
                }
            });
        });
    }

    document.getElementById('send-news').addEventListener('click', () => {
        const input = document.getElementById('news-message');
        if (input.value) ws.send(JSON.stringify({ type: 'broadcast_news', message: input.value }));
        input.value = '';
    });

    document.getElementById('toggle-trading-btn').addEventListener('click', () => ws.send(JSON.stringify({ type: 'toggle_trading' })));
    document.getElementById('advance-round-btn').addEventListener('click', () => {
        if (confirm("Are you sure you want to advance to the next round?")) {
            ws.send(JSON.stringify({ type: 'advance_round' }));
        }
    });

    // --- NEW FEATURE: Reset Game Listener ---
    document.getElementById('reset-game-btn').addEventListener('click', () => {
        if (confirm("!! WARNING !!\n\nAre you sure you want to end the current game?\nThis will kick all players and reset all data to Round 1.")) {
            ws.send(JSON.stringify({ type: 'reset_game' }));
        }
    });
});