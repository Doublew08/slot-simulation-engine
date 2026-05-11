import random
from typing import List, Tuple

class HoldAndSpinFeature:
    """
    Manages the Hold and Spin (Coin/Link) feature.
    """
    def __init__(self, trigger_count: int, coin_name: str, coin_values: List[float], coin_probability: float = 0.1):
        self.trigger_count = trigger_count
        self.coin_name = coin_name
        self.coin_values = coin_values
        self.coin_probability = coin_probability
        self.initial_respins = 3

    def check_trigger(self, grid: List[List[str]]) -> Tuple[bool, List[List[bool]], float]:
        """
        Checks if the feature is triggered and returns the mask of held coins and their initial value sum.
        """
        num_rows = len(grid)
        num_cols = len(grid[0])
        
        held_mask = [[False for _ in range(num_cols)] for _ in range(num_rows)]
        coin_count = 0
        initial_value = 0.0
        
        for r in range(num_rows):
            for c in range(num_cols):
                if grid[r][c] == self.coin_name:
                    held_mask[r][c] = True
                    coin_count += 1
                    initial_value += random.choice(self.coin_values)
                    
        return coin_count >= self.trigger_count, held_mask, initial_value

    def run_hold_and_spin(self, initial_mask: List[List[bool]], initial_value: float) -> Tuple[float, int]:
        """
        Runs the hold and spin feature.
        Returns (total_payout, total_respins_played)
        """
        num_rows = len(initial_mask)
        num_cols = len(initial_mask[0])
        
        # Deep copy mask
        mask = [[initial_mask[r][c] for c in range(num_cols)] for r in range(num_rows)]
        total_value = initial_value
        
        respins_left = self.initial_respins
        spins_played = 0
        
        while respins_left > 0:
            respins_left -= 1
            spins_played += 1
            
            new_coin_landed = False
            
            for r in range(num_rows):
                for c in range(num_cols):
                    if not mask[r][c]:
                        # Spin this independent position
                        if random.random() < self.coin_probability:
                            mask[r][c] = True
                            new_coin_landed = True
                            total_value += random.choice(self.coin_values)
            
            if new_coin_landed:
                respins_left = self.initial_respins
                
            # Check for full screen
            full_screen = all(all(row) for row in mask)
            if full_screen:
                break
                
        return total_value, spins_played
