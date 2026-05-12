const PYTHON_API = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000'
    : 'https://slot-engine.onrender.com';

let fitnessChartInstance = null;
let currentMode = 'js'; // 'js' | 'py'

const SYMBOLS = ["W", "H1", "H2", "M1", "M2", "L1", "L2", "SC", "CO"];

// ── Genetic Algorithm helpers ──────────────────────────────────────────────

function randomWeight(base) {
    return Math.max(0.5, base * (0.5 + Math.random()));
}

function generateInitialPopulation(size) {
    const base = { W: 4.0, H1: 4, H2: 5, M1: 6, M2: 7, L1: 10, L2: 12, SC: 2, CO: 3 };
    return Array.from({ length: size }, (_, i) => {
        let ind = {};
        for (let sym of SYMBOLS) ind[sym] = (i === 0) ? base[sym] : randomWeight(base[sym]);
        return ind;
    });
}

// BLX-α crossover: samples within [min-α·d, max+α·d] for each gene
function crossoverBLX(pA, pB, alpha = 0.5) {
    let child = {};
    for (let sym of SYMBOLS) {
        const lo = Math.min(pA[sym], pB[sym]);
        const hi = Math.max(pA[sym], pB[sym]);
        const d  = hi - lo;
        child[sym] = Math.max(0.5, lo - alpha * d + Math.random() * (d * (1 + 2 * alpha)));
    }
    return child;
}

function mutate(individual, mutationRate) {
    for (let sym of SYMBOLS) {
        if (Math.random() < mutationRate) {
            individual[sym] = Math.max(0.5, individual[sym] * (0.8 + Math.random() * 0.4));
        }
    }
}

// Fitness sharing: penalise crowded solutions so population stays diverse
function applyFitnessSharing(evaluated, sigma = 0.3) {
    for (let i = 0; i < evaluated.length; i++) {
        let niche = 0;
        for (let j = 0; j < evaluated.length; j++) {
            let d = 0;
            for (let sym of SYMBOLS) {
                const diff = (evaluated[i].weights[sym] - evaluated[j].weights[sym]) /
                             (evaluated[i].weights[sym] + 1e-9);
                d += diff * diff;
            }
            d = Math.sqrt(d / SYMBOLS.length);
            if (d < sigma) niche += 1 - d / sigma;
        }
        evaluated[i].sharedError = evaluated[i].error * Math.max(1, niche);
    }
}

// ── Shared UI helpers ──────────────────────────────────────────────────────

function setRunning(yes) {
    const btn    = document.getElementById('runEvolveBtn');
    const text   = document.getElementById('evolveBtnText');
    const loader = document.getElementById('evolveBtnLoader');
    btn.disabled            = yes;
    text.style.display      = yes ? 'none'  : 'block';
    loader.style.display    = yes ? 'block' : 'none';
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

function updateMetrics(bestRtp, error, countLabel, countValue) {
    document.getElementById('mBestRtp').innerText  = (bestRtp * 100).toFixed(4) + '%';
    document.getElementById('mError').innerText    = (error  * 100).toFixed(4) + '%';
    document.getElementById('mGenLabel').innerText = countLabel;
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

// ── JS Genetic Algorithm run ───────────────────────────────────────────────

async function runGaMode(targetRtp, popSize, maxGenerations, spinsPerTest) {
    let population     = generateInitialPopulation(popSize);
    let bestRtpHistory = [];
    let avgRtpHistory  = [];
    let bestWeights    = null;
    let bestRtp        = 0;

    for (let gen = 0; gen < maxGenerations; gen++) {
        setProgress(0, `Evaluating Generation ${gen + 1} / ${maxGenerations}...`);
        const mutationRate = Math.max(0.1, 0.4 - (gen / maxGenerations) * 0.3);

        let evaluated = [];
        for (let i = 0; i < popSize; i++) {
            let sim = new Simulation();
            sim.setupGame(population[i], 0.05);
            let results = await sim.runSimulation(spinsPerTest, () => {});
            let error   = Math.abs(results.total_rtp - targetRtp);
            evaluated.push({ weights: population[i], rtp: results.total_rtp, error });
        }

        applyFitnessSharing(evaluated);
        evaluated.sort((a, b) => a.sharedError - b.sharedError);

        const best   = evaluated[0];
        const avgRtp = evaluated.reduce((s, e) => s + e.rtp, 0) / evaluated.length;
        bestRtpHistory.push(best.rtp * 100);
        avgRtpHistory.push(avgRtp * 100);
        bestWeights = best.weights;
        bestRtp     = best.rtp;

        updateMetrics(best.rtp, best.error, 'Generations Run', gen + 1);
        renderOptimizedWeights(best.weights);
        renderFitnessChart(bestRtpHistory, avgRtpHistory, targetRtp * 100, 'Generation');
        setProgress(((gen + 1) / maxGenerations) * 100, `Generation ${gen + 1} / ${maxGenerations}`);

        if (best.error < 0.0005) break;

        if (gen < maxGenerations - 1) {
            let next = [evaluated[0].weights, evaluated[1] ? evaluated[1].weights : evaluated[0].weights];
            while (next.length < popSize) {
                let pA    = evaluated[Math.floor(Math.random() * Math.ceil(popSize / 2))].weights;
                let pB    = evaluated[Math.floor(Math.random() * Math.ceil(popSize / 2))].weights;
                let child = crossoverBLX(pA, pB);
                mutate(child, mutationRate);
                next.push(child);
            }
            population = next;
        }
    }

    setProgress(100, 'Evolution Complete!');
    return bestWeights;
}

// ── Python CMA-ES run ──────────────────────────────────────────────────────

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

    const reader  = resp.body.getReader();
    const decoder = new TextDecoder();
    let   buf     = '';
    let   bestWeights = null;
    let   bestRtp     = 0;

    let rtpHistory  = [];
    let bestHistory = [];

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let lines = buf.split('\n');
        buf = lines.pop();

        for (let line of lines) {
            if (!line.startsWith('data: ')) continue;
            let msg;
            try { msg = JSON.parse(line.slice(6)); } catch { continue; }

            if (msg.type === 'progress') {
                const pct = (msg.eval / msg.total) * 100;
                setProgress(pct, `Evaluation ${msg.eval} / ${msg.total}`);

                rtpHistory.push(msg.rtp * 100);
                bestHistory.push((msg.best_rtp ?? msg.rtp) * 100);

                updateMetrics(
                    msg.best_rtp ?? msg.rtp,
                    msg.fitness,
                    'Evaluations',
                    msg.eval
                );
                renderOptimizedWeights(msg.weights);
                renderFitnessChart(bestHistory, rtpHistory, targetRtp * 100, 'Eval', true);

            } else if (msg.type === 'done') {
                bestWeights = msg.weights;
                bestRtp     = msg.rtp;
                updateMetrics(msg.rtp, msg.delta, 'Evaluations', msg.evals);
                renderOptimizedWeights(msg.weights);
                setProgress(100, 'CMA-ES Complete!');

            } else if (msg.type === 'error') {
                throw new Error(msg.message);
            }
        }
    }

    return bestWeights;
}

