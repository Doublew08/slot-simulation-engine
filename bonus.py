from typing import Optional, Tuple

from reels import ReelEngine
from evaluator import BaseEvaluator


class BonusFeature:
    """
    Free-spins bonus triggered by scatter count.

    Supports an optional separate reel set for the bonus round and a hard
    cap on total spins to prevent degenerate retrigger loops.
    """

    def __init__(
        self,
        trigger_count: int,
        num_free_spins: int,
        multiplier: float = 1.0,
        max_total_spins: int = 500,
        bonus_reel_engine: Optional[ReelEngine] = None,
    ):
        self.trigger_count = trigger_count
        self.num_free_spins = num_free_spins
        self.multiplier = multiplier
        self.max_total_spins = max_total_spins
        self.bonus_reel_engine = bonus_reel_engine

    def check_trigger(self, scatter_count: int) -> bool:
        return scatter_count >= self.trigger_count

    def run_free_spins(
        self, base_reel_engine: ReelEngine, evaluator: BaseEvaluator,
        cascade_fn=None,
    ) -> Tuple[float, int]:
        """
        Runs the free-spins loop.

        cascade_fn: optional callable(grid) -> (line_payout, sc_count, sc_pay).
        When provided, each spin applies the cascade tumble mechanic (matching
        the JS engine). When None, falls back to single-evaluation per spin.

        Returns (total_payout_multiplier, spins_played).
        """
        reel_engine = self.bonus_reel_engine or base_reel_engine
        total_payout = 0.0
        spins_remaining = self.num_free_spins
        spins_played = 0

        while spins_remaining > 0 and spins_played < self.max_total_spins:
            spins_remaining -= 1
            spins_played += 1

            grid = reel_engine.spin()

            if cascade_fn is not None:
                spin_payout, scatter_count, scatter_payout = cascade_fn(grid)
            else:
                spin_payout, _ = evaluator.evaluate(grid)
                scatter_count, scatter_payout = evaluator.evaluate_scatters(grid)

            total_payout += (spin_payout + scatter_payout) * self.multiplier

            if self.check_trigger(scatter_count):
                spins_remaining += self.num_free_spins

        return total_payout, spins_played
