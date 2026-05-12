// Web Worker — runs the simulation synchronously off the main thread.
// importScripts loads engine.js into the worker scope.
importScripts('engine.js');

let sim = null;

self.onmessage = function (e) {
    const { type, payload } = e.data;

    if (type === 'setup') {
        sim = new Simulation();
        sim.setupGame(payload.weights, payload.coinProb);
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

        const result = sim.runSimulationSync(
            payload.numSpins,
            (pct) => self.postMessage({ type: 'progress', value: pct }),
            payload.bonusBuyMode
        );

        self.postMessage({ type: 'done', result });
    }
};
