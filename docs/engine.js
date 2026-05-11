// Paytable and Evaluation logic ported to JS

class SymbolDef {
    constructor(name, payouts, is_wild = false, is_scatter = false, is_coin = false) {
        this.name = name;
        this.payouts = payouts;
        this.is_wild = is_wild;
        this.is_scatter = is_scatter;
        this.is_coin = is_coin;
    }
}

class Paytable {
    constructor(symbols) {
        this._symbols = {};
        symbols.forEach(s => this._symbols[s.name] = s);
        this.wild_name = symbols.find(s => s.is_wild)?.name || null;
        this.scatter_name = symbols.find(s => s.is_scatter)?.name || null;
        this.coin_name = symbols.find(s => s.is_coin)?.name || null;
    }

    get(name) { return this._symbols[name]; }
    
    payout(name, count) {
        let sym = this._symbols[name];
        return (sym && sym.payouts[count]) ? sym.payouts[count] : 0.0;
    }

    is_wild(name) { return this._symbols[name]?.is_wild || false; }
    is_scatter(name) { return this._symbols[name]?.is_scatter || false; }
    is_coin(name) { return this._symbols[name]?.is_coin || false; }
    
    is_special(name) {
        let sym = this._symbols[name];
        return sym && (sym.is_wild || sym.is_scatter || sym.is_coin);
    }
}

class Reel {
    constructor(symbol_weights) {
        this.symbols = Object.keys(symbol_weights);
        this.weights = Object.values(symbol_weights);
        
        this.pool = [];
        for (let i = 0; i < this.symbols.length; i++) {
            let count = Math.round(this.weights[i] * 100);
            for (let j = 0; j < count; j++) {
                this.pool.push(this.symbols[i]);
            }
        }
    }

    spin_column(num_rows) {
        let col = [];
        for (let i = 0; i < num_rows; i++) {
            let idx = Math.floor(Math.random() * this.pool.length);
            col.push(this.pool[idx]);
        }
        return col;
    }
}

class ReelEngine {
    constructor(reels, num_rows = 3) {
        this.reels = reels;
        this.num_rows = num_rows;
    }

    spin() {
        let columns = this.reels.map(r => r.spin_column(this.num_rows));
        let num_cols = this.reels.length;
        let grid = [];
        for (let r = 0; r < this.num_rows; r++) {
            let row = [];
            for (let c = 0; c < num_cols; c++) {
                row.push(columns[c][r]);
            }
            grid.push(row);
        }
        return grid;
    }
}

class Evaluator {
    constructor(paytable, paylines) {
        this.paytable = paytable;
        this.paylines = paylines;
    }

    evaluate_scatters(grid) {
        let scatter_name = this.paytable.scatter_name;
        if (!scatter_name) return {count: 0, payout: 0};
        
        let count = 0;
        for (let r = 0; r < grid.length; r++) {
            for (let c = 0; c < grid[r].length; c++) {
                if (grid[r][c] === scatter_name) count++;
            }
        }
        return {count: count, payout: this.paytable.payout(scatter_name, count)};
    }

    evaluate(grid) {
        let total_payout = 0.0;
        let num_cols = grid[0].length;
        let winning_coords = new Set();
        
        for (let line_idx = 0; line_idx < this.paylines.length; line_idx++) {
            let line = this.paylines[line_idx];
            let symbols_on_line = [];
            for (let c = 0; c < line.length; c++) {
                symbols_on_line.push(grid[line[c]][c]);
            }
            
            let first_sym = null;
            let match_count = 0;
            
            for (let i = 0; i < num_cols; i++) {
                let sym = symbols_on_line[i];
                if (this.paytable.is_special(sym) && !this.paytable.is_wild(sym)) {
                    break;
                }
                
                if (first_sym === null) {
                    if (this.paytable.is_wild(sym)) {
                        match_count++;
                    } else {
                        first_sym = sym;
                        match_count++;
                    }
                } else {
                    if (sym === first_sym || this.paytable.is_wild(sym)) {
                        match_count++;
                    } else {
                        break;
                    }
                }
            }
            
            if (first_sym === null && match_count > 0) {
                first_sym = this.paytable.wild_name;
            }
            
            if (first_sym !== null) {
                let payout = this.paytable.payout(first_sym, match_count);
                
                let pure_wild_count = 0;
                for (let i = 0; i < symbols_on_line.length; i++) {
                    if (this.paytable.is_wild(symbols_on_line[i])) {
                        pure_wild_count++;
                    } else {
                        break;
                    }
                }
                let pure_wild_payout = this.paytable.wild_name ? this.paytable.payout(this.paytable.wild_name, pure_wild_count) : 0;
                
                let best_payout = Math.max(payout, pure_wild_payout);
                if (best_payout > 0) {
                    total_payout += best_payout;
                    let count_to_use = (best_payout === pure_wild_payout) ? pure_wild_count : match_count;
                    for (let i=0; i<count_to_use; i++) {
                        winning_coords.add(`${line[i]},${i}`);
                    }
                }
            }
        }
        
        let coords_array = Array.from(winning_coords).map(str => str.split(',').map(Number));
        return { payout: total_payout, coords: coords_array };
    }
}

