const fs = require('fs');
const assert = require('assert');

// Load engine.js classes into global scope
const code = fs.readFileSync(__dirname + '/engine.js', 'utf8');

function runTests() {

    console.log("Running JS Engine Tests...");

    // 1. PRNG Tests
    const rng = new Xoshiro128pp(12345);
    const r1 = rng.next();
    const r2 = rng.next();
    assert(r1 >= 0 && r1 < 1, "PRNG output must be in [0, 1)");
    assert(r1 !== r2, "PRNG should produce different sequential values");

    const rng2 = new Xoshiro128pp(12345);
    assert(rng2.next() === r1, "PRNG must be perfectly deterministic given the same seed");

    // 2. Paytable Tests
    const defs = [
        new SymbolDef("W",  { 3: 0.5, 4: 2.0, 5: 10.0 }, true),
        new SymbolDef("L1", { 3: 0.1, 4: 0.5, 5: 1.0 })
    ];
    const pt = new Paytable(defs);
    assert(pt.is_wild("W") === true, "Wild flag should be set");
    assert(pt.payout("L1", 4) === 0.5, "Payout lookup must be exact");
    assert(pt.payout("L1", 2) === 0.0, "Missing counts pay 0");

    // 3. Engine Simulation Output Integrity
    const sim = new Simulation();
    const numSpins = 1000;
    const res = sim.runSimulationSync(numSpins, () => {}, false);
    
    assert(res.total_rtp >= 0, "RTP must be non-negative");
    assert(res.hit_rate >= 0 && res.hit_rate <= 1, "Hit rate must be a valid probability [0, 1]");
    assert(res.volatility >= 0, "Volatility must be non-negative");
    assert(res.rtp_ci_95 >= 0, "Confidence interval must be non-negative");
    
    // Bucket percentages must sum to 100
    let bucketSum = 0;
    for (let k in res.buckets) bucketSum += res.buckets[k];
    assert(Math.abs(bucketSum - 100) < 0.001, "Buckets must sum to 100%");

    console.log("✅ All JS Engine tests passed!");
}

eval(code + "\n(" + runTests.toString() + ")();");

