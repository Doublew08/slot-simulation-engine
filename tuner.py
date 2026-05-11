import sys
from paytable import Paytable, Symbol
from reels import Reel, ReelEngine
from evaluator import LinesEvaluator
from bonus import BonusFeature
from hold_and_spin import HoldAndSpinFeature
from simulation import SimulationRunner

def evaluate_rtp(wild_weight: float, num_spins: int = 100000) -> float:
    symbols = [
        Symbol(name="W", payouts={3: 0.5, 4: 2.0, 5: 10.0}, is_wild=True),
        Symbol(name="H1", payouts={3: 0.4, 4: 1.5, 5: 5.0}),
        Symbol(name="H2", payouts={3: 0.3, 4: 1.0, 5: 4.0}),
        Symbol(name="M1", payouts={3: 0.2, 4: 0.8, 5: 2.5}),
        Symbol(name="M2", payouts={3: 0.2, 4: 0.6, 5: 2.0}),
        Symbol(name="L1", payouts={3: 0.1, 4: 0.4, 5: 1.5}),
        Symbol(name="L2", payouts={3: 0.1, 4: 0.3, 5: 1.0}),
        Symbol(name="SC", payouts={3: 2.0, 4: 10.0, 5: 50.0}, is_scatter=True),
        Symbol(name="CO", payouts={}, is_coin=True)
    ]
    paytable = Paytable(symbols)

    base_weights = {
        "W": wild_weight,
        "H1": 4, "H2": 5,
        "M1": 6, "M2": 7,
        "L1": 10, "L2": 12,
        "SC": 2,
        "CO": 3
    }
    
    reels = [
        Reel(base_weights),
        Reel({**base_weights, "W": wild_weight * 1.5, "SC": 3, "CO": 4}),
        Reel({**base_weights, "H1": 5, "SC": 2, "CO": 5}),
        Reel({**base_weights, "W": wild_weight * 2.0, "SC": 2, "CO": 4}),
        Reel({**base_weights, "H2": 6, "SC": 3, "CO": 3}),
    ]
    
    reel_engine = ReelEngine(reels, num_rows=3)

    paylines = [
        [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0],
        [2, 1, 0, 1, 2], [1, 0, 1, 2, 1], [1, 2, 1, 0, 1], [0, 0, 1, 2, 2],
        [2, 2, 1, 0, 0], [1, 2, 2, 2, 1], [1, 0, 0, 0, 1], [0, 1, 1, 1, 0],
        [2, 1, 1, 1, 2], [0, 2, 0, 2, 0], [2, 0, 2, 0, 2], [1, 1, 0, 1, 1],
        [1, 1, 2, 1, 1], [0, 0, 2, 0, 0], [2, 2, 0, 2, 2], [0, 2, 2, 2, 0]
    ]
    evaluator = LinesEvaluator(paytable, paylines)
    
    bonus_feature = BonusFeature(trigger_count=3, num_free_spins=10, multiplier=2.0)
    hold_and_spin_feature = HoldAndSpinFeature(
        trigger_count=6, 
        coin_name="CO", 
        coin_values=[1.0, 2.0, 3.0, 5.0, 10.0, 50.0],
        coin_probability=0.05
    )

    runner = SimulationRunner(
        reel_engine=reel_engine,
        evaluator=evaluator,
        bet_amount=1.0,
        bonus_feature=bonus_feature,
        hold_and_spin_feature=hold_and_spin_feature
    )
    
    import builtins
    original_print = builtins.print
    builtins.print = lambda *args, **kwargs: None
    
    metrics = runner.run(num_spins=num_spins, output_csv="tuner_results.csv")
    
    builtins.print = original_print
    
    return metrics["Total RTP"]

def main():
    target_rtp = 0.95
    low_w = 0.5
    high_w = 15.0
    
    print("Starting binary search for Wild weight to hit 95.00% RTP...")
    
    best_w = 2.0
    
    for i in range(8):
        mid_w = (low_w + high_w) / 2.0
        print(f"Iteration {i+1}: Testing Wild weight = {mid_w:.3f}")
        rtp = evaluate_rtp(mid_w, num_spins=500000)
        print(f"  Resulting RTP: {rtp:.4%}")
        
        if rtp < target_rtp:
            low_w = mid_w
        else:
            high_w = mid_w
            
        best_w = mid_w
            
    print(f"\nPhase 1 complete. Estimated Wild weight: {best_w:.3f}")
    print("Running 3,000,000 spin verification...")
    final_rtp = evaluate_rtp(best_w, num_spins=3000000)
    print(f"Final RTP at W={best_w:.3f}: {final_rtp:.4%}")

    print(f"\nTUNING COMPLETE.")
    print(f"Optimal Base Wild Weight: {best_w:.3f}")

if __name__ == "__main__":
    main()