class Simulation {
    constructor() {
        this.bet_amount = 1.0;
        // Default weights
        this.defaultWeights = {
            "W": 1, "H1": 2, "H2": 2, "M1": 3, "M2": 3, "L1": 30, "L2": 35, "SC": 1, "CO": 2
        };
        this.setupGame(this.defaultWeights, 0.05);
    }
    
    setupGame(customWeights, coinProbability) {
        let symbols = [
            new SymbolDef("W", {3: 0.5, 4: 2.0, 5: 10.0}, true),
            new SymbolDef("H1", {3: 0.4, 4: 1.5, 5: 5.0}),
            new SymbolDef("H2", {3: 0.3, 4: 1.0, 5: 4.0}),
            new SymbolDef("M1", {3: 0.2, 4: 0.8, 5: 2.5}),
            new SymbolDef("M2", {3: 0.2, 4: 0.6, 5: 2.0}),
            new SymbolDef("L1", {3: 0.1, 4: 0.4, 5: 1.5}),
            new SymbolDef("L2", {3: 0.1, 4: 0.3, 5: 1.0}),
            new SymbolDef("SC", {3: 2.0, 4: 10.0, 5: 50.0}, false, true),
            new SymbolDef("CO", {}, false, false, true)
        ];
        this.paytable = new Paytable(symbols);
        
        let bw = customWeights;
        
        let reels = [
            new Reel(bw),
            new Reel({...bw, "W": bw.W * 1.5, "SC": 3, "CO": 4}),
            new Reel({...bw, "H1": 5, "SC": 2, "CO": 5}),
            new Reel({...bw, "W": bw.W * 2.0, "SC": 2, "CO": 4}),
            new Reel({...bw, "H2": 6, "SC": 3, "CO": 3})
        ];
        
        this.engine = new ReelEngine(reels);
        
        let paylines = [
            [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0],
            [2, 1, 0, 1, 2], [1, 0, 1, 2, 1], [1, 2, 1, 0, 1], [0, 0, 1, 2, 2],
            [2, 2, 1, 0, 0], [1, 2, 2, 2, 1], [1, 0, 0, 0, 1], [0, 1, 1, 1, 0],
            [2, 1, 1, 1, 2], [0, 2, 0, 2, 0], [2, 0, 2, 0, 2], [1, 1, 0, 1, 1],
            [1, 1, 2, 1, 1], [0, 0, 2, 0, 0], [2, 2, 0, 2, 2], [0, 2, 2, 2, 0]
        ];
        this.evaluator = new Evaluator(this.paytable, paylines);
        
        this.bonus_trigger_count = 3;
        this.bonus_spins = 10;
        this.bonus_multiplier = 2.0;
        
        this.hs_trigger_count = 6;
        this.hs_coin_prob = parseFloat(coinProbability);
        
        // Jackpot pool setup
        this.hs_coin_values = [1.0, 2.0, 3.0, 5.0, 10.0, 50.0];
        this.value_pool = [];
        for(let val of this.hs_coin_values) {
            for(let i=0; i<100; i++) this.value_pool.push(val);
        }
        for(let i=0; i<5; i++) this.value_pool.push("Mini");
        this.value_pool.push("Minor");
        
        // Progressive Jackpot
        this.globalJackpotPool = 10000.0;
        this.jackpotHitTotal = 0.0;
    }
    
