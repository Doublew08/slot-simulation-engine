let fitnessChartInstance = null;
let activeWorker = null;

const DEFAULT_WEIGHTS = { W: 1, H1: 2, H2: 2, M1: 3, M2: 3, L1: 30, L2: 35, SC: 1, CO: 2 };

// ── Chart ──────────────────────────────────────────────────────────────────

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
                    label: 'RTP (%)',
                    data: [],
                    borderColor: '#60a5fa',
                    backgroundColor: 'rgba(96,165,250,0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.1,
                    pointRadius: 2,
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
                title: { display: true, text: 'Robbins-Monro Convergence', font: { size: 16 } },
                legend: { display: true },
            },
            scales: {
                y: { grid: { color: 'rgba(255,255,255,0.05)' } },
            },
        },
    });
}

function pushChartPoint(iter, rtp, targetRtp) {
    if (!fitnessChartInstance) return;
    const c = fitnessChartInstance;
    c.data.labels.push(`Iter ${iter}`);
    c.data.datasets[0].data.push(rtp);
    c.data.datasets[1].data.push(targetRtp);
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

function updateMetrics(rtp, error, wildWeight) {
    document.getElementById('mBestRtp').innerText  = (rtp   * 100).toFixed(4) + '%';
    document.getElementById('mError').innerText    = (error * 100).toFixed(4) + '%';
    document.getElementById('mGenCount').innerText = Number(wildWeight).toFixed(4);
}

function wireSendToMain(wildWeight) {
    const weights = { ...DEFAULT_WEIGHTS, W: wildWeight };
    const config  = { spins: 1_000_000, coinProb: 0.05, bonusBuy: false, weights };
    const encoded = encodeURIComponent(btoa(JSON.stringify(config)));
    const btn     = document.getElementById('sendToMainBtn');
    btn.href      = `index.html#sim=${encoded}`;
    btn.style.display = 'block';
}

// ── Robbins-Monro via Web Worker ───────────────────────────────────────────

function runRobbinsMonro(targetRtp, maxIter, spinsPerEval) {
    return new Promise((resolve, reject) => {
        if (activeWorker) { activeWorker.terminate(); activeWorker = null; }

        const worker = new Worker('balancer.worker.js');
        activeWorker = worker;

        initChart(targetRtp * 100);

        worker.onmessage = (e) => {
            const msg = e.data;
            if (msg.type === 'progress') {
                pushChartPoint(msg.iter, msg.rtp * 100, targetRtp * 100);
                setProgress((msg.iter / msg.total) * 100, `Iteration ${msg.iter} / ${msg.total}`);
                updateMetrics(msg.rtp, msg.fitness, msg.best_x);
            } else if (msg.type === 'done') {
                activeWorker = null;
                worker.terminate();
                updateMetrics(msg.target, msg.delta, msg.wild_weight);
                setProgress(100, `Converged in ${msg.iters} iterations`);
                resolve(msg.wild_weight);
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

        worker.postMessage({ type: 'start', targetRtp, maxIter, spinsPerEval });
    });
}

// ── Run handler ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('runEvolveBtn').addEventListener('click', async () => {
        const targetRtp    = parseFloat(document.getElementById('targetRtp').value)    / 100 || 0.96;
        const maxIter      = parseInt(document.getElementById('maxIter').value)               || 30;
        const spinsPerEval = parseInt(document.getElementById('spinsPerEval').value)          || 100_000;
        setRunning(true);

        try {
            const wildWeight = await runRobbinsMonro(targetRtp, maxIter, spinsPerEval);
            wireSendToMain(wildWeight);
        } catch (err) {
            document.getElementById('evolveProgressText').innerText = `Error: ${err.message}`;
        } finally {
            setRunning(false);
            document.getElementById('evolveBtnText').style.display = 'block';
        }
    });
});
