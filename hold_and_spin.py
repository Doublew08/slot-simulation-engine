import random
from typing import Dict, List, Optional, Tuple

from reels import ReelEngine


class HoldAndSpinFeature:
    """
    Hold and Spin (Coin/Link) feature with jackpots.

    During respins, each free position is resolved by spinning its reel column
    directly — coin probability matches the live reel math, not a flat override.
    """

    DEFAULT_JACKPOTS: Dict[str, float] = {
        "Mini": 10.0,
        "Minor": 50.0,
        "Major": 500.0,
        "Grand": 5000.0,
    }

    def __init__(
        self,
        trigger_count: int,
        coin_name: str,
        coin_values: List[float],
        reel_engine: ReelEngine,
        jackpots: Optional[Dict[str, float]] = None,
        initial_respins: int = 3,
        major_probability: float = 0.0001,
    ):
        self.trigger_count = trigger_count
        self.coin_name = coin_name
        self.coin_values = coin_values
        self.reel_engine = reel_engine
        self.jackpots = jackpots if jackpots is not None else dict(self.DEFAULT_JACKPOTS)
        self.initial_respins = initial_respins
        self.major_probability = major_probability

        # Weighted pool: coin values + Mini/Minor jackpots.
        # Major drawn via separate probability; Grand is full-screen only.
        self._pool_values: List = list(coin_values) + ["Mini", "Minor"]
        self._pool_weights: List[int] = [100] * len(coin_values) + [5, 1]

    def _get_random_coin_value(self) -> float:
        if random.random() < self.major_probability:
            return self.jackpots.get("Major", 500.0)
        val = random.choices(self._pool_values, weights=self._pool_weights, k=1)[0]
        if isinstance(val, str):
            return self.jackpots.get(val, 0.0)
        return float(val)

    def check_trigger(
        self, grid: List[List[str]]
    ) -> Tuple[bool, List[List[bool]], float]:
        """
        Scans grid for coin symbols.

        Coin values are assigned ONLY when the trigger threshold is met —
        no RNG state is consumed on non-triggering spins.

        Returns (triggered, held_mask, initial_coin_value_sum).
        """
        num_rows = len(grid)
        num_cols = len(grid[0])

        # First pass: count only (no RNG)
        coin_positions = [
            (r, c)
            for r in range(num_rows)
            for c in range(num_cols)
            if grid[r][c] == self.coin_name
        ]

        if len(coin_positions) < self.trigger_count:
            held_mask = [[False] * num_cols for _ in range(num_rows)]
            return False, held_mask, 0.0

        # Second pass: build mask and assign values (trigger confirmed)
        held_mask = [[False] * num_cols for _ in range(num_rows)]
        initial_value = 0.0
        for r, c in coin_positions:
            held_mask[r][c] = True
            initial_value += self._get_random_coin_value()

        return True, held_mask, initial_value

    def run_hold_and_spin(
        self, initial_mask: List[List[bool]], initial_value: float
    ) -> Tuple[float, int, bool]:
        """
        Runs the hold-and-spin respin loop.

        Each free position is spun using its column's actual reel weights.

        Returns (total_payout, respins_played, hit_grand).
        """
        num_rows = len(initial_mask)
        num_cols = len(initial_mask[0])
        total_positions = num_rows * num_cols

        mask = [[initial_mask[r][c] for c in range(num_cols)] for r in range(num_rows)]
        held_count = sum(mask[r][c] for r in range(num_rows) for c in range(num_cols))
        total_value = initial_value
        respins_left = self.initial_respins
        spins_played = 0
        hit_grand = False

        while respins_left > 0:
            respins_left -= 1
            spins_played += 1
            new_coin_landed = False

            for r in range(num_rows):
                for c in range(num_cols):
                    if not mask[r][c]:
                        sym = self.reel_engine.reels[c].spin_one()
                        if sym == self.coin_name:
                            mask[r][c] = True
                            held_count += 1
                            new_coin_landed = True
                            total_value += self._get_random_coin_value()

            if new_coin_landed:
                respins_left = self.initial_respins

            if held_count == total_positions:
                total_value += self.jackpots.get("Grand", 5000.0)
                hit_grand = True
                break

        return total_value, spins_played, hit_grand
