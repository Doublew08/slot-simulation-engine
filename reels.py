import random, secrets
from typing import Dict, List

class Reel:
    """
    Represents a single reel strip with weighted symbols.
    """
    def __init__(self, symbol_weights: Dict[str, int]):
        self.symbols = list(symbol_weights.keys())
        self.weights = list(symbol_weights.values())

    def spin_column(self, num_rows: int, rng=None) -> List[str]:
        r = rng or random
        return r.choices(self.symbols, weights=self.weights, k=num_rows)

    def spin_one(self, rng=None) -> str:
        r = rng or random
        return r.choices(self.symbols, weights=self.weights, k=1)[0]


class ReelEngine:
    """
    Manages a set of reels and generates the 2D grid of symbols for a spin.
    """
    def __init__(self, reels: List[Reel], num_rows: int = 3):
        self.reels = reels
        self.num_rows = num_rows

    def spin(self, rng=None) -> List[List[str]]:
        """
        Spins all reels and returns a 2D matrix (grid[row][col]) of the visible window.
        """
        # Generate each column independently
        columns = [reel.spin_column(self.num_rows, rng) for reel in self.reels]
        
        # Transpose columns → rows via zip (C-level, no manual loop)
        return [list(row) for row in zip(*columns)]
