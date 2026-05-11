const fs = require('fs');

const engineCode = fs.readFileSync('docs/engine.js', 'utf8');

const wrappedCode = `
${engineCode}

let sim = new Simulation();
let bal = 100;
let betSize = 1;
for (let i = 0; i < 100000; i++) {
    let cascade_res = sim.run_cascade_spin();
    let totalWin = (cascade_res.payout + cascade_res.scatter_payout) * betSize;
    if (cascade_res.hs_triggered) totalWin += cascade_res.hs_payout * betSize;
    bal += totalWin;
    if (isNaN(bal)) {
        console.log("Found NaN at spin", i);
        console.log("cascade_res", cascade_res);
        break;
    }
}
console.log("End bankroll:", bal);
`;

fs.writeFileSync('test_run.js', wrappedCode);
