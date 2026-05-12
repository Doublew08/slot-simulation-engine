const PYTHON_API = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000'
    : 'https://slot-simulation-engine.onrender.com';

let fitnessChartInstance = null;
let currentMode = 'js';

const SYMBOLS = ["W", "H1", "H2", "M1", "M2", "L1", "L2", "SC", "CO"];
const N = SYMBOLS.length; // 9

// ── JS CMA-ES (pure math, no deps) ────────────────────────────────────────
// Operates in log-space so all weights stay positive.

function dot(a, b) {
    let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s;
}
function vecAdd(a, b) { return a.map((v, i) => v + b[i]); }
function vecSub(a, b) { return a.map((v, i) => v - b[i]); }
function vecScale(a, s) { return a.map(v => v * s); }
function matVec(M, v) { return M.map(row => dot(row, v)); }

function randn() {
    // Box-Muller
    let u = 0, v2 = 0;
    while (u === 0) u = Math.random();
    while (v2 === 0) v2 = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v2);
}

function randnVec(n) { return Array.from({ length: n }, randn); }

function eigenDecompose(C) {
    // Power iteration for symmetric matrix — sufficient for 9×9, ~30 iters
    const n = C.length;
    let B = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? 1 : 0));
    let D = C.map(row => [...row]);

    for (let iter = 0; iter < 60; iter++) {
        for (let p = 0; p < n - 1; p++) {
            for (let q = p + 1; q < n; q++) {
                if (Math.abs(D[p][q]) < 1e-15) continue;
                const theta = 0.5 * Math.atan2(2 * D[p][q], D[q][q] - D[p][p]);
                const c = Math.cos(theta), s = Math.sin(theta);
                // Jacobi rotation
                const newD = D.map(r => [...r]);
                for (let i = 0; i < n; i++) {
                    newD[i][p] = c * D[i][p] + s * D[i][q];
                    newD[i][q] = -s * D[i][p] + c * D[i][q];
                }
                for (let i = 0; i < n; i++) {
                    D[p][i] = c * newD[p][i] + s * newD[q][i];
                    D[q][i] = -s * newD[p][i] + c * newD[q][i];
                }
                D[p][q] = D[q][p] = 0;
                for (let i = 0; i < n; i++) {
                    const bip = B[i][p], biq = B[i][q];
                    B[i][p] = c * bip + s * biq;
                    B[i][q] = -s * bip + c * biq;
                }
            }
        }
    }
    const eigenvalues  = D.map((row, i) => row[i]);
    return { vectors: B, values: eigenvalues };
}

class CMAESOptimizer {
    constructor(x0, sigma0 = 0.3) {
        this.n      = x0.length;
        this.mean   = [...x0];
        this.sigma  = sigma0;

        // Strategy params
        this.lambda = 4 + Math.floor(3 * Math.log(this.n));   // popsize
        this.mu     = Math.floor(this.lambda / 2);

        // Weights for recombination
        const rawW  = Array.from({ length: this.mu }, (_, i) => Math.log(this.mu + 0.5) - Math.log(i + 1));
        const sumW  = rawW.reduce((a, b) => a + b, 0);
        this.weights = rawW.map(w => w / sumW);
        const muEff = 1 / this.weights.reduce((s, w) => s + w * w, 0);

        // Adaptation parameters
        this.cc  = (4 + muEff / this.n) / (this.n + 4 + 2 * muEff / this.n);
        this.cs  = (muEff + 2) / (this.n + muEff + 5);
        this.c1  = 2 / ((this.n + 1.3) ** 2 + muEff);
        this.cmu = Math.min(1 - this.c1, 2 * (muEff - 2 + 1 / muEff) / ((this.n + 2) ** 2 + muEff));
        this.damps = 1 + 2 * Math.max(0, Math.sqrt((muEff - 1) / (this.n + 1)) - 1) + this.cs;
        this.chiN  = Math.sqrt(this.n) * (1 - 1 / (4 * this.n) + 1 / (21 * this.n ** 2));

        // State
        this.pc   = new Array(this.n).fill(0);
        this.ps   = new Array(this.n).fill(0);
        this.B    = Array.from({ length: this.n }, (_, i) =>
                        Array.from({ length: this.n }, (_, j) => i === j ? 1 : 0));
        this.D    = new Array(this.n).fill(1);
        this.C    = Array.from({ length: this.n }, (_, i) =>
                        Array.from({ length: this.n }, (_, j) => i === j ? 1 : 0));
        this.invsqrtC = [...this.B.map(r => [...r])];  // identity initially
        this.eigeneval = 0;
        this.counteval = 0;
    }