    _getRandomCoin() {
        if (Math.random() < 0.0001) return {type: "Major", val: 500.0};
        let choice = this.value_pool[Math.floor(Math.random() * this.value_pool.length)];
        if (choice === "Mini") return {type: "Mini", val: 10.0};
        if (choice === "Minor") return {type: "Minor", val: 50.0};
        return {type: "cash", val: parseFloat(choice)};
    }
    
    run_free_spins() {
        let total_payout = 0.0;
        let spins_remaining = this.bonus_spins;
        
        while (spins_remaining > 0) {
            spins_remaining--;
            let cascade_res = this.run_cascade_spin();
            
            total_payout += (cascade_res.payout * this.bonus_multiplier) + cascade_res.scatter_payout;
            if (cascade_res.hs_triggered) total_payout += cascade_res.hs_payout;
            
            if (cascade_res.scatters >= this.bonus_trigger_count) {
                spins_remaining += this.bonus_spins;
            }
        }
        return total_payout;
    }
    
    run_hs(grid, is_bonus_buy = false) {
        let num_rows = grid.length;
        let num_cols = grid[0].length;
        
        // Determine Strength Level
        let roll = Math.random();
        let strength = "Weak";
        let prob_mult = 0.5;
        let upgrade_prob = 0.01;
        
        if (roll < 0.10) { strength = "Ultra"; prob_mult = 2.0; upgrade_prob = 0.08; }
        else if (roll < 0.30) { strength = "Strong"; prob_mult = 1.5; upgrade_prob = 0.04; }
        else if (roll < 0.60) { strength = "Normal"; prob_mult = 1.0; upgrade_prob = 0.02; }
        
        let current_prob = this.hs_coin_prob * prob_mult;
        
        let mask = [];
        let coin_count = 0;
        
        // Initial setup
        for (let r = 0; r < num_rows; r++) {
            let row_mask = [];
            for (let c = 0; c < num_cols; c++) {
                if (grid[r][c] === "CO" || (is_bonus_buy && Math.random() < 0.4 && coin_count < 6)) {
                    row_mask.push(this._getRandomCoin());
                    coin_count++;
                } else {
                    row_mask.push(null);
                }
            }
            mask.push(row_mask);
        }
        
        // Force 6 coins for bonus buy
        if (is_bonus_buy && coin_count < 6) {
            let needed = 6 - coin_count;
            for (let r = 0; r < num_rows && needed > 0; r++) {
                for (let c = 0; c < num_cols && needed > 0; c++) {
                    if (mask[r][c] === null) {
                        mask[r][c] = this._getRandomCoin();
                        needed--;
                        coin_count++;
                    }
                }
            }
        }
        
        if (coin_count < this.hs_trigger_count && !is_bonus_buy) {
            return {triggered: false, payout: 0, grand: false, strength: null, upgrades: 0};
        }
        
        let respins_left = 3;
        let hit_grand = false;
        let total_upgrades = 0;
        
        while (respins_left > 0) {
            respins_left--;
            let new_coin = false;
            
            for (let r = 0; r < num_rows; r++) {
                for (let c = 0; c < num_cols; c++) {
                    if (mask[r][c] === null) {
                        if (Math.random() < current_prob) {
                            mask[r][c] = this._getRandomCoin();
                            new_coin = true;
                        }
                    } else {
                        // Upgrade mechanic
                        if (Math.random() < upgrade_prob) {
                            let coin = mask[r][c];
                            if (coin.type === "cash") {
                                coin.val *= 2.0; // Double cash
                                total_upgrades++;
                            } else if (coin.type === "Mini") {
                                coin.type = "Minor"; coin.val = 50.0;
                                total_upgrades++;
                            } else if (coin.type === "Minor") {
                                coin.type = "Major"; coin.val = 500.0;
                                total_upgrades++;
                            }
                        }
                    }
                }
            }
            
            if (new_coin) respins_left = 3;
            
            let full_screen = true;
            for (let r=0; r<num_rows; r++) {
                for (let c=0; c<num_cols; c++) {
                    if (mask[r][c] === null) full_screen = false;
                }
            }
            
            if (full_screen) {
                this.jackpotHitTotal += this.globalJackpotPool;
                hit_grand = true;
                break;
            }
        }
        
        // Sum final board
        let total_value = 0.0;
        for (let r=0; r<num_rows; r++) {
            for (let c=0; c<num_cols; c++) {
                if (mask[r][c] !== null) total_value += mask[r][c].val;
            }
        }
        if (hit_grand) {
            total_value += this.globalJackpotPool;
            this.globalJackpotPool = 10000.0; // Reset network pool
        }
        
        return {
            triggered: true, 
            payout: total_value, 
            grand: hit_grand,
            strength: strength,
            upgrades: total_upgrades
        };
    }
    
