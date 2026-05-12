let fitnessChartInstance = null;

const SYMBOLS = ["W", "H1", "H2", "M1", "M2", "L1", "L2", "SC", "CO"];

function randomWeight(base) {
    return Math.max(0.5, base * (0.5 + Math.random()));
}

function generateInitialPopulation(size) {
    const baseWeights = { "W": 4.0, "H1": 4, "H2": 5, "M1": 6, "M2": 7, "L1": 10, "L2": 12, "SC": 2, "CO": 3 };
    return Array.from({ length: size }, (_, i) => {
        let ind = {};
        for (let sym of SYMBOLS) {
            ind[sym] = (i === 0) ? baseWeights[sym] : randomWeight(baseWeights[sym]);
        }
        return ind;
    });
}

function crossover(parentA, parentB) {
    let child = {};
    for (let sym of SYMBOLS) {
        child[sym] = Math.random() > 0.5 ? parentA[sym] : parentB[sym];
    }
    return child;
}

function mutate(individual, mutationRate) {
    for (let sym of SYMBOLS) {
        if (Math.random() < mutationRate) {
            let factor = 0.8 + Math.random() * 0.4;
            individual[sym] = Math.max(0.5, individual[sym] * factor);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const runEvolveBtn          = document.getElementById('runEvolveBtn');
    const evolveBtnText         = document.getElementById('evolveBtnText');
    const evolveBtnLoader       = document.getElementById('evolveBtnLoader');
    const evolveProgressContainer = document.getElementById('evolveProgressContainer');
    const evolveProgressBar     = document.getElementById('evolveProgressBar');
    const evolveProgressText    = document.getElementById('evolveProgressText');
    const sendToMainBtn         = document.getElementById('sendToMainBtn');

    runEvolveBtn.addEventListener('click', async () => {
        const targetRtp      = parseFloat(document.getElementById('targetRtp').value) / 100 || 0.96;
        const popSize        = parseInt(document.getElementById('popSize').value)        || 10;
        const maxGenerations = parseInt(document.getElementById('generations').value)    || 10;
        const SPINS_PER_TEST = parseInt(document.getElementById('spinsPerTest').value)  || 100_000;

        runEvolveBtn.disabled = true;
        evolveBtnText.style.display  = 'none';
        evolveBtnLoader.style.display = 'block';
        evolveProgressContainer.style.display = 'block';
        evolveProgressBar.style.width = '0%';
        sendToMainBtn.style.display = 'none';

        let population      = generateInitialPopulation(popSize);
        let bestRtpHistory  = [];
        let avgRtpHistory   = [];
        let bestWeights     = null;

        for (let gen = 0; gen < maxGenerations; gen++) {
            evolveProgressText.innerText = `Evaluating Generation ${gen + 1} / ${maxGenerations}...`;

            // Adaptive mutation: high early (exploration) → low late (refinement)
            const mutationRate = Math.max(0.1, 0.4 - (gen / maxGenerations) * 0.3);

            let evaluated = [];
            for (let i = 0; i < popSize; i++) {
                let sim = new Simulation();
                sim.setupGame(population[i], 0.05);
                let results = await sim.runSimulation(SPINS_PER_TEST, () => {});
                let error   = Math.abs(results.total_rtp - targetRtp);
                evaluated.push({ weights: population[i], rtp: results.total_rtp, error });
            }

            evaluated.sort((a, b) => a.error - b.error);

            const best  = evaluated[0];
            const avgRtp = evaluated.reduce((s, e) => s + e.rtp, 0) / evaluated.length;
            bestRtpHistory.push(best.rtp * 100);
            avgRtpHistory.push(avgRtp * 100);
            bestWeights = best.weights;

            document.getElementById('mBestRtp').innerText  = (best.rtp * 100).toFixed(4) + '%';
            document.getElementById('mError').innerText    = (best.error * 100).toFixed(4) + '%';
            document.getElementById('mGenCount').innerText = gen + 1;
            renderOptimizedWeights(best.weights);
            renderFitnessChart(bestRtpHistory, avgRtpHistory, targetRtp * 100);

            evolveProgressBar.style.width = `${((gen + 1) / maxGenerations) * 100}%`;

            if (best.error < 0.0005) break;

            if (gen < maxGenerations - 1) {
                let next = [evaluated[0].weights, evaluated[1].weights];  // elitism
                while (next.length < popSize) {
                    let pA = evaluated[Math.floor(Math.random() * (popSize / 2))].weights;
                    let pB = evaluated[Math.floor(Math.random() * (popSize / 2))].weights;
                    let child = crossover(pA, pB);
                    mutate(child, mutationRate);
                    next.push(child);
                }
                population = next;
            }
        }

        evolveProgressText.innerText = 'Evolution Complete!';
        runEvolveBtn.disabled = false;
        evolveBtnText.style.display  = 'block';
        evolveBtnLoader.style.display = 'none';

        // Wire "Send to Main Engine" deep-link
        if (bestWeights) {
            const config = { spins: 1_000_000, coinProb: 0.05, bonusBuy: false, weights: bestWeights };
            const encoded = encodeURIComponent(btoa(JSON.stringify(config)));
            sendToMainBtn.href = `index.html#sim=${encoded}`;
            sendToMainBtn.style.display = 'block';
        }
    });
});

// XSS-safe: builds DOM nodes with textContent, whitelists symbol keys
function renderOptimizedWeights(weights) {
    const grid    = document.getElementById('optimizedWeightsGrid');
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

function renderFitnessChart(bestHistory, avgHistory, targetRtp) {
    Chart.defaults.color       = '#94a3b8';
    Chart.defaults.font.family = "'Space Grotesk', sans-serif";

    if (fitnessChartInstance) fitnessChartInstance.destroy();

    const labels     = bestHistory.map((_, i) => `Gen ${i + 1}`);
    const targetLine = new Array(bestHistory.length).fill(targetRtp);

    fitnessChartInstance = new Chart(document.getElementById('fitnessChart').getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Best RTP',
                    data: bestHistory,
                    borderColor: '#8b5cf6',
                    backgroundColor: 'rgba(139,92,246,0.15)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.1,
                    pointRadius: 3,
                },
                {
                    label: 'Population Avg RTP',
                    data: avgHistory,
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
                title: { display: true, text: 'Genetic Convergence to Target', font: { size: 16 } },
                legend: { display: true },
            },
            scales: {
                y: { grid: { color: 'rgba(255,255,255,0.05)' } },
            },
        },
    });
}