// ── Main click handler ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    // Mode toggle
    const modeJsBtn  = document.getElementById('modeJsBtn');
    const modePyBtn  = document.getElementById('modePyBtn');
    const modeStatus = document.getElementById('modeStatus');
    const jsOptions  = document.getElementById('jsOptions');
    const pyOptions  = document.getElementById('pyOptions');

    function setMode(mode) {
        currentMode = mode;
        if (mode === 'js') {
            modeJsBtn.classList.add('active');
            modePyBtn.classList.remove('active');
            jsOptions.style.display = '';
            pyOptions.style.display = 'none';
            modeStatus.textContent  = 'Browser-side genetic algorithm (no server required)';
        } else {
            modePyBtn.classList.add('active');
            modeJsBtn.classList.remove('active');
            jsOptions.style.display = 'none';
            pyOptions.style.display = '';
            modeStatus.textContent  = 'Python CMA-ES via server — more accurate, requires backend';
        }
    }

    modeJsBtn.addEventListener('click', () => setMode('js'));
    modePyBtn.addEventListener('click', () => setMode('py'));

    // Run button
    document.getElementById('runEvolveBtn').addEventListener('click', async () => {
        const targetRtp = parseFloat(document.getElementById('targetRtp').value) / 100 || 0.96;
        setRunning(true);

        try {
            let bestWeights;
            if (currentMode === 'js') {
                const popSize        = parseInt(document.getElementById('popSize').value)        || 10;
                const maxGenerations = parseInt(document.getElementById('generations').value)    || 10;
                const spinsPerTest   = parseInt(document.getElementById('spinsPerTest').value)  || 100_000;
                bestWeights = await runGaMode(targetRtp, popSize, maxGenerations, spinsPerTest);
            } else {
                const maxEvals     = parseInt(document.getElementById('maxEvals').value)     || 80;
                const spinsPerEval = parseInt(document.getElementById('spinsPerEval').value) || 50_000;
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

// XSS-safe: builds DOM nodes, whitelists symbol keys
function renderOptimizedWeights(weights) {
    const grid = document.getElementById('optimizedWeightsGrid');
    grid.innerHTML = '';
    for (let sym of SYMBOLS) {
        if (!(sym in weights)) continue;
        let card = document.createElement('div');
        card.className = 'editor-card';

        let h4 = document.createElement('h4');
        h4.textContent = sym;

        let val = document.createElement('div');
        val.style.fontFamily = "'Space Grotesk', sans-serif";
        val.style.fontSize   = '1.2rem';
        val.style.color      = '#fff';
        val.textContent      = Number(weights[sym]).toFixed(2);

        card.appendChild(h4);
        card.appendChild(val);
        grid.appendChild(card);
    }
}

function renderFitnessChart(bestHistory, secondHistory, targetRtp, xLabel = 'Generation', isCmaEs = false) {
    Chart.defaults.color       = '#94a3b8';
    Chart.defaults.font.family = "'Space Grotesk', sans-serif";

    if (fitnessChartInstance) fitnessChartInstance.destroy();

    const labels     = bestHistory.map((_, i) => `${xLabel} ${i + 1}`);
    const targetLine = new Array(bestHistory.length).fill(targetRtp);

    fitnessChartInstance = new Chart(document.getElementById('fitnessChart').getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: isCmaEs ? 'Best RTP So Far' : 'Best RTP',
                    data: bestHistory,
                    borderColor: '#8b5cf6',
                    backgroundColor: 'rgba(139,92,246,0.15)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.1,
                    pointRadius: 3,
                },
                {
                    label: isCmaEs ? 'Current Eval RTP' : 'Population Avg RTP',
                    data: secondHistory,
                    borderColor: '#60a5fa',
                    borderWidth: 1.5,
                    borderDash: [3, 3],
                    pointRadius: 2,
                    fill: false,
                    tension: 0.1,
                },
                {
                    label: 'Target RTP',
                    data: targetLine,
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
            plugins: {
                title: {
                    display: true,
                    text: isCmaEs ? 'CMA-ES Convergence' : 'Genetic Convergence to Target',
                    font: { size: 16 },
                },
                legend: { display: true },
            },
            scales: {
                y: { grid: { color: 'rgba(255,255,255,0.05)' } },
            },
        },
    });
}
