import csv
import math
from typing import Optional

from reels import ReelEngine
from evaluator import BaseEvaluator
from bonus import BonusFeature
from hold_and_spin import HoldAndSpinFeature

class SimulationRunner:
    """
    Runs the Monte Carlo simulation for the slot game.
    """
    def __init__(
        self, 
        reel_engine: ReelEngine, 
        evaluator: BaseEvaluator,
        bet_amount: float = 1.0,
        bonus_feature: Optional[BonusFeature] = None,
        hold_and_spin_feature: Optional[HoldAndSpinFeature] = None
    ):
        self.reel_engine = reel_engine
        self.evaluator = evaluator
        self.bet_amount = bet_amount
        self.bonus_feature = bonus_feature
        self.hold_and_spin_feature = hold_and_spin_feature

    def run(self, num_spins: int, output_csv: str = "results.csv"):
        print(f"Starting simulation for {num_spins} spins...")
        total_spent = 0.0
        
        base_win_total = 0.0
        bonus_win_total = 0.0
        hs_win_total = 0.0
        
        base_hits = 0
        bonus_triggers = 0
        hs_triggers = 0
        grand_jackpots = 0
        
        sum_win = 0.0
        sum_win_sq = 0.0
        
        # Win Buckets
        buckets = {
            "0x": 0,
            ">0x to 1x": 0,
            ">1x to 5x": 0,
            ">5x to 15x": 0,
            ">15x to 50x": 0,
            ">50x": 0
        }
        
        for spin_idx in range(num_spins):
            total_spent += self.bet_amount
            spin_total_win = 0.0
            
            grid = self.reel_engine.spin()
            
            # Base game evaluation
            base_payout, _ = self.evaluator.evaluate(grid)
            scatter_count, scatter_payout = self.evaluator.evaluate_scatters(grid)
            
            base_spin_win = base_payout + scatter_payout
            
            if base_spin_win > 0:
                base_hits += 1
                base_win_total += base_spin_win
                spin_total_win += base_spin_win
                
            # Bonus feature evaluation
            if self.bonus_feature and self.bonus_feature.check_trigger(scatter_count):
                bonus_triggers += 1
                bonus_payout, _ = self.bonus_feature.run_free_spins(self.reel_engine, self.evaluator)
                bonus_win_total += bonus_payout
                spin_total_win += bonus_payout
                
            # Hold and Spin evaluation
            if self.hold_and_spin_feature:
                triggered, hs_mask, hs_initial_val = self.hold_and_spin_feature.check_trigger(grid)
                if triggered:
                    hs_triggers += 1
                    hs_payout, _, hit_grand = self.hold_and_spin_feature.run_hold_and_spin(hs_mask, hs_initial_val)
                    hs_win_total += hs_payout
                    spin_total_win += hs_payout
                    if hit_grand:
                        grand_jackpots += 1
                    
            sum_win += spin_total_win
            sum_win_sq += spin_total_win * spin_total_win
            
            # Track Buckets
            win_mult = spin_total_win / self.bet_amount
            if win_mult == 0:
                buckets["0x"] += 1
            elif win_mult <= 1.0:
                buckets[">0x to 1x"] += 1
            elif win_mult <= 5.0:
                buckets[">1x to 5x"] += 1
            elif win_mult <= 15.0:
                buckets[">5x to 15x"] += 1
            elif win_mult <= 50.0:
                buckets[">15x to 50x"] += 1
            else:
                buckets[">50x"] += 1
            
            # Print progress every 1 million spins
            if (spin_idx + 1) % 1000000 == 0:
                print(f"Completed {spin_idx + 1} spins...")
                
        # Calculate statistics
        total_win = base_win_total + bonus_win_total + hs_win_total
        
        total_rtp = total_win / total_spent if total_spent > 0 else 0
        base_rtp = base_win_total / total_spent if total_spent > 0 else 0
        bonus_rtp = bonus_win_total / total_spent if total_spent > 0 else 0
        hs_rtp = hs_win_total / total_spent if total_spent > 0 else 0
        
        hit_rate = base_hits / num_spins if num_spins > 0 else 0
        bonus_freq = num_spins / bonus_triggers if bonus_triggers > 0 else 0
        hs_freq = num_spins / hs_triggers if hs_triggers > 0 else 0
        grand_freq = num_spins / grand_jackpots if grand_jackpots > 0 else 0
        
        mean_win = sum_win / num_spins if num_spins > 0 else 0
        variance = (sum_win_sq / num_spins) - (mean_win ** 2) if num_spins > 0 else 0
        volatility = math.sqrt(max(0, variance)) / self.bet_amount if variance > 0 else 0
        
        metrics = {
            "Total Spins": num_spins,
            "Total RTP": total_rtp,
            "Base RTP": base_rtp,
            "Bonus RTP": bonus_rtp,
            "Hold and Spin RTP": hs_rtp,
            "Base Hit Rate": hit_rate,
            "Bonus Trigger Frequency (1 in X)": bonus_freq,
            "Hold and Spin Frequency (1 in X)": hs_freq,
            "Grand Jackpot Frequency (1 in X)": grand_freq,
            "Volatility": volatility
        }
        
        for k, v in buckets.items():
            metrics[f"Bucket: {k} (%)"] = (v / num_spins) * 100
        
        self._export_csv(output_csv, metrics)
        
        print("\n--- Simulation Results ---")
        for k, v in metrics.items():
            if "RTP" in k or "Rate" in k or "Bucket" in k:
                print(f"{k}: {v:.2f}%")
            elif "Frequency" in k:
                print(f"{k}: {v:.1f}")
            else:
                print(f"{k}: {v:.4f}")
                
        return metrics

    def _export_csv(self, filename: str, metrics: dict):
        with open(filename, 'w', newline='') as csvfile:
            writer = csv.writer(csvfile)
            writer.writerow(["Metric", "Value"])
            for k, v in metrics.items():
                writer.writerow([k, v])
        print(f"\nResults exported to {filename}")
