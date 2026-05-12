from typing import List, Dict, Tuple
from paytable import Paytable

class BaseEvaluator:
    """
    Base class for win evaluation.
    """
    def __init__(self, paytable: Paytable):
        self.paytable = paytable

    def evaluate(self, grid: List[List[str]]) -> Tuple[float, List[dict]]:
        raise NotImplementedError

    def evaluate_scatters(self, grid: List[List[str]]) -> Tuple[int, float]:
        """
        Evaluates scatter wins. Scatters pay anywhere.
        Returns (scatter_count, payout)
        """
        scatter_name = self.paytable.scatter_name
        if not scatter_name:
            return 0, 0.0
            
        count = sum(row.count(scatter_name) for row in grid)
        payout = self.paytable.payout(scatter_name, count)
        return count, payout


class LinesEvaluator(BaseEvaluator):
    """
    Evaluates wins based on predefined paylines.
    """
    def __init__(self, paytable: Paytable, paylines: List[List[int]]):
        super().__init__(paytable)
        self.paylines = paylines

    def evaluate(self, grid: List[List[str]]) -> Tuple[float, List[dict]]:
        total_payout = 0.0
        winning_lines = []
        num_cols = len(grid[0])
        
        for line_idx, line in enumerate(self.paylines):
            # Extract symbols on this line
            symbols_on_line = [grid[row][col] for col, row in enumerate(line)]
            
            first_sym = None
            match_count = 0
            
            for i in range(num_cols):
                sym = symbols_on_line[i]
                
                # Special non-wild symbols (like scatters/coins) break lines
                if self.paytable.is_special(sym) and not self.paytable.is_wild(sym):
                    break

                if first_sym is None:
                    if self.paytable.is_wild(sym):
                        match_count += 1
                    else:
                        first_sym = sym
                        match_count += 1
                else:
                    if sym == first_sym or self.paytable.is_wild(sym):
                        match_count += 1
                    else:
                        break

            # Handle case where line is entirely wilds
            if first_sym is None and match_count > 0:
                first_sym = self.paytable.wild_name
            
            if first_sym is not None:
                payout = self.paytable.payout(first_sym, match_count)
                
                # Check pure wild count to see if it pays more
                pure_wild_count = 0
                for sym in symbols_on_line:
                    if self.paytable.is_wild(sym):
                        pure_wild_count += 1
                    else:
                        break
                pure_wild_payout = self.paytable.payout(self.paytable.wild_name, pure_wild_count) if self.paytable.wild_name else 0.0
                
                best_payout = max(payout, pure_wild_payout)
                best_sym = self.paytable.wild_name if best_payout == pure_wild_payout and pure_wild_payout > 0 else first_sym
                
                if best_payout > 0:
                    total_payout += best_payout
                    winning_lines.append({
                        "line": line_idx,
                        "symbol": best_sym,
                        "count": match_count if best_payout == payout else pure_wild_count,
                        "payout": best_payout
                    })
                    
        return total_payout, winning_lines


class WaysEvaluator(BaseEvaluator):
    """
    Evaluates wins based on any contiguous left-to-right matches (e.g., 243 ways).
    """
    def evaluate(self, grid: List[List[str]]) -> Tuple[float, List[dict]]:
        total_payout = 0.0
        winning_ways = []
        
        num_rows = len(grid)
        num_cols = len(grid[0])
        
        # Evaluate ways for each regular symbol and wild
        for symbol in self.paytable.all_symbols():
            if symbol.is_scatter or symbol.is_coin:
                continue
                
            col_counts = []
            for col in range(num_cols):
                count = 0
                for row in range(num_rows):
                    sym = grid[row][col]
                    if symbol.is_wild:
                        # Wilds only match wilds when evaluating the Wild symbol itself
                        if self.paytable.is_wild(sym):
                            count += 1
                    else:
                        # Regular symbols match themselves and wilds
                        if sym == symbol.name or self.paytable.is_wild(sym):
                            count += 1
                col_counts.append(count)
            
            match_count = 0
            ways = 1
            for count in col_counts:
                if count > 0:
                    match_count += 1
                    ways *= count
                else:
                    break
                    
            if match_count >= 3:
                payout_per_way = self.paytable.payout(symbol.name, match_count)
                if payout_per_way > 0:
                    total = payout_per_way * ways
                    total_payout += total
                    winning_ways.append({
                        "symbol": symbol.name,
                        "count": match_count,
                        "ways": ways,
                        "payout": total
                    })
                    
        return total_payout, winning_ways
