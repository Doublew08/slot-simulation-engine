let rtpChartInstance = null;
let bucketChartInstance = null;
let balanceChartInstance = null;
let currentSim = null; // Store for visual spin

document.addEventListener('DOMContentLoaded', () => {
    // --- TABS LOGIC ---
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
        });
    });

    // --- REEL EDITOR LOGIC ---
    const editorGrid = document.getElementById('editorGrid');
    const defaultWeights = {
        "W": 4.238, "H1": 4, "H2": 5, "M1": 6, "M2": 7, "L1": 10, "L2": 12, "SC": 2, "CO": 3
    };
    
    for (let sym in defaultWeights) {
        let card = document.createElement('div');
        card.className = 'editor-card';
        card.innerHTML = `
            <h4>${sym}</h4>
            <input type="number" id="weight_${sym}" value="${defaultWeights[sym]}" step="0.1" min="0">
        `;
        editorGrid.appendChild(card);
    }
    
    function getCustomWeights() {
        let cw = {};
        for (let sym in defaultWeights) {
            let val = parseFloat(document.getElementById(`weight_${sym}`).value);
            cw[sym] = isNaN(val) ? defaultWeights[sym] : val;
        }
        return cw;
    }

    // --- SIMULATION LOGIC ---
    const runBtn = document.getElementById('runBtn');
    const btnText = document.querySelector('.btn-text');
    const btnLoader = document.getElementById('btnLoader');
    const progressContainer = document.getElementById('progressContainer');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');

    runBtn.addEventListener('click', async () => {
        const numSpins = parseInt(document.getElementById('numSpins').value) || 1000000;
        const coinProb = parseFloat(document.getElementById('coinProb').value) || 0.05;

        runBtn.disabled = true;
        btnText.style.display = 'none';
        btnLoader.style.display = 'block';
        progressContainer.style.display = 'block';
        progressBar.style.width = '0%';
        progressText.innerText = '0%';

        currentSim = new Simulation();
        currentSim.setupGame(getCustomWeights(), coinProb);

        const results = await currentSim.runSimulation(numSpins, (percent) => {
            progressBar.style.width = `${percent}%`;
            progressText.innerText = `${percent.toFixed(1)}%`;
        });

        runBtn.disabled = false;
        btnText.style.display = 'block';
        btnLoader.style.display = 'none';
        progressContainer.style.display = 'none';

        updateMetrics(results);
        renderCharts(results);
    });
    
    // --- VISUAL SPIN LOGIC ---
    const spinOnceBtn = document.getElementById('spinOnceBtn');
    const slotCells = document.querySelectorAll('.slot-cell');
    const winDisplay = document.getElementById('winDisplay');
    
    spinOnceBtn.addEventListener('click', () => {
        if (!currentSim) {
            currentSim = new Simulation();
            currentSim.setupGame(getCustomWeights(), 0.05);
        }
        
        let grid = currentSim.engine.spin();
        
        // Flatten grid to row-major for the DOM cells
        let flatIndex = 0;
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 5; c++) {
                let sym = grid[r][c];
                slotCells[flatIndex].innerText = sym;
                slotCells[flatIndex].className = `slot-cell sym-${sym}`;
                flatIndex++;
            }
        }
        
        let base_payout = currentSim.evaluator.evaluate(grid);
        let scatters = currentSim.evaluator.evaluate_scatters(grid);
        let hs_res = currentSim.run_hs(grid);
        
        let total = base_payout + scatters.payout;
        let text = `BASE WIN: ${total.toFixed(2)}`;
        
        if (scatters.count >= 3) {
            text += ` | FREE SPINS TRIGGERED!`;
        }
        if (hs_res.triggered) {
            text += ` | HOLD & SPIN WIN: ${hs_res.payout.toFixed(2)}`;
        }
        
        winDisplay.innerText = text;
    });
});

function updateMetrics(results) {
    document.getElementById('mTotalRtp').innerText = (results.total_rtp * 100).toFixed(2) + '%';
    const rtpEl = document.getElementById('mTotalRtp');
    if (results.total_rtp * 100 >= 94 && results.total_rtp * 100 <= 96) rtpEl.style.color = 'var(--success-color)';
    else rtpEl.style.color = '#ef4444';

    document.getElementById('mVol').innerText = results.volatility.toFixed(2);
    document.getElementById('mHitRate').innerText = (results.hit_rate * 100).toFixed(2) + '%';
    
    document.getElementById('mBonusFreq').innerText = results.bonus_freq > 0 ? `1 in ${Math.round(results.bonus_freq)}` : 'None';
    document.getElementById('mHsFreq').innerText = results.hs_freq > 0 ? `1 in ${Math.round(results.hs_freq)}` : 'None';
    document.getElementById('mGrandFreq').innerText = results.grand_freq > 0 ? `1 in ${Math.round(results.grand_freq)}` : 'None';
}

function renderCharts(results) {
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = "'Space Grotesk', sans-serif";

    // 1. RTP Doughnut
    if (rtpChartInstance) rtpChartInstance.destroy();
    rtpChartInstance = new Chart(document.getElementById('rtpChart').getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: ['Base Game', 'Bonus', 'Hold & Spin', 'House Edge'],
            datasets: [{
                data: [results.base_rtp*100, results.bonus_rtp*100, results.hs_rtp*100, Math.max(0, 100 - results.total_rtp*100)],
                backgroundColor: ['#4c72b0', '#55a868', '#c44e52', 'rgba(255, 255, 255, 0.05)'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: '75%',
            plugins: {
                legend: { position: 'right' },
                title: { display: true, text: 'RTP Contributions', font: { size: 16 } }
            }
        }
    });

    // 2. Win Buckets Bar Chart
    if (bucketChartInstance) bucketChartInstance.destroy();
    bucketChartInstance = new Chart(document.getElementById('bucketChart').getContext('2d'), {
        type: 'bar',
        data: {
            labels: Object.keys(results.buckets),
            datasets: [{
                label: 'Hit Percentage',
                data: Object.values(results.buckets),
                backgroundColor: '#8b5cf6',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { y: { type: 'logarithmic', min: 0.001 } },
            plugins: {
                legend: { display: false },
                title: { display: true, text: 'Win Distribution (Log Scale)', font: { size: 16 } }
            }
        }
    });

    // 3. Balance Random Walk Line Chart
    if (balanceChartInstance) balanceChartInstance.destroy();
    let labels = Array.from({length: results.balance_history.length}, (_, i) => i * (results.num_spins / results.balance_history.length));
    balanceChartInstance = new Chart(document.getElementById('balanceChart').getContext('2d'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Player Balance (Starting at 0)',
                data: results.balance_history,
                borderColor: '#10b981',
                borderWidth: 1.5,
                tension: 0.2,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                title: { display: true, text: 'Player Bankroll Simulation (Random Walk)', font: { size: 16 } }
            },
            scales: {
                x: { display: false },
                y: { grid: { color: 'rgba(255,255,255,0.05)' } }
            }
        }
    });
}