    ask() {
        const samples = [];
        for (let k = 0; k < this.lambda; k++) {
            const z = randnVec(this.n);
            const Bz = matVec(this.B, z.map((zi, i) => zi * this.D[i]));
            samples.push(vecAdd(this.mean, vecScale(Bz, this.sigma)));
        }
        this._lastZ = [];
        for (let k = 0; k < this.lambda; k++) {
            const z = randnVec(this.n);
            this._lastZ.push(z);
        }
        // Recompute properly with stored z
        this._lastSamples = [];
        for (let k = 0; k < this.lambda; k++) {
            const z   = this._lastZ[k];
            const dz  = z.map((zi, i) => zi * this.D[i]);
            const Bdz = matVec(this.B, dz);
            this._lastSamples.push({ x: vecAdd(this.mean, vecScale(Bdz, this.sigma)), z, dz: Bdz });
        }
        return this._lastSamples.map(s => s.x);
    }

    tell(fitnesses) {
        // Sort by fitness (ascending)
        const order = fitnesses.map((f, i) => ({ f, i })).sort((a, b) => a.f - b.f);
        const bestIndices = order.slice(0, this.mu).map(o => o.i);

        const oldMean = [...this.mean];
        this.mean = new Array(this.n).fill(0);
        for (let j = 0; j < this.mu; j++) {
            const s = this._lastSamples[bestIndices[j]];
            for (let i = 0; i < this.n; i++) this.mean[i] += this.weights[j] * s.x[i];
        }

        const meanDiff = vecSub(this.mean, oldMean);
        const meanDiffNorm = vecScale(meanDiff, 1 / this.sigma);

        // Cumulation for sigma (ps)
        const invsqrtC_md = matVec(this.invsqrtC, meanDiffNorm);
        this.ps = vecAdd(
            vecScale(this.ps, 1 - this.cs),
            vecScale(invsqrtC_md, Math.sqrt(this.cs * (2 - this.cs) * this.mu))
        );

        const psNorm = Math.sqrt(dot(this.ps, this.ps));
        const hsig   = psNorm / Math.sqrt(1 - (1 - this.cs) ** (2 * (this.counteval + this.lambda) / this.lambda)) / this.chiN < 1.4 + 2 / (this.n + 1) ? 1 : 0;

        // Cumulation for covariance (pc)
        this.pc = vecAdd(
            vecScale(this.pc, 1 - this.cc),
            vecScale(meanDiffNorm, hsig * Math.sqrt(this.cc * (2 - this.cc) * this.mu))
        );

        // Covariance matrix update
        const dhs = (1 - hsig) * this.cc * (2 - this.cc);
        for (let i = 0; i < this.n; i++) {
            for (let j = 0; j < this.n; j++) {
                this.C[i][j] = (1 - this.c1 - this.cmu) * this.C[i][j]
                    + this.c1 * (this.pc[i] * this.pc[j] + dhs * this.C[i][j]);
                for (let k2 = 0; k2 < this.mu; k2++) {
                    const s = this._lastSamples[bestIndices[k2]];
                    const sd = vecScale(vecSub(s.x, oldMean), 1 / this.sigma);
                    this.C[i][j] += this.cmu * this.weights[k2] * sd[i] * sd[j];
                }
            }
        }

        // Sigma update
        this.sigma *= Math.exp((this.cs / this.damps) * (psNorm / this.chiN - 1));

        this.counteval += this.lambda;

        // Eigendecompose periodically
        if (this.counteval - this.eigeneval > this.lambda / (this.c1 + this.cmu) / this.n / 10) {
            this.eigeneval = this.counteval;
            const { vectors, values } = eigenDecompose(this.C);
            this.B = vectors;
            this.D = values.map(v => Math.sqrt(Math.max(0, v)));
            // Compute invsqrtC = B * diag(1/D) * B^T
            this.invsqrtC = Array.from({ length: this.n }, (_, i) =>
                Array.from({ length: this.n }, (_, j) => {
                    let s = 0;
                    for (let k2 = 0; k2 < this.n; k2++) {
                        s += vectors[i][k2] * (this.D[k2] > 1e-12 ? 1 / this.D[k2] : 0) * vectors[j][k2];
                    }
                    return s;
                })
            );
        }
    }

