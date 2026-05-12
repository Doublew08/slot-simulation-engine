// Web Worker — runs CMA-ES optimization entirely off the main thread.
importScripts('engine.js');

const SYMBOLS = ["W", "H1", "H2", "M1", "M2", "L1", "L2", "SC", "CO"];
const N = SYMBOLS.length;

// ── Math helpers ───────────────────────────────────────────────────────────

function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
function vecAdd(a, b)    { return a.map((v, i) => v + b[i]); }
function vecSub(a, b)    { return a.map((v, i) => v - b[i]); }
function vecScale(a, s)  { return a.map(v => v * s); }
function matVec(M, v)    { return M.map(row => dot(row, v)); }

function randn() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function identity(n) {
    return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? 1 : 0));
}

function jacobi(C) {
    const n = C.length;
    let D = C.map(r => [...r]);
    let V = identity(n);
    for (let iter = 0; iter < 60; iter++) {
        for (let p = 0; p < n - 1; p++) {
            for (let q = p + 1; q < n; q++) {
                if (Math.abs(D[p][q]) < 1e-15) continue;
                const theta = 0.5 * Math.atan2(2 * D[p][q], D[q][q] - D[p][p]);
                const c = Math.cos(theta), s = Math.sin(theta);
                const newD = D.map(r => [...r]);
                for (let i = 0; i < n; i++) {
                    newD[i][p] =  c * D[i][p] + s * D[i][q];
                    newD[i][q] = -s * D[i][p] + c * D[i][q];
                }
                for (let i = 0; i < n; i++) {
                    D[p][i] =  c * newD[p][i] + s * newD[q][i];
                    D[q][i] = -s * newD[p][i] + c * newD[q][i];
                }
                D[p][q] = D[q][p] = 0;
                for (let i = 0; i < n; i++) {
                    const vip = V[i][p], viq = V[i][q];
                    V[i][p] =  c * vip + s * viq;
                    V[i][q] = -s * vip + c * viq;
                }
            }
        }
    }
    return { vectors: V, values: D.map((r, i) => r[i]) };
}

// ── CMA-ES ─────────────────────────────────────────────────────────────────

class CMAES {
    constructor(x0, sigma0 = 0.3) {
        this.n      = x0.length;
        this.mean   = [...x0];
        this.sigma  = sigma0;
        this.lambda = 4 + Math.floor(3 * Math.log(this.n));
        this.mu     = Math.floor(this.lambda / 2);

        const rawW  = Array.from({ length: this.mu }, (_, i) => Math.log(this.mu + 0.5) - Math.log(i + 1));
        const sumW  = rawW.reduce((a, b) => a + b, 0);
        this.weights = rawW.map(w => w / sumW);
        const muEff  = 1 / this.weights.reduce((s, w) => s + w * w, 0);

        this.cc    = (4 + muEff / this.n) / (this.n + 4 + 2 * muEff / this.n);
        this.cs    = (muEff + 2) / (this.n + muEff + 5);
        this.c1    = 2 / ((this.n + 1.3) ** 2 + muEff);
        this.cmu   = Math.min(1 - this.c1, 2 * (muEff - 2 + 1 / muEff) / ((this.n + 2) ** 2 + muEff));
        this.damps = 1 + 2 * Math.max(0, Math.sqrt((muEff - 1) / (this.n + 1)) - 1) + this.cs;
        this.chiN  = Math.sqrt(this.n) * (1 - 1 / (4 * this.n) + 1 / (21 * this.n ** 2));

        this.pc   = new Array(this.n).fill(0);
        this.ps   = new Array(this.n).fill(0);
        this.B    = identity(this.n);
        this.D    = new Array(this.n).fill(1);
        this.C    = identity(this.n);
        this.invsqrtC = identity(this.n);
        this.eigeneval = 0;
        this.counteval = 0;
    }

    ask() {
        this._zs = [];
        this._xs = [];
        for (let k = 0; k < this.lambda; k++) {
            const z   = Array.from({ length: this.n }, randn);
            const dz  = z.map((zi, i) => zi * this.D[i]);
            const Bdz = matVec(this.B, dz);
            this._zs.push(Bdz);
            this._xs.push(vecAdd(this.mean, vecScale(Bdz, this.sigma)));
        }
        return this._xs;
    }

