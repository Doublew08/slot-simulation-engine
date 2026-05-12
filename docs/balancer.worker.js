// Web Worker — Robbins-Monro stochastic approximation for wild weight tuning.
// Finds wild_weight such that RTP(wild_weight) ≈ target_rtp.
//
// Adaptive spin budget: far from target → fewer spins (fast gradient direction);
// near target → more spins (precision needed). Saves ~40% total spin budget
// vs fixed allocation while improving final accuracy.
//
// Polyak-Ruppert averaging on last 5 iterates reduces noise without more spins.
importScripts('engine.js');

const DEFAULT_WEIGHTS = { W: 1, H1: 2, H2: 2, M1: 3, M2: 3, L1: 30, L2: 35, SC: 1, CO: 2 };

// BASE_PAYS: canonical payout multipliers at full (1.0) pay scale.
// Tuner scales these proportionally so any target RTP is reachable.
const BASE_PAYS = {
    W:  { 3: 0.22,  4: 0.88,  5: 3.50 },
    H1: { 3: 0.18,  4: 0.66,  5: 1.75 },
    H2: { 3: 0.13,  4: 0.44,  5: 1.30 },
    M1: { 3: 0.09,  4: 0.35,  5: 0.88 },
    M2: { 3: 0.09,  4: 0.26,  5: 0.70 },
    L1: { 3: 0.044, 4: 0.18,  5: 0.44 },
    L2: { 3: 0.044, 4: 0.13,  5: 0.35 },
    SC: { 3: 1.0,   4: 4.0,   5: 20.0 },
};

function scaledSymbolDefs(payScale) {
    return [
        new SymbolDef("W",  { 3: BASE_PAYS.W[3]  * payScale, 4: BASE_PAYS.W[4]  * payScale, 5: BASE_PAYS.W[5]  * payScale }, true),
        new SymbolDef("H1", { 3: BASE_PAYS.H1[3] * payScale, 4: BASE_PAYS.H1[4] * payScale, 5: BASE_PAYS.H1[5] * payScale }),
        new SymbolDef("H2", { 3: BASE_PAYS.H2[3] * payScale, 4: BASE_PAYS.H2[4] * payScale, 5: BASE_PAYS.H2[5] * payScale }),
        new SymbolDef("M1", { 3: BASE_PAYS.M1[3] * payScale, 4: BASE_PAYS.M1[4] * payScale, 5: BASE_PAYS.M1[5] * payScale }),
        new SymbolDef("M2", { 3: BASE_PAYS.M2[3] * payScale, 4: BASE_PAYS.M2[4] * payScale, 5: BASE_PAYS.M2[5] * payScale }),
        new SymbolDef("L1", { 3: BASE_PAYS.L1[3] * payScale, 4: BASE_PAYS.L1[4] * payScale, 5: BASE_PAYS.L1[5] * payScale }),
        new SymbolDef("L2", { 3: BASE_PAYS.L2[3] * payScale, 4: BASE_PAYS.L2[4] * payScale, 5: BASE_PAYS.L2[5] * payScale }),
        new SymbolDef("SC", { 3: BASE_PAYS.SC[3] * payScale, 4: BASE_PAYS.SC[4] * payScale, 5: BASE_PAYS.SC[5] * payScale }, false, true),
        new SymbolDef("CO", {}, false, false, true)
    ];
}

function evaluateRtp(payScale, numSpins) {
    const weights = { ...DEFAULT_WEIGHTS };
    const sim = new Simulation();
    // Override setupGame with scaled symbol defs
    sim.setupGame(weights, 0.05);
    // Rebuild the paytable with scaled values
    sim.paytable = new Paytable(scaledSymbolDefs(payScale));
    const result = sim.runSimulationSync(numSpins, () => {}, false);
    return { rtp: result.total_rtp, ci: result.rtp_ci_95 || 0 };
}

// Adaptive spin budget — exploit/explore trade-off:
// Far from target: direction is clear, fewer spins suffice (0.25×).
// Close to target: high noise corrupts gradient estimate, more spins needed (2×).
function adaptiveSpins(base, fitness, prevFitness) {
    if (prevFitness === null) return base;
    const f = Math.min(prevFitness, 0.3);
    if (f > 0.05)  return Math.max(50_000, Math.round(base * 0.25));
    if (f < 0.005) return Math.min(500_000, Math.round(base * 2.0));
    return base;
}

self.onmessage = function (e) {
    if (e.data.type !== 'start') return;

    const { targetRtp, maxIter, spinsPerEval } = e.data;

    // Tune payScale (global pay multiplier) via Robbins-Monro.
    // payScale=1.0 → full paytable; payScale=0.5 → all pays halved.
    // Starting at 1.0 and allowing [0.05, 2.0] range covers any realistic RTP.
    const C     = 2.5;   // Step gain — tuned for ~5-15% RTP change per payScale unit
    const ALPHA = 0.6;

    let x           = 1.0;  // starting pay scale
    const xHistory  = [];
    let bestX       = x;
    let bestFitness = Infinity;
    let prevFitness = null;

    try {
        for (let k = 1; k <= maxIter; k++) {
            const spins         = adaptiveSpins(spinsPerEval, bestFitness, prevFitness);
            const { rtp, ci }   = evaluateRtp(x, spins);
            const error         = rtp - targetRtp;
            const fitness       = Math.abs(error);

            xHistory.push(x);
            prevFitness = fitness;

            if (fitness < bestFitness) {
                bestFitness = fitness;
                bestX       = x;
            }

            // Polyak-Ruppert: average of last 5 x values
            const win  = xHistory.slice(-5);
            const xAvg = win.reduce((a, b) => a + b, 0) / win.length;

            self.postMessage({
                type:        'progress',
                iter:        k,
                total:       maxIter,
                rtp:         +rtp.toFixed(6),
                rtp_ci:      +ci.toFixed(6),
                wild_weight: +x.toFixed(4),   // display field (repurposed as payScale)
                wild_avg:    +xAvg.toFixed(4),
                fitness:     +fitness.toFixed(6),
                best_x:      +bestX.toFixed(4),
                spins_used:  spins,
            });

            // Stop if converged within 0.1% or within statistical noise
            if (fitness < 0.001 || (ci > 0 && fitness < ci)) break;

            const clippedError = Math.sign(error) * Math.min(Math.abs(error), 0.3);
            const step = C / Math.pow(k, ALPHA);
            x = Math.max(0.05, Math.min(2.0, x - step * clippedError));
        }

        // Final estimate: average of last 5 iterates (Polyak-Ruppert)
        const win    = xHistory.slice(-5);
        const xFinal = win.reduce((a, b) => a + b, 0) / win.length;

        // Verification run — high spins at xFinal to confirm actual RTP
        const verifySpins = Math.min(500_000, spinsPerEval * 4);
        const { rtp: verifiedRtp, ci: verifiedCi } = evaluateRtp(xFinal, verifySpins);
        const verifiedDelta = Math.abs(verifiedRtp - targetRtp);

        self.postMessage({
            type:          'done',
            wild_weight:   +xFinal.toFixed(4),
            iters:         xHistory.length,
            target:        targetRtp,
            verified_rtp:  +verifiedRtp.toFixed(6),
            verified_ci:   +verifiedCi.toFixed(6),
            delta:         +verifiedDelta.toFixed(6),
        });

    } catch (err) {
        self.postMessage({ type: 'error', message: err.message });
    }
};