    run_cascade_spin() {
        let grid = this.engine.spin();
        let total_spin_payout = 0.0;
        
        let initial_scatters = this.evaluator.evaluate_scatters(grid);
        let scatter_payout = initial_scatters.payout;
        let scatter_count = initial_scatters.count;

        let keep_cascading = true;
        let cascades = 0;

        while(keep_cascading && cascades < 15) {
            let eval_res = this.evaluator.evaluate(grid);
            if (eval_res.payout > 0) {
                total_spin_payout += eval_res.payout;
                let coords = eval_res.coords;
                
                let cols_to_remove = {};
                for (let i=0; i<5; i++) cols_to_remove[i] = [];
                for (let coord of coords) {
                    cols_to_remove[coord[1]].push(coord[0]);
                }
                
                for (let c=0; c<5; c++) {
                    if (cols_to_remove[c].length > 0) {
                        cols_to_remove[c].sort((a,b) => b-a); // Bottom up
                        for (let r of cols_to_remove[c]) {
                            // Shift down
                            for(let i=r; i>0; i--) {
                                grid[i][c] = grid[i-1][c];
                            }
                            grid[0][c] = this.engine.reels[c].spin_column(1)[0];
                        }
                    }
                }
                cascades++;
            } else {
                keep_cascading = false;
            }
        }
        
        let hs_res = this.run_hs(grid);
        
        return {
            payout: total_spin_payout,
            scatters: scatter_count,
            scatter_payout: scatter_payout,
            hs_triggered: hs_res.triggered,
            hs_payout: hs_res.payout,
            hs_grand: hs_res.grand,
            final_grid: grid
        };
    }
    
