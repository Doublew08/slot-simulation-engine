import itertools
import math
from reels import ReelEngine, Reel
from paytable import Paytable, Symbol
from evaluator import LinesEvaluator
from main import build_game
import time

def calculate_exact_rtp():
    print("Initializing Exact Analytical Math Engine...")
    
    # 1. Setup the exact math model (extract paytable and reels)
    runner = build_game()
    re = runner.reel_engine
    pt = runner.evaluator.paytable
    ev = runner.evaluator
    num_reels = len(re.reels)
    
    # 2. Extract symbol probabilities per reel
    reel_probs = []
    symbol_set = set()
    for r in re.reels:
        total_weight = sum(r.weights)
        probs = {sym: weight / total_weight for sym, weight in zip(r.symbols, r.weights)}
        reel_probs.append(probs)
        symbol_set.update(probs.keys())
        
    print(f"Loaded {num_reels} reels. Total unique symbols: {len(symbol_set)}")
    
    # 3. We want to calculate the expected value of ONE payline.
    # Since symbols on reels are vertically independent in this model (ReelEngine spins columns),
    # the probability of landing any symbol S on Reel i is exactly probs[S].
    # Therefore, the EV of all 20 lines is simply 20 * EV_of_one_line.
    
    symbols = list(symbol_set)
    
    print(f"Iterating all {len(symbols)**num_reels} line combinations to find absolute mathematical EV...")
    
    start_time = time.time()
    total_line_ev = 0.0
    hit_prob = 0.0
    par_sheet_data = {}
    
    # We can use the LinesEvaluator logic directly. 
    # Let's mock a 1-line grid where the line is simply [0,0,0,0,0]
    evaluator = LinesEvaluator(pt, [[0, 0, 0, 0, 0]])
    
    # Generate all combinations of 5 symbols
    for combo in itertools.product(symbols, repeat=num_reels):
        # Calculate combination probability
        p = 1.0
        valid = True
        for i, sym in enumerate(combo):
            if sym not in reel_probs[i]:
                valid = False
                break
            p *= reel_probs[i][sym]
            
        if not valid or p == 0:
            continue
            
        # Build mock grid (1 row is enough for 1 line)
        grid = [[sym] for sym in combo]  # column-major as expected by evaluator? No, grid is List[List[str]] row-major
        # Wait, evaluator takes grid[row][col]. So grid is rows of cols.
        grid_mock = [list(combo)]
        
        payout, hits = evaluator.evaluate(grid_mock)
        
        if payout > 0:
            total_line_ev += payout * p
            hit_prob += p
            
            # Record hit for PAR sheet
            # The evaluator returns a list of hit dicts. We extract the best one for the line.
            for hit in hits:
                sym = hit["symbol"]
                cnt = hit["count"]
                pay = hit["payout"]
                key = f"{sym}_{cnt}"
                if key not in par_sheet_data:
                    par_sheet_data[key] = {"hits": 0.0, "rtp": 0.0, "payout": pay}
                # Since this is for a single line, we multiply probability by 20 lines
                par_sheet_data[key]["hits"] += p * len(ev.paylines)
                par_sheet_data[key]["rtp"] += pay * p * len(ev.paylines)
            
    base_rtp = total_line_ev * len(ev.paylines)
    
    print(f"--- Analytical Evaluation Complete in {time.time() - start_time:.4f}s ---")
    print(f"Exact Base Game Hit Rate (per line): {hit_prob * 100:.6f}%")
    print(f"Exact Base Game RTP: {base_rtp * 100:.6f}%")
    
    # 4. Exact Scatter EV Calculation
    print("Calculating exact scatter EV using probability distributions...")
    scatter_p_single = [probs.get("SC", 0.0) for probs in reel_probs]
    
    pgf = {0: 1.0}
    for p in scatter_p_single:
        for _ in range(3):
            new_pgf = {}
            for k, prob in pgf.items():
                new_pgf[k] = new_pgf.get(k, 0) + prob * (1 - p)
                new_pgf[k + 1] = new_pgf.get(k + 1, 0) + prob * p
            pgf = new_pgf
            
    scatter_ev = 0.0
    scatter_bonus_trigger_prob = 0.0
    for scatters, prob in pgf.items():
        if scatters >= 3:
            scatter_bonus_trigger_prob += prob
            payout = pt.payout("SC", scatters)
            scatter_ev += payout * prob
            
            # Record scatter to PAR sheet
            key = f"SC_{scatters}"
            if key not in par_sheet_data:
                par_sheet_data[key] = {"hits": 0.0, "rtp": 0.0, "payout": payout}
            par_sheet_data[key]["hits"] += prob
            par_sheet_data[key]["rtp"] += payout * prob
            
    print(f"Exact Scatter Payout RTP: {scatter_ev * 100:.6f}%")
    print(f"Exact Bonus Trigger Probability: {scatter_bonus_trigger_prob * 100:.6f}% (1 in {1/scatter_bonus_trigger_prob:.2f})")
    print(f"Total Base Game + Scatter RTP: {(base_rtp + scatter_ev) * 100:.6f}%\n")
    
    # 5. Generate PAR Sheet CSV
    print("Generating industry-standard PAR Sheet (Probability & Accounting Report)...")
    with open("par_sheet.csv", "w", newline="") as f:
        import csv
        writer = csv.writer(f)
        writer.writerow(["Symbol", "Count", "Payout", "Hit Frequency (%)", "Hits (1 in X)", "RTP Contribution (%)"])
        
        # Sort keys logically: W, H1, H2..., SC descending
        for key in sorted(par_sheet_data.keys(), key=lambda x: (-par_sheet_data[x]["payout"])):
            parts = key.split('_')
            sym, cnt = parts[0], parts[1]
            data = par_sheet_data[key]
            hits_pct = data["hits"] * 100
            hits_1_in = 1.0 / data["hits"] if data["hits"] > 0 else 0
            rtp_pct = data["rtp"] * 100
            writer.writerow([sym, cnt, data["payout"], f"{hits_pct:.6f}", f"{hits_1_in:.2f}", f"{rtp_pct:.6f}"])
            
        writer.writerow([])
        writer.writerow(["SUMMARY", "", "", "", "", ""])
        writer.writerow(["Base Game RTP", "", "", "", "", f"{base_rtp * 100:.6f}"])
        writer.writerow(["Scatter RTP", "", "", "", "", f"{scatter_ev * 100:.6f}"])
        writer.writerow(["Bonus Trigger Prob", "", "", f"{scatter_bonus_trigger_prob * 100:.6f}", f"{1/scatter_bonus_trigger_prob if scatter_bonus_trigger_prob>0 else 0:.2f}", ""])
        writer.writerow(["Total Theoretical Base RTP", "", "", "", "", f"{(base_rtp + scatter_ev) * 100:.6f}"])
    
    print("Saved exact mathematical PAR sheet to par_sheet.csv")
    print("Note: Cascades and Hold & Spin feature RTP rely on exact Monte Carlo simulations due to infinite-state Markov chain properties.")

if __name__ == "__main__":
    calculate_exact_rtp()
