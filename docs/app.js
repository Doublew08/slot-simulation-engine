let rtpChartInstance = null;
let bucketChartInstance = null;
let balanceChartInstance = null;
let sessionHistChartInstance = null;
let currentSim = null; 
let lastResults = null; 
let autoSpinInterval = null; 

// --- AUDIO ENGINE ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let soundEnabled = true;

function playTone(freq, type, duration, vol=0.1) {
    if (!soundEnabled) return;
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    
    gainNode.gain.setValueAtTime(vol, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

function playSpinSound() {
    // fast clicking
    for(let i=0; i<5; i++) {
        setTimeout(() => playTone(300 + Math.random()*100, 'square', 0.05, 0.02), i*100);
    }
}

function playWinSound() {
    playTone(523.25, 'sine', 0.3, 0.1); // C5
    setTimeout(() => playTone(659.25, 'sine', 0.5, 0.1), 150); // E5
    setTimeout(() => playTone(783.99, 'sine', 0.8, 0.1), 300); // G5
}

function playJackpotSound() {
    for(let i=0; i<10; i++) {
        setTimeout(() => playTone(880, 'sawtooth', 0.2, 0.15), i*200);
        setTimeout(() => playTone(440, 'sawtooth', 0.2, 0.15), (i*200)+100);
    }
}

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

    // --- AUDIO TOGGLE ---
    const audioToggleBtn = document.getElementById('audioToggleBtn');
    audioToggleBtn.addEventListener('click', () => {
        soundEnabled = !soundEnabled;
        if(soundEnabled) {
            audioCtx.resume();
            audioToggleBtn.innerText = "🔊 SOUND ON";
            audioToggleBtn.style.color = "var(--primary-color)";
            audioToggleBtn.style.borderColor = "var(--primary-color)";
        } else {
            audioToggleBtn.innerText = "🔇 SOUND OFF";
            audioToggleBtn.style.color = "var(--secondary-color)";
            audioToggleBtn.style.borderColor = "var(--secondary-color)";
        }
    });

    // --- REEL EDITOR & PRESETS LOGIC ---
    const editorGrid = document.getElementById('editorGrid');
    const presets = {
        low: { "W": 6.0, "H1": 6, "H2": 7, "M1": 8, "M2": 8, "L1": 8, "L2": 8, "SC": 3, "CO": 4 },
        med: { "W": 4.238, "H1": 4, "H2": 5, "M1": 6, "M2": 7, "L1": 10, "L2": 12, "SC": 2, "CO": 3 },
        high: { "W": 2.5, "H1": 2, "H2": 3, "M1": 5, "M2": 6, "L1": 15, "L2": 20, "SC": 1.5, "CO": 2 }
    };
    
    function renderEditor(weights) {
        editorGrid.innerHTML = '';
        for (let sym in weights) {
            let card = document.createElement('div');
            card.className = 'editor-card';
            card.innerHTML = `
                <h4>${sym}</h4>
                <input type="number" id="weight_${sym}" value="${weights[sym]}" step="0.1" min="0">
            `;
            editorGrid.appendChild(card);
            
            // Add listener to update documentation when weight changes
            document.getElementById(`weight_${sym}`).addEventListener('change', updateDocumentation);
        }
        updateDocumentation();
    }
    
    // Init with medium
    renderEditor(presets.med);

    document.getElementById('presetLow').addEventListener('click', () => renderEditor(presets.low));
    document.getElementById('presetMed').addEventListener('click', () => renderEditor(presets.med));
    document.getElementById('presetHigh').addEventListener('click', () => renderEditor(presets.high));
    
    function getCustomWeights() {
        let cw = {};
        for (let sym in presets.med) {
            let el = document.getElementById(`weight_${sym}`);
            let val = el ? parseFloat(el.value) : presets.med[sym];
            cw[sym] = isNaN(val) ? presets.med[sym] : val;
        }
        return cw;
    }

    // --- DOCUMENTATION RENDER LOGIC ---
    function updateDocumentation() {
        if (!currentSim) {
            currentSim = new Simulation();
        }
        currentSim.setupGame(getCustomWeights(), 0.05);

        // Render Paytable
        const ptBody = document.querySelector('#paytableTable tbody');
        ptBody.innerHTML = '';
        
        const symsToDisplay = ["W", "H1", "H2", "M1", "M2", "L1", "L2", "SC", "CO"];
        symsToDisplay.forEach(symName => {
            let symDef = currentSim.paytable.get(symName);
            let p3 = symDef.payouts[3] || 0;
            let p4 = symDef.payouts[4] || 0;
            let p5 = symDef.payouts[5] || 0;
            
            if(symDef.is_scatter) { p3 += " (Total Bet)"; p4 += " (Total Bet)"; p5 += " (Total Bet)"; }
            if(symDef.is_coin) { p3 = "Jackpot"; p4 = "Jackpot"; p5 = "Jackpot"; }
            if(symName === "W") { p3 += " / Wild"; p4 += " / Wild"; p5 += " / Wild"; }
            
            ptBody.innerHTML += `<tr>
                <td style="color: var(--primary-color); font-weight: bold;">${symName}</td>
                <td>${p3}</td><td>${p4}</td><td>${p5}</td>
            </tr>`;
        });

        // Render Reel Strips
        const reelsBody = document.querySelector('#reelsTable tbody');
        reelsBody.innerHTML = '';
        
        symsToDisplay.forEach(symName => {
            let rowHtml = `<tr><td style="color: var(--success-color); font-weight: bold;">${symName}</td>`;
            currentSim.engine.reels.forEach(reel => {
                let count = reel.pool.filter(s => s === symName).length;
                rowHtml += `<td>${count}</td>`;
            });
            rowHtml += `</tr>`;
            reelsBody.innerHTML += rowHtml;
        });
    }

    // --- SIMULATION LOGIC ---
    const runBtn = document.getElementById('runBtn');
    const btnText = document.querySelector('.btn-text');
    const btnLoader = document.getElementById('btnLoader');
    const progressContainer = document.getElementById('progressContainer');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const exportCsvBtn = document.getElementById('exportCsvBtn');
    const exportJsonBtn = document.getElementById('exportJsonBtn');

    runBtn.addEventListener('click', async () => {
        const numSpins = parseInt(document.getElementById('numSpins').value) || 1000000;
        const coinProb = parseFloat(document.getElementById('coinProb').value) || 0.05;
        const bonusBuyMode = document.getElementById('bonusBuyMode').checked;

        runBtn.disabled = true;
        btnText.style.display = 'none';
        btnLoader.style.display = 'block';
        progressContainer.style.display = 'block';
        progressBar.style.width = '0%';
        progressText.innerText = '0%';
        exportCsvBtn.style.display = 'none';
        exportJsonBtn.style.display = 'none';

        currentSim = new Simulation();
        currentSim.setupGame(getCustomWeights(), coinProb);
        updateDocumentation(); // sync documentation

        lastResults = await currentSim.runSimulation(numSpins, (percent) => {
            progressBar.style.width = `${percent}%`;
            progressText.innerText = `${percent.toFixed(1)}%`;
        }, bonusBuyMode);

        runBtn.disabled = false;
        btnText.style.display = 'block';
        btnLoader.style.display = 'none';
        progressContainer.style.display = 'none';
        exportCsvBtn.style.display = 'block';
        exportJsonBtn.style.display = 'block';

        updateMetrics(lastResults);
        renderCharts(lastResults);
    });

    // --- CSV EXPORT LOGIC ---
    exportCsvBtn.addEventListener('click', () => {
        if (!lastResults) return;
        let csvContent = "data:text/csv;charset=utf-8,Metric,Value\n";
        csvContent += `Total Spins,${lastResults.num_spins}\n`;
        csvContent += `Total RTP,${(lastResults.total_rtp*100).toFixed(4)}%\n`;
        csvContent += `Base RTP,${(lastResults.base_rtp*100).toFixed(4)}%\n`;
        csvContent += `Bonus RTP,${(lastResults.bonus_rtp*100).toFixed(4)}%\n`;
        csvContent += `Hold & Spin RTP,${(lastResults.hs_rtp*100).toFixed(4)}%\n`;
        csvContent += `Hit Rate,${(lastResults.hit_rate*100).toFixed(4)}%\n`;
        csvContent += `Volatility Index,${lastResults.volatility.toFixed(4)}\n`;
        
        for(let b in lastResults.buckets) {
            csvContent += `Bucket ${b},${lastResults.buckets[b].toFixed(4)}%\n`;
        }

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", "cyberslot_results.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });

    // --- JSON PAR SHEET EXPORT LOGIC ---
    exportJsonBtn.addEventListener('click', () => {
        if (!currentSim) return;
        
        let parData = {
            "math_model": "SlotSimulationEngine_V2",
            "date_generated": new Date().toISOString(),
            "target_rtp": lastResults ? (lastResults.total_rtp*100).toFixed(4) + "%" : "N/A",
            "volatility": lastResults ? lastResults.volatility.toFixed(4) : "N/A",
            "base_weights": getCustomWeights(),
            "reel_strips": currentSim.engine.reels.map(r => r.pool),
            "paytable": {}
        };
        
        for (let [sym, def] of currentSim.paytable.entries()) {
            parData.paytable[sym] = {
                "payouts": def.payouts,
                "is_wild": def.is_wild,
                "is_scatter": def.is_scatter,
                "is_coin": def.is_coin
            };
        }

        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(parData, null, 2));
        const link = document.createElement("a");
        link.setAttribute("href", dataStr);
        link.setAttribute("download", "math_config.json");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });
    
    // --- SESSION SIMULATOR LOGIC ---
    const runSessBtn = document.getElementById('runSessBtn');
    if (runSessBtn) {
        const sessBtnText = document.getElementById('sessBtnText');
        const sessBtnLoader = document.getElementById('sessBtnLoader');
        const sessProgressContainer = document.getElementById('sessProgressContainer');
        const sessProgressBar = document.getElementById('sessProgressBar');
        const sessProgressText = document.getElementById('sessProgressText');

        runSessBtn.addEventListener('click', async () => {
            const bankroll = parseFloat(document.getElementById('sessBankroll').value) || 100;
            const betSize = parseFloat(document.getElementById('sessBet').value) || 1;
            const spinsPerSess = parseInt(document.getElementById('sessSpins').value) || 200;
            const numSessions = parseInt(document.getElementById('sessCount').value) || 5000;

            runSessBtn.disabled = true;
            sessBtnText.style.display = 'none';
            sessBtnLoader.style.display = 'block';
            sessProgressContainer.style.display = 'block';
            sessProgressBar.style.width = '0%';
            sessProgressText.innerText = '0%';

            if (!currentSim) {
                currentSim = new Simulation();
                currentSim.setupGame(getCustomWeights(), parseFloat(document.getElementById('coinProb').value) || 0.05);
            }

            let endBalances = new Float32Array(numSessions);
            let bankruptCount = 0;
            let profitCount = 0;
            let totalEndBal = 0;

            const chunkSize = 200;
            let currentSession = 0;

            function runChunk() {
                return new Promise(resolve => {
                    let end = Math.min(currentSession + chunkSize, numSessions);
                    for (let s = currentSession; s < end; s++) {
                        let bal = bankroll;
                        for (let sp = 0; sp < spinsPerSess; sp++) {
                            if (bal < betSize) break; // Bankrupt
                            bal -= betSize;
                            
                            let grid = currentSim.engine.spin();
                            let base_payout = currentSim.evaluator.evaluate(grid);
                            let scatters = currentSim.evaluator.evaluate_scatters(grid);
                            let hs_res = currentSim.run_hs(grid);
                            
                            let totalWin = (base_payout + scatters.payout + hs_res.payout) * betSize;
                            bal += totalWin;
                        }
                        
                        endBalances[s] = bal;
                        totalEndBal += bal;
                        if (bal < betSize) bankruptCount++;
                        if (bal > bankroll) profitCount++;
                    }
                    
                    currentSession = end;
                    let pct = (currentSession / numSessions) * 100;
                    sessProgressBar.style.width = `${pct}%`;
                    sessProgressText.innerText = `${pct.toFixed(1)}%`;
                    
                    if (currentSession < numSessions) {
                        setTimeout(() => resolve(runChunk()), 0);
                    } else {
                        resolve();
                    }
                });
            }

            await runChunk();

            let riskOfRuin = (bankruptCount / numSessions) * 100;
            let avgEnd = totalEndBal / numSessions;
            let profitPct = (profitCount / numSessions) * 100;

            document.getElementById('mRuin').innerText = riskOfRuin.toFixed(2) + '%';
            document.getElementById('mAvgEnd').innerText = '$' + avgEnd.toFixed(2);
            document.getElementById('mProfit').innerText = profitPct.toFixed(2) + '%';

            let maxBal = 0;
            for(let i=0; i<numSessions; i++) {
                if(endBalances[i] > maxBal) maxBal = endBalances[i];
            }
            
            let numBins = 20;
            if (maxBal === 0) maxBal = 1; // handle edge case
            let binSize = maxBal / numBins;
            let bins = new Array(numBins).fill(0);
            let binLabels = [];
            
            for(let i=0; i<numBins; i++) {
                binLabels.push(`$${(i*binSize).toFixed(0)}-$${((i+1)*binSize).toFixed(0)}`);
            }

            for(let i=0; i<numSessions; i++) {
                let binIdx = Math.min(Math.floor(endBalances[i] / binSize), numBins - 1);
                bins[binIdx]++;
            }

            if (sessionHistChartInstance) sessionHistChartInstance.destroy();
            Chart.defaults.color = '#94a3b8';
            Chart.defaults.font.family = "'Space Grotesk', sans-serif";
            
            sessionHistChartInstance = new Chart(document.getElementById('sessionHistChart').getContext('2d'), {
                type: 'bar',
                data: {
                    labels: binLabels,
                    datasets: [{
                        label: 'Number of Players',
                        data: bins,
                        backgroundColor: '#3b82f6',
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        title: { display: true, text: 'Session End Balance Distribution', font: { size: 16 } }
                    },
                    scales: {
                        x: { ticks: { maxRotation: 45, minRotation: 45 } },
                        y: { grid: { color: 'rgba(255,255,255,0.05)' } }
                    }
                }
            });

            runSessBtn.disabled = false;
            sessBtnText.style.display = 'block';
            sessBtnLoader.style.display = 'none';
            sessProgressContainer.style.display = 'none';
        });
    }

    // --- VISUAL SPIN LOGIC ---
    const spinOnceBtn = document.getElementById('spinOnceBtn');
    const autoSpinBtn = document.getElementById('autoSpinBtn');
    const slotCells = document.querySelectorAll('.slot-cell');
    const winDisplay = document.getElementById('winDisplay');
    
    function doVisualSpin() {
        // Must resume AudioContext on first user interaction if locked
        if(audioCtx.state === 'suspended') audioCtx.resume();

        playSpinSound();

        if (!currentSim) {
            currentSim = new Simulation();
            currentSim.setupGame(getCustomWeights(), 0.05);
        }
        
        let cascade_res = currentSim.run_cascade_spin();
        let grid = cascade_res.final_grid;
        
        slotCells.forEach(cell => cell.classList.remove('win-pulse'));
        
        let flatIndex = 0;
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 5; c++) {
                let sym = grid[r][c];
                slotCells[flatIndex].innerText = sym;
                slotCells[flatIndex].className = `slot-cell sym-${sym}`;
                flatIndex++;
            }
        }
        
        let total = cascade_res.payout + cascade_res.scatter_payout;
        let text = `WIN: ${total.toFixed(2)}`;
        
        let isBigWin = false;

        if (cascade_res.scatters >= 3) {
            text += ` | FREE SPINS!`;
            isBigWin = true;
            slotCells.forEach(cell => { if(cell.innerText === 'SC') cell.classList.add('win-pulse'); });
        }
        if (cascade_res.hs_triggered) {
            text += ` | HOLD & SPIN: ${cascade_res.hs_payout.toFixed(2)}`;
            isBigWin = true;
            slotCells.forEach(cell => { if(cell.innerText === 'CO') cell.classList.add('win-pulse'); });
        }
        
        if (cascade_res.hs_grand) {
            text = `💰 PROGRESSIVE JACKPOT HIT! 💰`;
            slotCells.forEach(cell => cell.classList.add('win-pulse')); 
            playJackpotSound();
        } else if (isBigWin || total > 5.0) {
            isBigWin = true;
            slotCells.forEach(cell => { if(cell.innerText === 'W') cell.classList.add('win-pulse'); });
            playWinSound();
        } else if (total > 0) {
            playTone(400, 'sine', 0.1, 0.05);
        }
        
        if (isBigWin || total > 0) {
            winDisplay.style.color = 'var(--success-color)';
            winDisplay.style.textShadow = '0 0 20px rgba(0, 230, 118, 0.6)';
        } else {
            winDisplay.style.color = 'var(--text-secondary)';
            winDisplay.style.textShadow = 'none';
            text = "SYSTEM READY";
        }
        
        winDisplay.innerText = text;
    }

    spinOnceBtn.addEventListener('click', () => {
        if(autoSpinInterval) {
            clearInterval(autoSpinInterval);
            autoSpinInterval = null;
            autoSpinBtn.classList.remove('active');
            autoSpinBtn.innerText = "AUTO";
        }
        doVisualSpin();
    });

    autoSpinBtn.addEventListener('click', () => {
        if (autoSpinInterval) {
            clearInterval(autoSpinInterval);
            autoSpinInterval = null;
            autoSpinBtn.classList.remove('active');
            autoSpinBtn.innerText = "AUTO";
        } else {
            autoSpinInterval = setInterval(doVisualSpin, 1200);
            autoSpinBtn.classList.add('active');
            autoSpinBtn.innerText = "STOP AUTO";
            doVisualSpin(); 
        }
    });
});

