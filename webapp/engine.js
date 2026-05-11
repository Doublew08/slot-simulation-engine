// Paytable and Evaluation logic ported to JS

class SymbolDef {
    constructor(name, payouts, is_wild = false, is_scatter = false, is_coin = false) {
        this.name = name;
        this.payouts = payouts; // object like {3: 0.5, 4: 2.0, 5: 10.0}
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
        
        // Build an array for fast random choices
        this.pool = [];
        for (let i = 0; i < this.symbols.length; i++) {
            let count = Math.round(this.weights[i] * 100); // Scale floats to ints
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
                total_payout += best_payout;
            }
        }
        return total_payout;
    }
}

class Simulation {
    constructor() {
        this.bet_amount = 1.0;
        this.setupGame(4.238, 0.05);
    }
    
    setupGame(wildWeight, coinProbability) {
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
        
        let base_weights = {
            "W": parseFloat(wildWeight),
            "H1": 4, "H2": 5, "M1": 6, "M2": 7, "L1": 10, "L2": 12, "SC": 2, "CO": 3
        };
        
        let reels = [
            new Reel(base_weights),
            new Reel({...base_weights, "W": base_weights.W * 1.5, "SC": 3, "CO": 4}),
            new Reel({...base_weights, "H1": 5, "SC": 2, "CO": 5}),
            new Reel({...base_weights, "W": base_weights.W * 2.0, "SC": 2, "CO": 4}),
            new Reel({...base_weights, "H2": 6, "SC": 3, "CO": 3})
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
        this.hs_coin_values = [1.0, 2.0, 3.0, 5.0, 10.0, 50.0];
    }
    
    run_free_spins() {
        let total_payout = 0.0;
        let spins_remaining = this.bonus_spins;
        
        while (spins_remaining > 0) {
            spins_remaining--;
            let grid = this.engine.spin();
            let spin_payout = this.evaluator.evaluate(grid);
            let scatters = this.evaluator.evaluate_scatters(grid);
            
            total_payout += (spin_payout * this.bonus_multiplier) + scatters.payout;
            
            if (scatters.count >= this.bonus_trigger_count) {
                spins_remaining += this.bonus_spins;
            }
        }
        return total_payout;
    }
    
    run_hs(grid) {
        let num_rows = grid.length;
        let num_cols = grid[0].length;
        
        let mask = [];
        let total_value = 0.0;
        let coin_count = 0;
        
        for (let r = 0; r < num_rows; r++) {
            let row_mask = [];
            for (let c = 0; c < num_cols; c++) {
                if (grid[r][c] === "CO") {
                    row_mask.push(true);
                    coin_count++;
                    total_value += this.hs_coin_values[Math.floor(Math.random() * this.hs_coin_values.length)];
                } else {
                    row_mask.push(false);
                }
            }
            mask.push(row_mask);
        }
        
        if (coin_count < this.hs_trigger_count) {
            return {triggered: false, payout: 0};
        }
        
        let respins_left = 3;
        while (respins_left > 0) {
            respins_left--;
            let new_coin = false;
            
            for (let r = 0; r < num_rows; r++) {
                for (let c = 0; c < num_cols; c++) {
                    if (!mask[r][c]) {
                        if (Math.random() < this.hs_coin_prob) {
                            mask[r][c] = true;
                            new_coin = true;
                            total_value += this.hs_coin_values[Math.floor(Math.random() * this.hs_coin_values.length)];
                        }
                    }
                }
            }
            
            if (new_coin) respins_left = 3;
            
            let full_screen = true;
            for (let r=0; r<num_rows; r++) {
                for (let c=0; c<num_cols; c++) {
                    if (!mask[r][c]) full_screen = false;
                }
            }
            if (full_screen) break;
        }
        
        return {triggered: true, payout: total_value};
    }
    
    runSimulation(numSpins, progressCallback) {
        let total_spent = 0.0;
        let base_win_total = 0.0;
        let bonus_win_total = 0.0;
        let hs_win_total = 0.0;
        
        let base_hits = 0;
        let bonus_triggers = 0;
        let hs_triggers = 0;
        
        let sum_win = 0.0;
        let sum_win_sq = 0.0;
        
        // Chunking the execution so we don't freeze the browser
        let spin_idx = 0;
        let chunkSize = 50000; 
        
        return new Promise((resolve) => {
            const doChunk = () => {
                let end = Math.min(spin_idx + chunkSize, numSpins);
                
                for (; spin_idx < end; spin_idx++) {
                    total_spent += this.bet_amount;
                    let spin_total_win = 0.0;
                    
                    let grid = this.engine.spin();
                    let base_payout = this.evaluator.evaluate(grid);
                    let scatters = this.evaluator.evaluate_scatters(grid);
                    
                    let base_spin_win = base_payout + scatters.payout;
                    if (base_spin_win > 0) {
                        base_hits++;
                        base_win_total += base_spin_win;
                        spin_total_win += base_spin_win;
                    }
                    
                    if (scatters.count >= this.bonus_trigger_count) {
                        bonus_triggers++;
                        let b_payout = this.run_free_spins();
                        bonus_win_total += b_payout;
                        spin_total_win += b_payout;
                    }
                    
                    let hs_res = this.run_hs(grid);
                    if (hs_res.triggered) {
                        hs_triggers++;
                        hs_win_total += hs_res.payout;
                        spin_total_win += hs_res.payout;
                    }
                    
                    sum_win += spin_total_win;
                    sum_win_sq += spin_total_win * spin_total_win;
                }
                
                if (progressCallback) {
                    progressCallback((spin_idx / numSpins) * 100);
                }
                
                if (spin_idx < numSpins) {
                    setTimeout(doChunk, 0); // Yield to browser
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
                    
                    resolve({
                        total_rtp: total_rtp,
                        base_rtp: base_rtp,
                        bonus_rtp: bonus_rtp,
                        hs_rtp: hs_rtp,
                        hit_rate: hit_rate,
                        bonus_freq: bonus_triggers > 0 ? numSpins / bonus_triggers : 0,
                        hs_freq: hs_triggers > 0 ? numSpins / hs_triggers : 0,
                        volatility: volatility,
                        num_spins: numSpins
                    });
                }
            };
            
            doChunk();
        });
    }
}