    runSimulation(numSpins, progressCallback, bonusBuyMode = false) {
        let total_spent = 0.0;
        let base_win_total = 0.0;
        let bonus_win_total = 0.0;
        let hs_win_total = 0.0;
        
        let base_hits = 0;
        let bonus_triggers = 0;
        let hs_triggers = 0;
        let grand_hits = 0;
        
        let sum_win = 0.0;
        let sum_win_sq = 0.0;
        
        let strength_counts = {"Weak": 0, "Normal": 0, "Strong": 0, "Ultra": 0};
        let total_upgrades = 0;
        
        // Buckets
        let buckets = {"0x": 0, "0-1x": 0, "1-5x": 0, "5-15x": 0, "15-50x": 0, "50x+": 0};
        
        // Balance History (Sampled to max 500 points to not crash browser)
        let sample_rate = Math.max(1, Math.floor(numSpins / 500));
        let balance_history = [];
        let current_balance = 0.0;
        
        let spin_idx = 0;
        let chunkSize = 20000; 
        
        return new Promise((resolve) => {
            const doChunk = () => {
                let end = Math.min(spin_idx + chunkSize, numSpins);
                
                for (; spin_idx < end; spin_idx++) {
                    let spin_total_win = 0.0;
                    
                    if (bonusBuyMode) {
                        total_spent += this.bet_amount * 100.0;
                        current_balance -= this.bet_amount * 100.0;
                        this.globalJackpotPool += (this.bet_amount * 100.0) * 0.005; // Still contribute to progressive
                        
                        let mock_grid = [
                            ["L1", "L2", "H1", "H2", "M1"],
                            ["M2", "W", "L1", "H1", "H2"],
                            ["L2", "L1", "W", "M1", "M2"]
                        ];
                        let hs_res = this.run_hs(mock_grid, true);
                        if (hs_res.triggered) {
                            hs_triggers++;
                            hs_win_total += hs_res.payout;
                            spin_total_win += hs_res.payout;
                            if (hs_res.grand) grand_hits++;
                            if (hs_res.strength) strength_counts[hs_res.strength]++;
                            total_upgrades += hs_res.upgrades;
                        }
                    } else {
                        total_spent += this.bet_amount;
                        current_balance -= this.bet_amount;
                        this.globalJackpotPool += this.bet_amount * 0.005; // 0.5% contribution to progressive
                        
                        let cascade_res = this.run_cascade_spin();
                        
                        let base_spin_win = cascade_res.payout + cascade_res.scatter_payout;
                        if (base_spin_win > 0) {
                            base_hits++;
                            base_win_total += base_spin_win;
                            spin_total_win += base_spin_win;
                        }
                        
                        if (cascade_res.scatters >= this.bonus_trigger_count) {
                            bonus_triggers++;
                            let b_payout = this.run_free_spins();
                            bonus_win_total += b_payout;
                            spin_total_win += b_payout;
                        }
                        
                        if (cascade_res.hs_triggered) {
                            hs_triggers++;
                            hs_win_total += cascade_res.hs_payout;
                            spin_total_win += cascade_res.hs_payout;
                            if (cascade_res.hs_grand) grand_hits++;
                            if (cascade_res.strength) strength_counts[cascade_res.strength]++;
                            total_upgrades += cascade_res.upgrades;
                        }
                    }
                    
                    sum_win += spin_total_win;
                    sum_win_sq += spin_total_win * spin_total_win;
                    current_balance += spin_total_win;
                    
                    // Buckets
                    let win_mult = spin_total_win / this.bet_amount;
                    if (win_mult === 0) buckets["0x"]++;
                    else if (win_mult <= 1.0) buckets["0-1x"]++;
                    else if (win_mult <= 5.0) buckets["1-5x"]++;
                    else if (win_mult <= 15.0) buckets["5-15x"]++;
                    else if (win_mult <= 50.0) buckets["15-50x"]++;
                    else buckets["50x+"]++;
                    
                    if (spin_idx % sample_rate === 0) {
                        balance_history.push(current_balance);
                    }
                }
                
                if (progressCallback) {
                    progressCallback((spin_idx / numSpins) * 100);
                }
                
                if (spin_idx < numSpins) {
                    setTimeout(doChunk, 0);
                } else {
                    let total_win = base_win_total + bonus_win_total + hs_win_total;
                    let total_rtp = total_win / total_spent;
                    let base_rtp = base_win_total / total_spent;
                    let bonus_rtp = bonus_win_total / total_spent;
                    let hs_rtp = hs_win_total / total_spent;
                    
                    let hit_rate = base_hits / numSpins;
                    let mean_win = sum_win / numSpins;
                    let variance = (sum_win_sq / numSpins) - (mean_win * mean_win);
                    let volatility = Math.sqrt(Math.max(0, variance));
                    
                    // Convert buckets to percentages
                    for (let key in buckets) {
                        buckets[key] = (buckets[key] / numSpins) * 100;
                    }
                    
                    resolve({
                        total_rtp: total_rtp,
                        base_rtp: base_rtp,
                        bonus_rtp: bonus_rtp,
                        hs_rtp: hs_rtp,
                        hit_rate: hit_rate,
                        bonus_freq: bonus_triggers > 0 ? numSpins / bonus_triggers : 0,
                        hs_freq: hs_triggers > 0 ? numSpins / hs_triggers : 0,
                        grand_freq: grand_hits > 0 ? numSpins / grand_hits : 0,
                        avg_jackpot: grand_hits > 0 ? this.jackpotHitTotal / grand_hits : 10000.0,
                        volatility: volatility,
                        num_spins: numSpins,
                        buckets: buckets,
                        balance_history: balance_history,
                        strength_counts: strength_counts,
                        avg_upgrades: hs_triggers > 0 ? total_upgrades / hs_triggers : 0
                    });
                }
            };
            
            doChunk();
        });
    }
}
