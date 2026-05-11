import sys
from paytable import Paytable, Symbol
from reels import Reel, ReelEngine
from evaluator import LinesEvaluator, WaysEvaluator
from bonus import BonusFeature
from hold_and_spin import HoldAndSpinFeature
from simulation import SimulationRunner

def main():
    # 1. Define Paytable
    # Payouts are defined as multipliers of the total bet
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

    # 2. Define Reels (5 reels)
    wild_weight = 4.238
    
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

    # 3. Define Evaluator (20 lines)
    paylines = [
        [1, 1, 1, 1, 1], # Line 1
        [0, 0, 0, 0, 0], # Line 2
        [2, 2, 2, 2, 2], # Line 3
        [0, 1, 2, 1, 0], # Line 4
        [2, 1, 0, 1, 2], # Line 5
        [1, 0, 1, 2, 1], # Line 6
        [1, 2, 1, 0, 1], # Line 7
        [0, 0, 1, 2, 2], # Line 8
        [2, 2, 1, 0, 0], # Line 9
        [1, 2, 2, 2, 1], # Line 10
        [1, 0, 0, 0, 1], # Line 11
        [0, 1, 1, 1, 0], # Line 12
        [2, 1, 1, 1, 2], # Line 13
        [0, 2, 0, 2, 0], # Line 14
        [2, 0, 2, 0, 2], # Line 15
        [1, 1, 0, 1, 1], # Line 16
        [1, 1, 2, 1, 1], # Line 17
        [0, 0, 2, 0, 0], # Line 18
        [2, 2, 0, 2, 2], # Line 19
        [0, 2, 2, 2, 0], # Line 20
    ]
    evaluator = LinesEvaluator(paytable, paylines)
    
    # 4. Define Features
    bonus_feature = BonusFeature(trigger_count=3, num_free_spins=10, multiplier=2.0)
    
    hold_and_spin_feature = HoldAndSpinFeature(
        trigger_count=6, 
        coin_name="CO", 
        coin_values=[1.0, 2.0, 3.0, 5.0, 10.0, 50.0],
        coin_probability=0.05
    )

    # 5. Run Simulation
    num_spins = 100000
    if len(sys.argv) > 1:
        num_spins = int(sys.argv[1])
        
    runner = SimulationRunner(
        reel_engine=reel_engine,
        evaluator=evaluator,
        bet_amount=1.0,
        bonus_feature=bonus_feature,
        hold_and_spin_feature=hold_and_spin_feature
    )
    
    runner.run(num_spins=num_spins, output_csv="results.csv")

if __name__ == "__main__":
    main()