    tell(fitnesses) {
        const order = fitnesses.map((f, i) => ({ f, i })).sort((a, b) => a.f - b.f);
        const top   = order.slice(0, this.mu).map(o => o.i);

        const oldMean = [...this.mean];
        this.mean = new Array(this.n).fill(0);
        for (let j = 0; j < this.mu; j++) {
            const x = this._xs[top[j]];
            for (let i = 0; i < this.n; i++) this.mean[i] += this.weights[j] * x[i];
        }

        const md     = vecSub(this.mean, oldMean);
        const mdNorm = vecScale(md, 1 / this.sigma);

        const invsqrtC_md = matVec(this.invsqrtC, mdNorm);
        this.ps = vecAdd(
            vecScale(this.ps, 1 - this.cs),
            vecScale(invsqrtC_md, Math.sqrt(this.cs * (2 - this.cs) * this.mu))
        );

        const psNorm = Math.sqrt(dot(this.ps, this.ps));
        const hsig   = (psNorm / Math.sqrt(1 - (1 - this.cs) ** (2 * (this.counteval + this.lambda) / this.lambda)) / this.chiN) < (1.4 + 2 / (this.n + 1)) ? 1 : 0;

        this.pc = vecAdd(
            vecScale(this.pc, 1 - this.cc),
            vecScale(mdNorm, hsig * Math.sqrt(this.cc * (2 - this.cc) * this.mu))
        );

        const dhs = (1 - hsig) * this.cc * (2 - this.cc);
        for (let i = 0; i < this.n; i++) {
            for (let j = 0; j < this.n; j++) {
                this.C[i][j] = (1 - this.c1 - this.cmu) * this.C[i][j]
                    + this.c1 * (this.pc[i] * this.pc[j] + dhs * this.C[i][j]);
                for (let k = 0; k < this.mu; k++) {
                    const sd = vecScale(vecSub(this._xs[top[k]], oldMean), 1 / this.sigma);
                    this.C[i][j] += this.cmu * this.weights[k] * sd[i] * sd[j];
                }
            }
        }

        this.sigma *= Math.exp((this.cs / this.damps) * (psNorm / this.chiN - 1));
        this.counteval += this.lambda;

        if (this.counteval - this.eigeneval > this.lambda / (this.c1 + this.cmu) / this.n / 10) {
            this.eigeneval = this.counteval;
            const { vectors, values } = jacobi(this.C);
            this.B = vectors;
            this.D = values.map(v => Math.sqrt(Math.max(0, v)));
            this.invsqrtC = Array.from({ length: this.n }, (_, i) =>
                Array.from({ length: this.n }, (_, j) => {
                    let s = 0;
                    for (let k = 0; k < this.n; k++) {
                        s += vectors[i][k] * (this.D[k] > 1e-12 ? 1 / this.D[k] : 0) * vectors[j][k];
                    }
                    return s;
                })
            );
        }
    }

    converged() { return this.sigma < 1e-6; }
}

// ── Simulation helper ──────────────────────────────────────────────────────

function evaluateWeights(weights, numSpins) {
    const sim = new Simulation();
    sim.setupGame(weights, 0.05);
    return sim.runSimulationSync(numSpins, () => {}, false);
}

// ── Main worker loop ───────────────────────────────────────────────────────

self.onmessage = function (e) {
    if (e.data.type !== 'start') return;

    const { targetRtp, maxEvals, spinsPerEval } = e.data;
    const DEFAULT_W = { W: 4.0, H1: 4.0, H2: 5.0, M1: 6.0, M2: 7.0, L1: 10.0, L2: 12.0, SC: 2.0, CO: 3.0 };
    const x0 = SYMBOLS.map(s => Math.log(DEFAULT_W[s]));
    const es = new CMAES(x0, 0.3);

    let evalCount   = 0;
    let bestFitness = Infinity;
    let bestRtp     = 0;
    let bestWeights = null;

    try {
        while (!es.converged() && evalCount < maxEvals) {
            const xs       = es.ask();
            const fits     = [];

            for (let k = 0; k < xs.length; k++) {
                if (evalCount >= maxEvals) { fits.push(1e9); continue; }

                const weights = {};
                SYMBOLS.forEach((s, i) => { weights[s] = Math.exp(xs[k][i]); });

                const result  = evaluateWeights(weights, spinsPerEval);
                const rtp     = result.total_rtp;
                const fitness = Math.abs(rtp - targetRtp);
                fits.push(fitness);
                evalCount++;

                if (fitness < bestFitness) {
                    bestFitness = fitness;
                    bestRtp     = rtp;
                    bestWeights = Object.fromEntries(SYMBOLS.map((s, i) => [s, +Math.exp(xs[k][i]).toFixed(4)]));
                }

                self.postMessage({
                    type:      'progress',
                    eval:      evalCount,
                    total:     maxEvals,
                    rtp:       +rtp.toFixed(6),
                    fitness:   +fitness.toFixed(6),
                    best_rtp:  +bestRtp.toFixed(6),
                    weights:   Object.fromEntries(SYMBOLS.map((s, i) => [s, +Math.exp(xs[k][i]).toFixed(4)])),
                });

                if (bestFitness < 0.0005) break;
            }

            while (fits.length < xs.length) fits.push(1e9);
            es.tell(fits);
            if (bestFitness < 0.0005) break;
        }

        self.postMessage({
            type:    'done',
            weights: bestWeights || {},
            rtp:     +bestRtp.toFixed(6),
            evals:   evalCount,
            target:  targetRtp,
            delta:   +bestFitness.toFixed(6),
        });

    } catch (err) {
        self.postMessage({ type: 'error', message: err.message });
    }
};
