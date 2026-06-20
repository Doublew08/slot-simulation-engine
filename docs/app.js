let rtpChartInstance = null;
let bucketChartInstance = null;
let balanceChartInstance = null;
let sessionHistChartInstance = null;
let currentSim = null; 
let lastResults = null; 
let autoSpinInterval = null;

const ALLOWED_SYMS = ["W", "H1", "H2", "M1", "M2", "L1", "L2", "SC", "CO"];

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
            audioToggleBtn.style.color = "var(--text-secondary)";
            audioToggleBtn.style.borderColor = "var(--text-secondary)";
        }
    });

    // --- DARK MODE TOGGLE ---
    const darkModeToggle = document.getElementById('darkModeToggle');
    const rootElement = document.documentElement;
    // Load saved preference
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
        rootElement.classList.add('light-mode');
        darkModeToggle.innerText = '🌞 Light Mode';
    } else {
        // default dark mode (no extra class)
        rootElement.classList.remove('light-mode');
        darkModeToggle.innerText = '🌙 Dark Mode';
    }
    darkModeToggle.addEventListener('click', () => {
        if (rootElement.classList.contains('light-mode')) {
            rootElement.classList.remove('light-mode');
            localStorage.setItem('theme', 'dark');
            darkModeToggle.innerText = '🌙 Dark Mode';
        } else {
            rootElement.classList.add('light-mode');
            localStorage.setItem('theme', 'light');
            darkModeToggle.innerText = '🌞 Light Mode';
        }
    });

    // INITIAL POPULATION OF SLOT GRID
    const initSlotCells = document.querySelectorAll('.slot-cell');
    const initGrid = [
        ["H1", "M1", "W",  "H2", "M2"],
        ["L1", "W",  "SC", "W",  "L2"],
        ["M2", "L2", "H1", "M1", "CO"]
    ];
    let initIdx = 0;
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 5; c++) {
            let sym = initGrid[r][c];
            initSlotCells[initIdx].innerHTML = `<img src="assets/${sym}.jpg" class="symbol-img" alt="${sym}">`;
            initSlotCells[initIdx].className = `slot-cell sym-${sym}`;
            initIdx++;
        }
    }

    // --- FULLSCREEN TOGGLE ---
    const fullscreenToggle = document.getElementById('fullscreenToggle');
    fullscreenToggle.addEventListener('click', () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                console.error(`Error attempting to enable fullscreen mode: ${err.message} (${err.name})`);
            });
            fullscreenToggle.innerText = '🖥️ Exit Fullscreen';
        } else {
            document.exitFullscreen();
            fullscreenToggle.innerText = '🖥️ Fullscreen';
        }
    });

    // Sync fullscreen button text when user exits via Escape key
    document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement) {
            fullscreenToggle.innerText = '🖥️ Fullscreen';
        } else {
            fullscreenToggle.innerText = '🖥️ Exit Fullscreen';
        }
    });

    // Stop auto-spin when tab becomes hidden to prevent memory buildup
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && autoSpinInterval) {
            clearInterval(autoSpinInterval);
            autoSpinInterval = null;
            const autoBtn = document.getElementById('autoSpinBtn');
            if (autoBtn) {
                autoBtn.classList.remove('active');
                autoBtn.innerText = 'AUTO';
            }
        }
    });
    
    // --- BACKEND TOGGLE ---
    // --- REEL EDITOR & PRESETS LOGIC ---
    const editorGrid = document.getElementById('editorGrid');
    const presets = {
        low: { "W": 2, "H1": 3, "H2": 4, "M1": 5, "M2": 6, "L1": 25, "L2": 30, "SC": 1.5, "CO": 3 },
        med: { "W": 1, "H1": 2, "H2": 2, "M1": 3, "M2": 3, "L1": 30, "L2": 35, "SC": 1, "CO": 2 },
        high: { "W": 0.5, "H1": 1, "H2": 1, "M1": 2, "M2": 2, "L1": 40, "L2": 45, "SC": 0.5, "CO": 1 }
    };
    
    function renderEditor(weights) {
        editorGrid.innerHTML = '';
        for (const sym of ALLOWED_SYMS) {
            if (!(sym in weights)) continue;
            const card = document.createElement('div');
            card.className = 'editor-card';

            const h4 = document.createElement('h4');
            h4.textContent = sym;                       // textContent — no XSS

            const inp = document.createElement('input');
            inp.type = 'number';
            inp.id   = `weight_${sym}`;
            inp.setAttribute('value', String(Number(weights[sym])));
            inp.step = '0.1';
            inp.min  = '0';
            inp.addEventListener('change', updateDocumentation);

            card.appendChild(h4);
            card.appendChild(inp);
            editorGrid.appendChild(card);
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
        
        ALLOWED_SYMS.forEach(symName => {
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

        ALLOWED_SYMS.forEach(symName => {
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
    const shareUrlBtn   = document.getElementById('shareUrlBtn');

    // --- SHARE URL ---
    function shareConfig() {
        const config = {
            spins:    parseInt(document.getElementById('numSpins').value) || 1000000,
            coinProb: parseFloat(document.getElementById('coinProb').value) || 0.05,
            bonusBuy: document.getElementById('bonusBuyMode').checked,
            weights:  getCustomWeights(),
        };
        // encodeURIComponent prevents btoa's +/=/  from being mangled in the URL fragment
        const encoded = encodeURIComponent(btoa(JSON.stringify(config)));
        const base = window.location.origin + window.location.pathname.replace(/\/$/, '');
        const url = `${base}/#sim=${encoded}`;
        navigator.clipboard.writeText(url).then(() => {
            shareUrlBtn.textContent = '✓ COPIED!';
            setTimeout(() => { shareUrlBtn.textContent = '🔗 SHARE CONFIG URL'; }, 2000);
        }).catch(() => {
            window.prompt('Copy this URL:', url);
        });
    }

    function loadConfigFromUrl() {
        const match = window.location.hash.match(/#sim=(.+)/);
        if (!match) return;
        try {
            const cfg = JSON.parse(atob(decodeURIComponent(match[1])));
            const _SYM_SET = new Set(ALLOWED_SYMS);
            if (Number.isFinite(cfg.spins) && cfg.spins > 0)
                document.getElementById('numSpins').value = Math.max(1000, Math.min(50_000_000, cfg.spins));
            if (Number.isFinite(cfg.coinProb))
                document.getElementById('coinProb').value = Math.max(0, Math.min(1, cfg.coinProb));
            if (typeof cfg.bonusBuy === 'boolean')
                document.getElementById('bonusBuyMode').checked = cfg.bonusBuy;
            if (cfg.weights && typeof cfg.weights === 'object' && !Array.isArray(cfg.weights)) {
                const safe = {};
                for (const sym of _SYM_SET) {
                    const v = cfg.weights[sym];
                    if (Number.isFinite(v) && v >= 0) safe[sym] = v;
                }
                if (Object.keys(safe).length > 0) renderEditor({...presets.med, ...safe});
            }
            // payScale from the auto-balancer: scale all paytable values proportionally
            if (Number.isFinite(cfg.payScale) && cfg.payScale > 0) {
                window._balancerPayScale = Math.max(0.05, Math.min(2.0, cfg.payScale));
            }
            // Auto-run if the link came from the balancer (autorun flag)
            if (cfg.autorun === true) {
                setTimeout(() => runBtn.click(), 150);
                const label = window._balancerPayScale
                    ? `⚖️ Pay scale ${window._balancerPayScale.toFixed(3)}x applied — running simulation…`
                    : '⚖️ Balancer config loaded — running simulation…';
                const toast = document.createElement('div');
                toast.textContent = label;
                toast.style.cssText = 'position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);background:#1e293b;color:#e2e8f0;padding:0.7rem 1.4rem;border-radius:10px;border:1px solid rgba(139,92,246,0.4);font-family:Space Grotesk,sans-serif;font-size:0.9rem;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.4);';
                document.body.appendChild(toast);
                setTimeout(() => toast.remove(), 4000);
            } else {
                const toast = document.createElement('div');
                toast.textContent = '🔗 Shared config loaded — hit Run to simulate';
                toast.style.cssText = 'position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);background:#1e293b;color:#e2e8f0;padding:0.7rem 1.4rem;border-radius:10px;border:1px solid rgba(139,92,246,0.4);font-family:Space Grotesk,sans-serif;font-size:0.9rem;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.4);';
                document.body.appendChild(toast);
                setTimeout(() => toast.remove(), 4000);
            }
        } catch (err) { console.warn('Failed to load config from URL:', err); }
    }

    loadConfigFromUrl();

    if (shareUrlBtn) shareUrlBtn.addEventListener('click', shareConfig);

    // --- SIMULATION HISTORY ---
    const HISTORY_KEY = 'slotSimHistory';
    const MAX_HISTORY = 10;

    function saveToHistory(results, config) {
        const entry = { ts: Date.now(), spins: results.num_spins, rtp: results.total_rtp, vol: results.volatility, config };
        let hist = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
        hist.unshift(entry);
        if (hist.length > MAX_HISTORY) hist = hist.slice(0, MAX_HISTORY);
        localStorage.setItem(HISTORY_KEY, JSON.stringify(hist));
        renderHistory();
    }

    function renderHistory() {
        const hist = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
        const section = document.getElementById('historySection');
        const list    = document.getElementById('historyList');
        if (!section || !list) return;
        if (hist.length === 0) { section.style.display = 'none'; return; }
        section.style.display = '';
        list.innerHTML = hist.map((e, i) => `
            <div class="metric-card" style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem 1rem;margin-bottom:0.5rem;">
                <div>
                    <span style="color:var(--text-secondary);font-size:0.8rem;">${new Date(e.ts).toLocaleString()}</span>
                    <div style="margin-top:0.2rem;">
                        <strong style="color:white;">${(e.rtp*100).toFixed(2)}% RTP</strong>
                        <span style="color:var(--text-secondary);margin-left:0.75rem;">Vol: ${e.vol.toFixed(2)}</span>
                        <span style="color:var(--text-secondary);margin-left:0.75rem;">${(e.spins/1e6).toFixed(2)}M spins</span>
                    </div>
                </div>
                <button class="btn-secondary hist-rerun-btn" data-idx="${i}" style="padding:0.3rem 0.75rem;font-size:0.8rem;white-space:nowrap;margin-left:1rem;">↺ Re-run</button>
            </div>
        `).join('');

        list.querySelectorAll('.hist-rerun-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const entry = hist[parseInt(btn.dataset.idx)];
                if (!entry?.config) return;
                const cfg = entry.config;
                if (Number.isFinite(cfg.spins))   document.getElementById('numSpins').value  = cfg.spins;
                if (Number.isFinite(cfg.coinProb)) document.getElementById('coinProb').value  = cfg.coinProb;
                if (typeof cfg.bonusBuyMode === 'boolean') document.getElementById('bonusBuyMode').checked = cfg.bonusBuyMode;
                if (cfg.weights) renderEditor(cfg.weights);
                runBtn.click();
            });
        });
    }

    const clearHistBtn = document.getElementById('clearHistoryBtn');
    if (clearHistBtn) clearHistBtn.addEventListener('click', () => {
        localStorage.removeItem(HISTORY_KEY);
        renderHistory();
    });

    renderHistory();

    function runSimulation(numSpins, coinProb, weights, bonusBuyMode, onProgress, payScale) {
        if (typeof Worker !== 'undefined') {
            return new Promise((resolve, reject) => {
                const worker = new Worker('simulation.worker.js');
                worker.onmessage = (e) => {
                    if (e.data.type === 'progress') {
                        onProgress(e.data.value);
                    } else if (e.data.type === 'done') {
                        worker.terminate();
                        resolve(e.data.result);
                    }
                };
                worker.onerror = (err) => { worker.terminate(); reject(err); };
                worker.postMessage({ type: 'run', payload: { numSpins, coinProb, weights, bonusBuyMode, payScale: payScale || null } });
            });
        }
        // Fallback: run on main thread
        const fallbackSim = new Simulation();
        fallbackSim.setupGame(weights, coinProb);
        return fallbackSim.runSimulation(numSpins, onProgress, bonusBuyMode);
    }

    runBtn.addEventListener('click', async () => {
        const rawSpins = parseInt(document.getElementById('numSpins').value);
        const numSpins = Number.isFinite(rawSpins) ? Math.max(1000, Math.min(50000000, rawSpins)) : 1000000;
        const rawCoinProb = parseFloat(document.getElementById('coinProb').value);
        const coinProb = Number.isFinite(rawCoinProb) ? Math.max(0, Math.min(1, rawCoinProb)) : 0.05;
        const bonusBuyMode = document.getElementById('bonusBuyMode').checked;
        const weights = getCustomWeights();

        runBtn.disabled = true;
        btnText.style.display = 'none';
        btnLoader.style.display = 'block';
        progressContainer.style.display = 'block';
        progressBar.style.width = '0%';
        progressText.innerText = '0%';
        exportCsvBtn.style.display = 'none';
        exportJsonBtn.style.display = 'none';

        // Keep currentSim on main thread for visual spin / documentation
        currentSim = new Simulation();
        currentSim.setupGame(weights, coinProb);
        updateDocumentation();

        lastResults = await runSimulation(numSpins, coinProb, weights, bonusBuyMode, (percent) => {
            progressBar.style.width = `${percent}%`;
            progressText.innerText = `${percent.toFixed(1)}%`;
        }, window._balancerPayScale || null);

        runBtn.disabled = false;
        btnText.style.display = 'block';
        btnLoader.style.display = 'none';
        progressContainer.style.display = 'none';
        exportCsvBtn.style.display = 'block';
        exportJsonBtn.style.display = 'block';
        if (shareUrlBtn) shareUrlBtn.style.display = 'block';

        updateMetrics(lastResults);
        renderCharts(lastResults);
        saveToHistory(lastResults, { spins: numSpins, coinProb, bonusBuyMode, weights });
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
        
        for (let sym in currentSim.paytable._symbols) {
            let def = currentSim.paytable._symbols[sym];
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
                            
                            let cascade_res = currentSim.run_cascade_spin();
                            
                            let totalWin = (cascade_res.payout + cascade_res.scatter_payout) * betSize;
                            if (cascade_res.scatters >= currentSim.bonus_trigger_count) {
                                totalWin += currentSim.run_free_spins() * betSize;
                            }
                            if (cascade_res.hs_triggered) totalWin += cascade_res.hs_payout * betSize;
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
    let isSpinning = false;
    let autoSpinning = false;
    
    function doVisualSpin() {
        if (isSpinning) return;
        isSpinning = true;
        
        if(audioCtx.state === 'suspended') audioCtx.resume();
        playSpinSound();

        if (!currentSim) {
            currentSim = new Simulation();
            currentSim.setupGame(getCustomWeights(), 0.05);
        }
        
        // Generate the outcome
        let cascade_res = currentSim.run_cascade_spin();
        let finalGrid = cascade_res.final_grid;
        
        slotCells.forEach(cell => {
            cell.classList.remove('win-pulse');
            cell.classList.add('spinning');
        });
        winDisplay.innerText = "SPINNING...";
        
        const allSymbols = ["W", "H1", "H2", "M1", "M2", "L1", "L2", "SC", "CO"];
        
        // Setup shuffle intervals for each column (reel)
        const columns = [0, 1, 2, 3, 4];
        let shuffleIntervals = [];
        
        columns.forEach(col => {
            let interval = setInterval(() => {
                // Update the 3 cells in this column with random symbols
                for (let r = 0; r < 3; r++) {
                    let randSym = allSymbols[Math.floor(Math.random() * allSymbols.length)];
                    let flatIndex = r * 5 + col;
                    slotCells[flatIndex].innerHTML = `<img src="assets/${randSym}.jpg" class="symbol-img blur-spin" alt="${randSym}">`;
                    slotCells[flatIndex].className = `slot-cell sym-${randSym}`;
                }
            }, 50);
            shuffleIntervals.push(interval);
        });
        
        // Staggered stopping
        columns.forEach((col, idx) => {
            setTimeout(() => {
                clearInterval(shuffleIntervals[col]);
                playCoinSound(); // Small tick sound for reel stop
                for (let r = 0; r < 3; r++) {
                    let sym = finalGrid[r][col];
                    let flatIndex = r * 5 + col;
                    slotCells[flatIndex].innerHTML = `<img src="assets/${sym}.jpg" class="symbol-img" alt="${sym}">`;
                    slotCells[flatIndex].className = `slot-cell sym-${sym}`;
                    
                    // Add landing animation
                    let img = slotCells[flatIndex].querySelector('.symbol-img');
                    img.style.animation = "land 0.3s ease-out";
                }
                
                // If it's the last reel, evaluate wins
                if (idx === 4) {
                    isSpinning = false;
                    evaluateVisualWin(cascade_res);
                }
            }, 500 + (idx * 300)); // 500ms, 800ms, 1100ms, 1400ms, 1700ms
        });
    }
    
    function evaluateVisualWin(cascade_res) {
        let total = cascade_res.payout + cascade_res.scatter_payout;
        let text = `WIN: ${total.toFixed(2)}`;
        
        if (total > 0) playWinSound();
        
        if (cascade_res.scatters >= 3) {
            text += ` | FREE SPINS!`;
            slotCells.forEach(cell => { 
                if(cell.querySelector('img') && cell.querySelector('img').alt === 'SC') 
                    cell.classList.add('win-pulse'); 
            });
        }
        if (cascade_res.hs_triggered) {
            text += ` | HOLD & SPIN: ${cascade_res.hs_payout.toFixed(2)}`;
            slotCells.forEach(cell => { 
                if(cell.querySelector('img') && cell.querySelector('img').alt === 'CO') 
                    cell.classList.add('win-pulse'); 
            });
        }
        if (cascade_res.hs_grand) {
            text = `💰 PROGRESSIVE JACKPOT HIT! 💰`;
            playJackpotSound();
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

    const ciEl = document.getElementById('mRtpCi');
    if (ciEl) {
        const ci = results.rtp_ci_95 || 0;
        ciEl.textContent = ci > 0 ? `±${(ci * 100).toFixed(2)}% (95% CI)` : '';
    }

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
    balanceChartInstance = null;
    const balanceWrapper = document.getElementById('balanceChartWrapper');
    if (results.balance_history && results.balance_history.length > 0) {
        balanceWrapper.style.display = '';
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
    } else {
        balanceWrapper.style.display = 'none';
    }
}