function updateMetrics(results) {
    document.getElementById('mTotalRtp').innerText = (results.total_rtp * 100).toFixed(2) + '%';
    const rtpEl = document.getElementById('mTotalRtp');
    if (results.total_rtp * 100 >= 94 && results.total_rtp * 100 <= 96) rtpEl.style.color = 'var(--success-color)';
    else rtpEl.style.color = '#f50057';

    document.getElementById('mVol').innerText = results.volatility.toFixed(2);
    document.getElementById('mHitRate').innerText = (results.hit_rate * 100).toFixed(2) + '%';
    
    document.getElementById('mBonusFreq').innerText = results.bonus_freq > 0 ? `1 in ${Math.round(results.bonus_freq)}` : 'None';
    document.getElementById('mHsFreq').innerText = results.hs_freq > 0 ? `1 in ${Math.round(results.hs_freq)}` : 'None';
    document.getElementById('mGrandFreq').innerText = results.grand_freq > 0 ? `1 in ${Math.round(results.grand_freq)}` : 'None';
    
    let mProg = document.getElementById('mProg');
    if (mProg && results.avg_jackpot) {
        mProg.innerText = `$${Math.round(results.avg_jackpot).toLocaleString()}`;
    }
    
    // Respin Analytics
    let totalRespins = Object.values(results.strength_counts || {}).reduce((a, b) => a + b, 0);
    if (totalRespins > 0 && results.strength_counts) {
        document.getElementById('mWeak').innerText = `${((results.strength_counts.Weak / totalRespins) * 100).toFixed(1)}%`;
        document.getElementById('mNormal').innerText = `${((results.strength_counts.Normal / totalRespins) * 100).toFixed(1)}%`;
        document.getElementById('mStrong').innerText = `${((results.strength_counts.Strong / totalRespins) * 100).toFixed(1)}%`;
        document.getElementById('mUltra').innerText = `${((results.strength_counts.Ultra / totalRespins) * 100).toFixed(1)}%`;
        document.getElementById('mUpgrades').innerText = results.avg_upgrades ? results.avg_upgrades.toFixed(2) : '0';
    } else {
        document.getElementById('mWeak').innerText = '--';
        document.getElementById('mNormal').innerText = '--';
        document.getElementById('mStrong').innerText = '--';
        document.getElementById('mUltra').innerText = '--';
        document.getElementById('mUpgrades').innerText = '--';
    }
}

function renderCharts(results) {
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = "'Space Grotesk', sans-serif";

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
            scales: { 
                y: { type: 'logarithmic', min: 0.001 }
            },
            plugins: {
                legend: { display: false },
                title: { display: true, text: 'Win Distribution (Log Scale)', font: { size: 16 } }
            }
        }
    });

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
