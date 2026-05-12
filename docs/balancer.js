const PYTHON_API = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000'
    : 'https://slot-simulation-engine.onrender.com';

const IS_LOCAL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

let fitnessChartInstance = null;
let currentMode  = 'js';
let activeWorker = null;

const SYMBOLS = ["W", "H1", "H2", "M1", "M2", "L1", "L2", "SC", "CO"];

// ── Chart — incremental updates, no destroy/recreate ──────────────────────

function initChart(targetRtp) {
    Chart.defaults.color       = '#94a3b8';
    Chart.defaults.font.family = "'Space Grotesk', sans-serif";
    if (fitnessChartInstance) fitnessChartInstance.destroy();

    fitnessChartInstance = new Chart(document.getElementById('fitnessChart').getContext('2d'), {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Best RTP So Far',
                    data: [],
                    borderColor: '#8b5cf6',
                    backgroundColor: 'rgba(139,92,246,0.15)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.1,
                    pointRadius: 2,
                },
                {
                    label: 'Current Eval RTP',
                    data: [],
                    borderColor: '#60a5fa',
                    borderWidth: 1.5,
                    borderDash: [3, 3],
                    pointRadius: 1,
                    fill: false,
                    tension: 0.1,
                },
                {
                    label: `Target ${(targetRtp).toFixed(2)}%`,
                    data: [],
                    borderColor: '#10b981',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    fill: false,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            plugins: {
                title: { display: true, text: 'CMA-ES Convergence', font: { size: 16 } },
                legend: { display: true },
            },
            scales: {
                y: { grid: { color: 'rgba(255,255,255,0.05)' } },
            },
        },
    });
}

function pushChartPoint(evalNum, bestRtp, currentRtp, targetRtp) {
    if (!fitnessChartInstance) return;
    const c = fitnessChartInstance;
    c.data.labels.push(`Eval ${evalNum}`);
    c.data.datasets[0].data.push(bestRtp);
    c.data.datasets[1].data.push(currentRtp);
    c.data.datasets[2].data.push(targetRtp);
    c.update('none'); // no animation — instant
}

// ── Shared UI helpers ──────────────────────────────────────────────────────

function setRunning(yes) {
    const btn    = document.getElementById('runEvolveBtn');
    const text   = document.getElementById('evolveBtnText');
    const loader = document.getElementById('evolveBtnLoader');
    btn.disabled         = yes;
    text.style.display   = yes ? 'none'  : 'block';
    loader.style.display = yes ? 'block' : 'none';
    document.getElementById('evolveProgressContainer').style.display = yes ? 'block' : 'none';
    if (yes) {
        document.getElementById('evolveProgressBar').style.width = '0%';
        document.getElementById('sendToMainBtn').style.display   = 'none';
    }
}

function setProgress(pct, text) {
    document.getElementById('evolveProgressBar').style.width = `${pct}%`;
    document.getElementById('evolveProgressText').innerText  = text;
}

function updateMetrics(bestRtp, error, countValue) {
    document.getElementById('mBestRtp').innerText  = (bestRtp * 100).toFixed(4) + '%';
    document.getElementById('mError').innerText    = (error   * 100).toFixed(4) + '%';
    document.getElementById('mGenCount').innerText = countValue;
}

function wireSendToMain(weights) {
    if (!weights) return;
    const config  = { spins: 1_000_000, coinProb: 0.05, bonusBuy: false, weights };
    const encoded = encodeURIComponent(btoa(JSON.stringify(config)));
    const btn     = document.getElementById('sendToMainBtn');
    btn.href      = `index.html#sim=${encoded}`;
    btn.style.display = 'block';
}

// ── Server connection check ────────────────────────────────────────────────

function setConnStatus(state) {
    const el = document.getElementById('connStatus');
    if (!el) return;
    const map = {
        checking:   { text: 'Checking…',       color: '#94a3b8' },
        warming:    { text: 'Warming up…',      color: '#f59e0b' },
        connected:  { text: 'Connected',        color: '#10b981' },
        offline:    { text: 'Server offline',   color: '#ef4444' },
    };
    const s = map[state] || map.checking;
    el.textContent = s.text;
    el.style.color = s.color;
}

async function pingServer() {
    setConnStatus('checking');
    // First fast check (5s) — already warm?
    try {
        const res = await fetch(`${PYTHON_API}/api/health`, { signal: AbortSignal.timeout(5000) });
        if (res.ok) { setConnStatus('connected'); return; }
    } catch {}
    // Cold start — Render can take up to 60s to wake
    setConnStatus('warming');
    try {
        const res = await fetch(`${PYTHON_API}/api/health`, { signal: AbortSignal.timeout(65000) });
        setConnStatus(res.ok ? 'connected' : 'offline');
    } catch {
        setConnStatus('offline');
    }
}

// Warmup ping on page load (non-localhost) so server is ready before user clicks
if (!IS_LOCAL) {
    fetch(`${PYTHON_API}/api/health`, { signal: AbortSignal.timeout(65000) }).catch(() => {});
}

// ── JS CMA-ES via Worker ───────────────────────────────────────────────────

