const fs = require('fs');

const engineCode = fs.readFileSync('docs/engine.js', 'utf8');

const wrappedCode = `
${engineCode}

async function testRtp() {
    let currentWeights = {
        "W": 1, "H1": 2, "H2": 2, "M1": 3, "M2": 3, "L1": 25, "L2": 30, "SC": 1, "CO": 2
    };

    let sim = new Simulation();
    sim.setupGame(currentWeights, 0.05);
    let res = await sim.runSimulation(100000);
    console.log("RTP:", res.total_rtp * 100, "%");
}
testRtp();
`;

fs.writeFileSync('test_rtp.js', wrappedCode);
