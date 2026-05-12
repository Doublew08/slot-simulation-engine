let fitnessChartInstance = null;
let activeWorker = null;

const SYMBOLS = ["W", "H1", "H2", "M1", "M2", "L1", "L2", "SC", "CO"];

// ── Chart — incremental updates ────────────────────────────────────────────

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
                    label: `Target ${targetRtp.toFixed(2)}%`,
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
    c.update('none');
}

// ── UI helpers ─────────────────────────────────────────────────────────────

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

// ── CMA-ES via Web Worker ──────────────────────────────────────────────────

function runCmaEs(targetRtp, maxEvals, spinsPerEval) {
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
                setProgress(100, 'CMA-ES Complete!');
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

// ── Run handler ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('runEvolveBtn').addEventListener('click', async () => {
        const targetRtp    = parseFloat(document.getElementById('targetRtp').value) / 100 || 0.96;
        const maxEvals     = parseInt(document.getElementById('maxEvals').value)     || 150;
        const spinsPerEval = parseInt(document.getElementById('spinsPerEval').value) || 200_000;
        setRunning(true);

        try {
            const bestWeights = await runCmaEs(targetRtp, maxEvals, spinsPerEval);
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
