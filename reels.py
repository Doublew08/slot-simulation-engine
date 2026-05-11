import random
from typing import Dict, List

class Reel:
    """
    Represents a single reel strip with weighted symbols.
    """
    def __init__(self, symbol_weights: Dict[str, int]):
        self.symbols = list(symbol_weights.keys())
        self.weights = list(symbol_weights.values())

    def spin_column(self, num_rows: int) -> List[str]:
        """
        Returns a list of symbols representing a column on the screen.
        """
        return random.choices(self.symbols, weights=self.weights, k=num_rows)


class ReelEngine:
    """
    Manages a set of reels and generates the 2D grid of symbols for a spin.
    """
    def __init__(self, reels: List[Reel], num_rows: int = 3):
        self.reels = reels
        self.num_rows = num_rows

    def spin(self) -> List[List[str]]:
        """
        Spins all reels and returns a 2D matrix (grid[row][col]) of the visible window.
        """
        # Generate each column independently
        columns = [reel.spin_column(self.num_rows) for reel in self.reels]
        
        num_cols = len(self.reels)
        # Transpose columns into rows: grid[row][col]
        grid = []
        for r in range(self.num_rows):
            row = [columns[c][r] for c in range(num_cols)]
            grid.append(row)
            
        return grid