    get bestSigma() { return this.sigma; }
    converged() { return this.sigma < 1e-6; }
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

function updateMetrics(bestRtp, error, countLabel, countValue) {
    document.getElementById('mBestRtp').innerText  = (bestRtp * 100).toFixed(4) + '%';
    document.getElementById('mError').innerText    = (error   * 100).toFixed(4) + '%';
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

// ── JS CMA-ES run ──────────────────────────────────────────────────────────

const DEFAULT_W = { W: 4.0, H1: 4.0, H2: 5.0, M1: 6.0, M2: 7.0, L1: 10.0, L2: 12.0, SC: 2.0, CO: 3.0 };

async function runJsCmaEs(targetRtp, maxEvals, spinsPerEval) {
    const x0  = SYMBOLS.map(s => Math.log(DEFAULT_W[s]));
    const es  = new CMAESOptimizer(x0, 0.3);

    let evalCount    = 0;
    let bestFitness  = Infinity;
    let bestRtp      = 0;
    let bestWeights  = null;
    let rtpHistory   = [];
    let bestHistory  = [];

    while (!es.converged() && evalCount < maxEvals) {
        const xs       = es.ask();
        const fitnesses = [];

        for (let k = 0; k < xs.length && evalCount < maxEvals; k++) {
            const weights = {};
            SYMBOLS.forEach((s, i) => { weights[s] = Math.exp(xs[k][i]); });

            let sim = new Simulation();
            sim.setupGame(weights, 0.05);
            const results = await sim.runSimulation(spinsPerEval, () => {});
            const rtp     = results.total_rtp;
            const fitness = Math.abs(rtp - targetRtp);
            fitnesses.push(fitness);
            evalCount++;

            if (fitness < bestFitness) {
                bestFitness = fitness;
                bestRtp     = rtp;
                bestWeights = Object.fromEntries(SYMBOLS.map((s, i) => [s, Math.exp(xs[k][i])]));
            }

            rtpHistory.push(rtp * 100);
            bestHistory.push(bestRtp * 100);

            updateMetrics(bestRtp, bestFitness, 'Evaluations', evalCount);
            renderOptimizedWeights(bestWeights);
            renderFitnessChart(bestHistory, rtpHistory, targetRtp * 100, 'Eval');
            setProgress((evalCount / maxEvals) * 100, `Evaluation ${evalCount} / ${maxEvals}  σ=${es.bestSigma.toFixed(4)}`);

            if (bestFitness < 0.0005) break;
        }

        // Pad fitnesses if we hit maxEvals mid-batch
        while (fitnesses.length < xs.length) fitnesses.push(1e9);
        es.tell(fitnesses);

        if (bestFitness < 0.0005) break;
    }

    setProgress(100, 'JS CMA-ES Complete!');
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

    let rtpHistory  = [];
    let bestHistory = [];

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
                rtpHistory.push(msg.rtp * 100);
                bestHistory.push((msg.best_rtp ?? msg.rtp) * 100);
                setProgress((msg.eval / msg.total) * 100, `Evaluation ${msg.eval} / ${msg.total}`);
                updateMetrics(msg.best_rtp ?? msg.rtp, msg.fitness, 'Evaluations', msg.eval);
                renderOptimizedWeights(msg.weights);
                renderFitnessChart(bestHistory, rtpHistory, targetRtp * 100, 'Eval');
            } else if (msg.type === 'done') {
                bestWeights = msg.weights;
                updateMetrics(msg.rtp, msg.delta, 'Evaluations', msg.evals);
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
            modeStatus.textContent = 'Browser CMA-ES — no server required, runs in JS';
        } else {
            modePyBtn.classList.add('active');
            modeJsBtn.classList.remove('active');
            pyNotice.style.display = '';
            modeStatus.textContent = 'Python CMA-ES — server-side, uses scipy-quality optimizer';
        }
    }

    modeJsBtn.addEventListener('click', () => setMode('js'));
    modePyBtn.addEventListener('click', () => setMode('py'));

    document.getElementById('runEvolveBtn').addEventListener('click', async () => {
        const targetRtp = parseFloat(document.getElementById('targetRtp').value) / 100 || 0.96;
        setRunning(true);

        try {
            let bestWeights;
            const maxEvals     = parseInt(document.getElementById('maxEvals').value)     || 80;
            const spinsPerEval = parseInt(document.getElementById('spinsPerEval').value) || 50_000;

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

// XSS-safe: builds DOM nodes, whitelists symbol keys
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

function renderFitnessChart(bestHistory, currentHistory, targetRtp, xLabel = 'Eval') {
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
                    label: 'Best RTP So Far',
                    data: bestHistory,
                    borderColor: '#8b5cf6',
                    backgroundColor: 'rgba(139,92,246,0.15)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.1,
                    pointRadius: 2,
                },
                {
                    label: 'Current Eval RTP',
                    data: currentHistory,
                    borderColor: '#60a5fa',
                    borderWidth: 1.5,
                    borderDash: [3, 3],
                    pointRadius: 1,
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
