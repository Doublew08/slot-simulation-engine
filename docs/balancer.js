let fitnessChartInstance = null;

const SYMBOLS = ["W", "H1", "H2", "M1", "M2", "L1", "L2", "SC", "CO"];

// Helper function to generate a random weight around a base
function randomWeight(base) {
    return Math.max(0.5, base * (0.5 + Math.random())); 
}

// Generate initial random population
function generateInitialPopulation(size) {
    const population = [];
    const baseWeights = { "W": 4.0, "H1": 4, "H2": 5, "M1": 6, "M2": 7, "L1": 10, "L2": 12, "SC": 2, "CO": 3 };
    
    for (let i = 0; i < size; i++) {
        let individual = {};
        for (let sym of SYMBOLS) {
            // First individual is exactly the base, others are randomized
            individual[sym] = (i === 0) ? baseWeights[sym] : randomWeight(baseWeights[sym]);
        }
        population.push(individual);
    }
    return population;
}

function crossover(parentA, parentB) {
    let child = {};
    for (let sym of SYMBOLS) {
        // 50% chance to inherit from either parent
        child[sym] = Math.random() > 0.5 ? parentA[sym] : parentB[sym];
    }
    return child;
}

function mutate(individual, mutationRate = 0.2) {
    for (let sym of SYMBOLS) {
        if (Math.random() < mutationRate) {
            // Mutate by +/- 20%
            let factor = 0.8 + (Math.random() * 0.4);
            individual[sym] = Math.max(0.5, individual[sym] * factor);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const runEvolveBtn = document.getElementById('runEvolveBtn');
    const evolveBtnText = document.getElementById('evolveBtnText');
    const evolveBtnLoader = document.getElementById('evolveBtnLoader');
    const evolveProgressContainer = document.getElementById('evolveProgressContainer');
    const evolveProgressBar = document.getElementById('evolveProgressBar');
    const evolveProgressText = document.getElementById('evolveProgressText');

    runEvolveBtn.addEventListener('click', async () => {
        const targetRtp = parseFloat(document.getElementById('targetRtp').value) / 100 || 0.96;
        const popSize = parseInt(document.getElementById('popSize').value) || 10;
        const maxGenerations = parseInt(document.getElementById('generations').value) || 10;
        const SPINS_PER_TEST = 100000; // Enough to get a solid heuristic RTP reading

        runEvolveBtn.disabled = true;
        evolveBtnText.style.display = 'none';
        evolveBtnLoader.style.display = 'block';
        evolveProgressContainer.style.display = 'block';
        evolveProgressBar.style.width = '0%';
        
        let population = generateInitialPopulation(popSize);
        let bestRtpHistory = [];

        for (let gen = 0; gen < maxGenerations; gen++) {
            evolveProgressText.innerText = `Evaluating Generation ${gen + 1} / ${maxGenerations}...`;
            
            // Evaluate Fitness for each individual
            let evaluated = [];
            for (let i = 0; i < popSize; i++) {
                let weights = population[i];
                let sim = new Simulation();
                sim.setupGame(weights, 0.05);
                let results = await sim.runSimulation(SPINS_PER_TEST, () => {}); // Await each fast run
                
                let error = Math.abs(results.total_rtp - targetRtp);
                evaluated.push({ weights: weights, rtp: results.total_rtp, error: error });
            }

            // Sort by error (lowest error is best fitness)
            evaluated.sort((a, b) => a.error - b.error);
            
            let bestOfGen = evaluated[0];
            bestRtpHistory.push(bestOfGen.rtp * 100);

            // Update UI with current best
            document.getElementById('mBestRtp').innerText = (bestOfGen.rtp * 100).toFixed(4) + '%';
            document.getElementById('mError').innerText = (bestOfGen.error * 100).toFixed(4) + '%';
            document.getElementById('mGenCount').innerText = gen + 1;
            renderOptimizedWeights(bestOfGen.weights);
            renderFitnessChart(bestRtpHistory, targetRtp * 100);

            let pct = ((gen + 1) / maxGenerations) * 100;
            evolveProgressBar.style.width = `${pct}%`;

            // If we hit extremely close, we can stop early
            if (bestOfGen.error < 0.0005) {
                break;
            }

            // Breed next generation if not last
            if (gen < maxGenerations - 1) {
                let nextPopulation = [];
                // Elitism: keep top 2 exactly as they are
                nextPopulation.push(evaluated[0].weights);
                nextPopulation.push(evaluated[1].weights);

                while (nextPopulation.length < popSize) {
                    // Tournament selection for parents
                    let parentA = evaluated[Math.floor(Math.random() * (popSize / 2))].weights;
                    let parentB = evaluated[Math.floor(Math.random() * (popSize / 2))].weights;
                    
                    let child = crossover(parentA, parentB);
                    mutate(child, 0.3); // 30% chance per gene to mutate
                    nextPopulation.push(child);
                }
                population = nextPopulation;
            }
        }

        evolveProgressText.innerText = `Evolution Complete!`;
        runEvolveBtn.disabled = false;
        evolveBtnText.style.display = 'block';
        evolveBtnLoader.style.display = 'none';
    });
});

function renderOptimizedWeights(weights) {
    const grid = document.getElementById('optimizedWeightsGrid');
    grid.innerHTML = '';
    for (let sym in weights) {
        let card = document.createElement('div');
        card.className = 'editor-card';
        card.innerHTML = `
            <h4>${sym}</h4>
            <div style="font-family: 'Space Grotesk'; font-size: 1.2rem; color: #fff;">
                ${weights[sym].toFixed(2)}
            </div>
        `;
        grid.appendChild(card);
    }
}

function renderFitnessChart(history, targetRtp) {
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = "'Space Grotesk', sans-serif";

    if (fitnessChartInstance) fitnessChartInstance.destroy();
    
    let labels = history.map((_, i) => `Gen ${i+1}`);
    let targetLine = new Array(history.length).fill(targetRtp);

    fitnessChartInstance = new Chart(document.getElementById('fitnessChart').getContext('2d'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Best RTP in Generation',
                    data: history,
                    borderColor: '#8b5cf6',
                    backgroundColor: 'rgba(139, 92, 246, 0.2)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.1
                },
                {
                    label: 'Target RTP',
                    data: targetLine,
                    borderColor: '#10b981',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                title: { display: true, text: 'Genetic Convergence to Target', font: { size: 16 } }
            },
            scales: {
                y: { grid: { color: 'rgba(255,255,255,0.05)' } }
            }
        }
    });
}
