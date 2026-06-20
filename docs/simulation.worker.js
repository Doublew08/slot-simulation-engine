// Web Worker — runs the simulation synchronously off the main thread.
// importScripts loads engine.js into the worker scope.
importScripts('engine.js');



function applyPayScale(sim, ps) {
    const scaledDefs = [
        new SymbolDef("W",  { 3: BASE_PAYS.W[3]  * ps, 4: BASE_PAYS.W[4]  * ps, 5: BASE_PAYS.W[5]  * ps }, true),
        new SymbolDef("H1", { 3: BASE_PAYS.H1[3] * ps, 4: BASE_PAYS.H1[4] * ps, 5: BASE_PAYS.H1[5] * ps }),
        new SymbolDef("H2", { 3: BASE_PAYS.H2[3] * ps, 4: BASE_PAYS.H2[4] * ps, 5: BASE_PAYS.H2[5] * ps }),
        new SymbolDef("M1", { 3: BASE_PAYS.M1[3] * ps, 4: BASE_PAYS.M1[4] * ps, 5: BASE_PAYS.M1[5] * ps }),
        new SymbolDef("M2", { 3: BASE_PAYS.M2[3] * ps, 4: BASE_PAYS.M2[4] * ps, 5: BASE_PAYS.M2[5] * ps }),
        new SymbolDef("L1", { 3: BASE_PAYS.L1[3] * ps, 4: BASE_PAYS.L1[4] * ps, 5: BASE_PAYS.L1[5] * ps }),
        new SymbolDef("L2", { 3: BASE_PAYS.L2[3] * ps, 4: BASE_PAYS.L2[4] * ps, 5: BASE_PAYS.L2[5] * ps }),
        new SymbolDef("SC", { 3: BASE_PAYS.SC[3] * ps, 4: BASE_PAYS.SC[4] * ps, 5: BASE_PAYS.SC[5] * ps }, false, true),
        new SymbolDef("CO", {}, false, false, true)
    ];
    sim.paytable = new Paytable(scaledDefs);
}

let sim = null;

self.onmessage = function (e) {
    const { type, payload } = e.data;

    if (type === 'setup') {
        sim = new Simulation();
        sim.setupGame(payload.weights, payload.coinProb);
        if (payload.payScale && payload.payScale !== 1.0) applyPayScale(sim, payload.payScale);
        self.postMessage({ type: 'ready' });
        return;
    }

    if (type === 'run') {
        if (!sim) {
            sim = new Simulation();
            sim.setupGame(payload.weights, payload.coinProb);
        } else {
            // Re-apply weights in case they changed
            sim.setupGame(payload.weights, payload.coinProb);
        }
        // Apply pay scale from auto-balancer if present
        if (payload.payScale && payload.payScale !== 1.0) applyPayScale(sim, payload.payScale);

        const result = sim.runSimulationSync(
            payload.numSpins,
            (pct) => self.postMessage({ type: 'progress', value: pct }),
            payload.bonusBuyMode
        );

        self.postMessage({ type: 'done', result });
    }
};
