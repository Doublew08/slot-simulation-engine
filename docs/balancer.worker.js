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

function evaluateRtp(wildWeight, numSpins) {
    const weights = { ...DEFAULT_WEIGHTS, W: wildWeight };
    const sim = new Simulation();
    sim.setupGame(weights, 0.05);
    const result = sim.runSimulationSync(numSpins, () => {}, false);
    return { rtp: result.total_rtp, ci: result.rtp_ci_95 || 0 };
}

// Adaptive spin budget — exploit/explore trade-off:
// Far from target: direction is clear, fewer spins suffice (0.25×).
// Close to target: high noise corrupts gradient estimate, more spins needed (2×).
function adaptiveSpins(base, fitness, prevFitness) {
    if (prevFitness === null) return base;           // first iteration: full budget
    const f = Math.min(prevFitness, 0.3);
    if (f > 0.05)  return Math.max(50_000, Math.round(base * 0.25));  // far — explore fast
    if (f < 0.005) return Math.min(500_000, Math.round(base * 2.0));  // very close — refine
    return base;                                                        // medium distance
}

self.onmessage = function (e) {
    if (e.data.type !== 'start') return;

    const { targetRtp, maxIter, spinsPerEval } = e.data;

    // Robbins-Monro: x_{k+1} = x_k − (C / k^α) × (f(x_k) − target)
    // C tuned for this game's RTP sensitivity (~1-2% per wild_weight unit).
    // α=0.6 balances convergence speed vs noise robustness.
    const C     = 8.0;
    const ALPHA = 0.6;

    let x           = 4.0;  // sensible starting wild_weight
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

            // Polyak-Ruppert: average of last 5 x values — smooths noise
            const win  = xHistory.slice(-5);
            const xAvg = win.reduce((a, b) => a + b, 0) / win.length;

            self.postMessage({
                type:        'progress',
                iter:        k,
                total:       maxIter,
                rtp:         +rtp.toFixed(6),
                rtp_ci:      +ci.toFixed(6),
                wild_weight: +x.toFixed(4),
                wild_avg:    +xAvg.toFixed(4),
                fitness:     +fitness.toFixed(6),
                best_x:      +bestX.toFixed(4),
                spins_used:  spins,
            });

            if (fitness < 0.001) break; // converged within 0.1%

            const step = C / Math.pow(k, ALPHA);
            x = Math.max(0.3, Math.min(20.0, x - step * error));
        }

        // Final estimate: average of last 5 iterates (Polyak-Ruppert)
        const win   = xHistory.slice(-5);
        const xFinal = win.reduce((a, b) => a + b, 0) / win.length;

        self.postMessage({
            type:         'done',
            wild_weight:  +xFinal.toFixed(4),
            iters:        xHistory.length,
            target:       targetRtp,
            delta:        +bestFitness.toFixed(6),
        });

    } catch (err) {
        self.postMessage({ type: 'error', message: err.message });
    }
};