function runJsCmaEs(targetRtp, maxEvals, spinsPerEval) {
    return new Promise((resolve, reject) => {
        if (activeWorker) { activeWorker.terminate(); activeWorker = null; }

        const worker = new Worker('balancer.worker.js');
        activeWorker = worker;

        initChart(targetRtp * 100);

        worker.onmessage = (e) => {
            const msg = e.data;

            if (msg.type === 'progress') {
                pushChartPoint(msg.eval, msg.best_rtp * 100, msg.rtp * 100, targetRtp * 100);
                setProgress((msg.eval / msg.total) * 100, `Evaluation ${msg.eval} / ${msg.total}`);
                updateMetrics(msg.best_rtp, msg.fitness, msg.eval);
                renderOptimizedWeights(msg.weights);

            } else if (msg.type === 'done') {
                activeWorker = null;
                worker.terminate();
                updateMetrics(msg.rtp, msg.delta, msg.evals);
                renderOptimizedWeights(msg.weights);
                setProgress(100, 'JS CMA-ES Complete!');
                resolve(msg.weights);

            } else if (msg.type === 'error') {
                activeWorker = null;
                worker.terminate();
                reject(new Error(msg.message));
            }
        };

        worker.onerror = (err) => {
            activeWorker = null;
            worker.terminate();
            reject(new Error(err.message));
        };

        worker.postMessage({ type: 'start', targetRtp, maxEvals, spinsPerEval });
    });
}

// ── Python CMA-ES via SSE ──────────────────────────────────────────────────

async function runCmaEsPython(targetRtp, maxEvals, spinsPerEval) {
    const resp = await fetch(`${PYTHON_API}/api/balance`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ target_rtp: targetRtp, max_evals: maxEvals, spins_per_eval: spinsPerEval }),
    });

    if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(err.detail || resp.statusText);
    }

    initChart(targetRtp * 100);

    const reader  = resp.body.getReader();
    const decoder = new TextDecoder();
    let   buf     = '';
    let   bestWeights = null;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const lines = buf.split('\n');
        buf = lines.pop();

        for (let line of lines) {
            if (!line.startsWith('data: ')) continue;
            let msg;
            try { msg = JSON.parse(line.slice(6)); } catch { continue; }

            if (msg.type === 'progress') {
                pushChartPoint(msg.eval, (msg.best_rtp ?? msg.rtp) * 100, msg.rtp * 100, targetRtp * 100);
                setProgress((msg.eval / msg.total) * 100, `Evaluation ${msg.eval} / ${msg.total}`);
                updateMetrics(msg.best_rtp ?? msg.rtp, msg.fitness, msg.eval);
                renderOptimizedWeights(msg.weights);

            } else if (msg.type === 'done') {
                bestWeights = msg.weights;
                updateMetrics(msg.rtp, msg.delta, msg.evals);
                renderOptimizedWeights(msg.weights);
                setProgress(100, 'Python CMA-ES Complete!');

            } else if (msg.type === 'error') {
                throw new Error(msg.message);
            }
        }
    }

    return bestWeights;
}

// ── Main click handler ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    const modeJsBtn  = document.getElementById('modeJsBtn');
    const modePyBtn  = document.getElementById('modePyBtn');
    const modeStatus = document.getElementById('modeStatus');
    const pyNotice   = document.getElementById('pyNotice');

    function setMode(mode) {
        currentMode = mode;
        if (mode === 'js') {
            modeJsBtn.classList.add('active');
            modePyBtn.classList.remove('active');
            pyNotice.style.display = 'none';
            modeStatus.textContent = 'Browser CMA-ES — no server required, runs in Web Worker';
        } else {
            modePyBtn.classList.add('active');
            modeJsBtn.classList.remove('active');
            pyNotice.style.display = '';
            modeStatus.textContent = 'Python CMA-ES — runs on Render, no setup needed';
            pingServer(); // check connection when user switches to Python mode
        }
    }

    modeJsBtn.addEventListener('click', () => setMode('js'));
    modePyBtn.addEventListener('click', () => setMode('py'));

    document.getElementById('runEvolveBtn').addEventListener('click', async () => {
        const targetRtp    = parseFloat(document.getElementById('targetRtp').value) / 100 || 0.96;
        const maxEvals     = parseInt(document.getElementById('maxEvals').value)     || 80;
        const spinsPerEval = parseInt(document.getElementById('spinsPerEval').value) || 50_000;
        setRunning(true);

        try {
            let bestWeights;
            if (currentMode === 'js') {
                bestWeights = await runJsCmaEs(targetRtp, maxEvals, spinsPerEval);
            } else {
                bestWeights = await runCmaEsPython(targetRtp, maxEvals, spinsPerEval);
            }
            wireSendToMain(bestWeights);
        } catch (err) {
            document.getElementById('evolveProgressText').innerText = `Error: ${err.message}`;
        } finally {
            setRunning(false);
            document.getElementById('evolveBtnText').style.display = 'block';
        }
    });
});

// ── Renderers ──────────────────────────────────────────────────────────────

// XSS-safe: textContent only, whitelisted symbol keys
function renderOptimizedWeights(weights) {
    if (!weights) return;
    const grid = document.getElementById('optimizedWeightsGrid');
    grid.innerHTML = '';
    for (let sym of SYMBOLS) {
        if (!(sym in weights)) continue;
        const card = document.createElement('div');
        card.className = 'editor-card';

        const h4 = document.createElement('h4');
        h4.textContent = sym;

        const val = document.createElement('div');
        val.style.fontFamily = "'Space Grotesk', sans-serif";
        val.style.fontSize   = '1.2rem';
        val.style.color      = '#fff';
        val.textContent      = Number(weights[sym]).toFixed(2);

        card.appendChild(h4);
        card.appendChild(val);
        grid.appendChild(card);
    }
}
