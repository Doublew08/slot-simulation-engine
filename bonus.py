from typing import Tuple
from reels import ReelEngine
from evaluator import BaseEvaluator

class BonusFeature:
    """
    Manages the triggering and execution of free spins.
    """
    def __init__(self, trigger_count: int, num_free_spins: int, multiplier: float = 1.0):
        self.trigger_count = trigger_count
        self.num_free_spins = num_free_spins
        self.multiplier = multiplier

    def check_trigger(self, scatter_count: int) -> bool:
        """
        Checks if the free spins feature is triggered.
        """
        return scatter_count >= self.trigger_count

    def run_free_spins(self, reel_engine: ReelEngine, evaluator: BaseEvaluator) -> Tuple[float, int]:
        """
        Runs the free spins feature.
        Returns (total_payout, actual_spins_played)
        """
        total_payout = 0.0
        spins_remaining = self.num_free_spins
        spins_played = 0

        while spins_remaining > 0:
            spins_remaining -= 1
            spins_played += 1
            
            grid = reel_engine.spin()
            
            # Evaluate base wins (lines/ways)
            spin_payout, _ = evaluator.evaluate(grid)
            
            # Evaluate scatters for retriggers/payouts
            scatter_count, scatter_payout = evaluator.evaluate_scatters(grid)
            
            # Apply multiplier to lines/ways wins
            total_payout += (spin_payout * self.multiplier) + scatter_payout
            
            # Check for retrigger
            if self.check_trigger(scatter_count):
                spins_remaining += self.num_free_spins
                
        return total_payout, spins_played
