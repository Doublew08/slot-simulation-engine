import sys
from paytable import Paytable, Symbol
from reels import Reel, ReelEngine
from evaluator import LinesEvaluator, WaysEvaluator
from bonus import BonusFeature
from hold_and_spin import HoldAndSpinFeature
from simulation import SimulationRunner


PAYLINES = [
    [1, 1, 1, 1, 1],  # Line 1  — middle
    [0, 0, 0, 0, 0],  # Line 2  — top
    [2, 2, 2, 2, 2],  # Line 3  — bottom
    [0, 1, 2, 1, 0],  # Line 4
    [2, 1, 0, 1, 2],  # Line 5
    [1, 0, 1, 2, 1],  # Line 6
    [1, 2, 1, 0, 1],  # Line 7
    [0, 0, 1, 2, 2],  # Line 8
    [2, 2, 1, 0, 0],  # Line 9
    [1, 2, 2, 2, 1],  # Line 10
    [1, 0, 0, 0, 1],  # Line 11
    [0, 1, 1, 1, 0],  # Line 12
    [2, 1, 1, 1, 2],  # Line 13
    [0, 2, 0, 2, 0],  # Line 14
    [2, 0, 2, 0, 2],  # Line 15
    [1, 1, 0, 1, 1],  # Line 16
    [1, 1, 2, 1, 1],  # Line 17
    [0, 0, 2, 0, 0],  # Line 18
    [2, 2, 0, 2, 2],  # Line 19
    [0, 2, 2, 2, 0],  # Line 20
]


def build_game(wild_weight: float = 4.238) -> SimulationRunner:
    """
    Construct the full game model and return a ready-to-run SimulationRunner.

    wild_weight controls wild frequency across all reels.  The tuner binary-
    searches this parameter to hit a target RTP.
    """
    symbols = [
        Symbol(name="W",  payouts={3: 0.5, 4: 2.0, 5: 10.0}, is_wild=True),
        Symbol(name="H1", payouts={3: 0.4, 4: 1.5, 5:  5.0}),
        Symbol(name="H2", payouts={3: 0.3, 4: 1.0, 5:  4.0}),
        Symbol(name="M1", payouts={3: 0.2, 4: 0.8, 5:  2.5}),
        Symbol(name="M2", payouts={3: 0.2, 4: 0.6, 5:  2.0}),
        Symbol(name="L1", payouts={3: 0.1, 4: 0.4, 5:  1.5}),
        Symbol(name="L2", payouts={3: 0.1, 4: 0.3, 5:  1.0}),
        Symbol(name="SC", payouts={3: 2.0, 4: 10.0, 5: 50.0}, is_scatter=True),
        Symbol(name="CO", payouts={}, is_coin=True),
    ]
    paytable = Paytable(symbols)

    base_weights = {
        "W":  wild_weight,
        "H1": 4, "H2": 5,
        "M1": 6, "M2": 7,
        "L1": 10, "L2": 12,
        "SC": 2,
        "CO": 3,
    }

    reels = [
        Reel(base_weights),
        Reel({**base_weights, "W": wild_weight * 1.5, "SC": 3, "CO": 4}),
        Reel({**base_weights, "H1": 5,                "SC": 2, "CO": 5}),
        Reel({**base_weights, "W": wild_weight * 2.0, "SC": 2, "CO": 4}),
        Reel({**base_weights, "H2": 6,                "SC": 3, "CO": 3}),
    ]
    reel_engine = ReelEngine(reels, num_rows=3)

    evaluator = LinesEvaluator(paytable, PAYLINES)

    bonus_feature = BonusFeature(
        trigger_count=3,
        num_free_spins=10,
        multiplier=2.0,
        max_total_spins=500,
    )

    hold_and_spin_feature = HoldAndSpinFeature(
        trigger_count=6,
        coin_name="CO",
        coin_values=[1.0, 2.0, 3.0, 5.0, 10.0, 50.0],
        reel_engine=reel_engine,
        jackpots={"Mini": 10.0, "Minor": 50.0, "Major": 500.0, "Grand": 5000.0},
    )

    return SimulationRunner(
        reel_engine=reel_engine,
        evaluator=evaluator,
        bet_amount=1.0,
        bonus_feature=bonus_feature,
        hold_and_spin_feature=hold_and_spin_feature,
        exclusive_features=False,
    )


def main():
    num_spins = 1_000_000
    seed = None
    workers = 1

    if len(sys.argv) > 1:
        num_spins = int(sys.argv[1])
    if len(sys.argv) > 2:
        seed = int(sys.argv[2])
    if len(sys.argv) > 3:
        workers = int(sys.argv[3])

    runner = build_game()
    runner.run(num_spins=num_spins, output_csv="results.csv", seed=seed, workers=workers)


if __name__ == "__main__":
    main()
