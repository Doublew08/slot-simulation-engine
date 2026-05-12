import csv
import math
import multiprocessing
import random
from typing import Dict, List, Optional

from reels import ReelEngine
from evaluator import BaseEvaluator
from bonus import BonusFeature
from hold_and_spin import HoldAndSpinFeature


# ── Module-level worker (required for multiprocessing.Pool pickling on Windows) ──

def _simulation_worker(args):
    runner, num_spins, seed = args
    if seed is not None:
        random.seed(seed)
    return runner._run_batch(num_spins, verbose=False)


# ── Runner ────────────────────────────────────────────────────────────────────

class SimulationRunner:
    """Monte Carlo simulation runner with optional multiprocessing."""

    def __init__(
        self,
        reel_engine: ReelEngine,
        evaluator: BaseEvaluator,
        bet_amount: float = 1.0,
        bonus_feature: Optional[BonusFeature] = None,
        hold_and_spin_feature: Optional[HoldAndSpinFeature] = None,
        exclusive_features: bool = False,
    ):
        self.reel_engine = reel_engine
        self.evaluator = evaluator
        self.bet_amount = bet_amount
        self.bonus_feature = bonus_feature
        self.hold_and_spin_feature = hold_and_spin_feature
        # When True, H&S is skipped on spins where the bonus already triggered
        self.exclusive_features = exclusive_features

    # ── Public entry point ────────────────────────────────────────────────────

    def run(
        self,
        num_spins: int,
        output_csv: str = "results.csv",
        seed: Optional[int] = None,
        workers: int = 1,
        progress_cb=None,
    ) -> dict:
        """
        Run the simulation.

        workers > 1 spawns a multiprocessing.Pool for near-linear core scaling.
        Each worker receives a unique seed derived from the base seed so results
        are reproducible when seed is set.
        """
        print(
            f"Starting: {num_spins:,} spins | bet={self.bet_amount}"
            f" | seed={seed} | workers={workers}"
        )

        if workers > 1:
            batch = self._run_parallel(num_spins, seed, workers)
        else:
            if seed is not None:
                random.seed(seed)
            batch = self._run_batch(num_spins, verbose=True, progress_cb=progress_cb)

        metrics = self._compute_metrics(batch)
        if output_csv:
            self._export_csv(output_csv, metrics)
        self._print_results(metrics)
        return metrics

    # ── Cascade (tumble) mechanic ─────────────────────────────────────────────

    def _run_cascade_spin(self, grid: list) -> tuple:
        """
        Apply cascade to an already-spun grid.
        Winning symbols are removed, remaining symbols fall down, gaps fill
        from the top using the reel's weighted distribution. Repeats until
        no win or 15 cascades reached (matches JS engine cap).
        Returns (total_line_payout, scatter_count, scatter_payout).
        """
        reels    = self.reel_engine.reels
        evaluate = self.evaluator.evaluate
        eval_scatters = self.evaluator.evaluate_scatters

        sc_count, sc_pay = eval_scatters(grid)
        total_payout = 0.0

        for _ in range(15):
            bp, winning_lines = evaluate(grid)
            if bp <= 0:
                break
            total_payout += bp

            # Collect unique winning (row, col) coords from all winning lines
            winning_coords: set = set()
            for win in winning_lines:
                for coord in win["coords"]:
                    winning_coords.add(coord)

            # Group by column, sort rows descending (remove bottom-first)
            cols_to_remove: dict = {}
            for row, col in winning_coords:
                cols_to_remove.setdefault(col, []).append(row)

            for col, rows in cols_to_remove.items():
                for row in sorted(rows, reverse=True):
                    # Shift everything above this row down by one
                    for i in range(row, 0, -1):
                        grid[i][col] = grid[i - 1][col]
                    # Fill the vacated top cell with a fresh symbol
                    grid[0][col] = reels[col].spin_one()

        return total_payout, sc_count, sc_pay

    # ── Core simulation loop ──────────────────────────────────────────────────

    def _run_batch(self, num_spins: int, verbose: bool = True, progress_cb=None) -> dict:
        """
        Inner spin loop. Returns raw accumulator dict suitable for merging.
        Does NOT set random seed — caller is responsible.

        Optimisations vs naïve loop:
        - All self.* attributes cached as locals before the loop (avoids
          repeated __getattr__ / dict lookup inside the hot path).
        - Base-game spins pre-generated in chunks of CHUNK using one
          random.choices(k=CHUNK*rows) call per reel instead of one call
          per spin — reduces Python→C transitions by ~1000×.
        """
        # ── Local aliases ────────────────────────────────────────────────
        reels         = self.reel_engine.reels
        num_rows      = self.reel_engine.num_rows
        num_cols      = len(reels)
        evaluator     = self.evaluator
        evaluate      = self.evaluator.evaluate
        eval_scatters = self.evaluator.evaluate_scatters
        bonus         = self.bonus_feature
        hs            = self.hold_and_spin_feature
        exclusive     = self.exclusive_features
        bet           = self.bet_amount

        bonus_check   = bonus.check_trigger              if bonus else None
        bonus_run     = (lambda re, ev: bonus.run_free_spins(re, ev, cascade_fn=self._run_cascade_spin)) if bonus else None
        hs_check      = hs.check_trigger                 if hs    else None
        hs_run        = hs.run_hold_and_spin             if hs    else None
        reel_engine   = self.reel_engine

        # ── Accumulators ─────────────────────────────────────────────────
        base_win = bonus_win = hs_win = 0.0
        base_hits = bonus_triggers = hs_triggers = grand_jackpots = 0
        welf_n = 0; welf_mean = 0.0; welf_M2 = 0.0

        buckets: Dict[str, int] = {
            "0x": 0, ">0x to 1x": 0, ">1x to 5x": 0,
            ">5x to 15x": 0, ">15x to 50x": 0, ">50x": 0,
        }

        # Sample balance every 1K spins → ~1K points per 1M spins
        BALANCE_SAMPLE = 1_000
        balance_history: List[float] = []
        balance_running = 0.0

        # ── Chunked batch RNG ─────────────────────────────────────────────
        # Pre-generate base-game spins CHUNK at a time.  One big
        # random.choices(k=CHUNK×rows) per reel instead of CHUNK small calls.
        CHUNK = 100_000
        global_idx = 0

        for chunk_start in range(0, num_spins, CHUNK):
            chunk_end = min(chunk_start + CHUNK, num_spins)
            chunk_n   = chunk_end - chunk_start

            # 5 bulk calls generate chunk_n full grids worth of symbols
            all_cols = [
                random.choices(reel.symbols, weights=reel.weights, k=chunk_n * num_rows)
                for reel in reels
            ]

            for i in range(chunk_n):
                spin_idx = chunk_start + i
                off      = i * num_rows
                grid     = [
                    [all_cols[c][off + r] for c in range(num_cols)]
                    for r in range(num_rows)
                ]

                spin_win = 0.0

                # Base game — cascade tumble (winning symbols removed, new ones fall in)
                bp, sc_count, sc_pay = self._run_cascade_spin(grid)
                bsw = (bp + sc_pay) * bet
                if bsw > 0:
                    base_hits += 1
                    base_win  += bsw
                    spin_win  += bsw

                # Bonus feature
                bonus_fired = False
                if bonus and bonus_check(sc_count):
                    bonus_fired    = True
                    bonus_triggers += 1
                    raw, _  = bonus_run(reel_engine, evaluator)
                    bw      = raw * bet
                    bonus_win += bw
                    spin_win  += bw

                # Hold and Spin
                if hs and (not exclusive or not bonus_fired):
                    triggered, hs_mask, hs_init = hs_check(grid)
                    if triggered:
                        hs_triggers += 1
                        raw_hs, _, hit_grand = hs_run(hs_mask, hs_init)
                        hw = raw_hs * bet
                        hs_win   += hw
                        spin_win += hw
                        if hit_grand:
                            grand_jackpots += 1

                # Welford online variance
                welf_n  += 1
                delta    = spin_win - welf_mean
                welf_mean += delta / welf_n
                welf_M2  += delta * (spin_win - welf_mean)

                # Win bucket
                mult = spin_win / bet
                if mult == 0:          buckets["0x"]         += 1
                elif mult <= 1.0:      buckets[">0x to 1x"]  += 1
                elif mult <= 5.0:      buckets[">1x to 5x"]  += 1
                elif mult <= 15.0:     buckets[">5x to 15x"] += 1
                elif mult <= 50.0:     buckets[">15x to 50x"] += 1
                else:                  buckets[">50x"]        += 1

                # Balance random walk (sampled)
                balance_running += spin_win - bet
                if spin_idx % BALANCE_SAMPLE == 0:
                    balance_history.append(round(balance_running, 4))

                # Fine-grained progress every 10K spins (helps slow backends)
                if progress_cb and spin_idx > 0 and spin_idx % 10_000 == 0:
                    progress_cb(spin_idx / num_spins)

            if verbose and chunk_end % 1_000_000 == 0:
                print(f"  {chunk_end:,} spins complete...")
            if progress_cb:
                progress_cb(chunk_end / num_spins)

        return {
            "num_spins":       num_spins,
            "base_win":        base_win,
            "bonus_win":       bonus_win,
            "hs_win":          hs_win,
            "base_hits":       base_hits,
            "bonus_triggers":  bonus_triggers,
            "hs_triggers":     hs_triggers,
            "grand_jackpots":  grand_jackpots,
            "welf_n":          welf_n,
            "welf_mean":       welf_mean,
            "welf_M2":         welf_M2,
            "buckets":         buckets,
            "balance_history": balance_history,
        }

    # ── Parallel orchestration ────────────────────────────────────────────────

    def _run_parallel(self, num_spins: int, seed: Optional[int], workers: int) -> dict:
        chunk = num_spins // workers
        remainder = num_spins % workers
        chunks = [chunk + (1 if i < remainder else 0) for i in range(workers)]
        # Deterministic per-worker seeds; None → OS entropy per worker
        seeds = [seed + i if seed is not None else None for i in range(workers)]

        print(f"  Workers: {workers} | chunks: {chunks[0]}×{workers - remainder}"
              + (f" + {chunks[0]+1}×{remainder}" if remainder else ""))

        args = list(zip([self] * workers, chunks, seeds))
        with multiprocessing.Pool(processes=workers) as pool:
            batches = pool.map(_simulation_worker, args)

        return SimulationRunner._merge_batches(batches)

    @staticmethod
    def _merge_batches(batches: List[dict]) -> dict:
        """Merge accumulator dicts from parallel workers using parallel Welford."""
        merged = {
            "num_spins":      sum(b["num_spins"]      for b in batches),
            "base_win":       sum(b["base_win"]        for b in batches),
            "bonus_win":      sum(b["bonus_win"]       for b in batches),
            "hs_win":         sum(b["hs_win"]          for b in batches),
            "base_hits":      sum(b["base_hits"]       for b in batches),
            "bonus_triggers": sum(b["bonus_triggers"]  for b in batches),
            "hs_triggers":    sum(b["hs_triggers"]     for b in batches),
            "grand_jackpots": sum(b["grand_jackpots"]  for b in batches),
            "buckets": {
                k: sum(b["buckets"][k] for b in batches)
                for k in batches[0]["buckets"]
            },
        }

        # Parallel Welford merge (Chan et al. 1979)
        n    = batches[0]["welf_n"]
        mean = batches[0]["welf_mean"]
        M2   = batches[0]["welf_M2"]
        for b in batches[1:]:
            n2, m2, M2_2 = b["welf_n"], b["welf_mean"], b["welf_M2"]
            n_new = n + n2
            if n_new == 0:
                continue
            delta = m2 - mean
            mean  = mean + delta * n2 / n_new
            M2    = M2 + M2_2 + delta ** 2 * n * n2 / n_new
            n     = n_new

        merged.update({"welf_n": n, "welf_mean": mean, "welf_M2": M2})

        # Concatenate balance histories — offset each batch so the walk is continuous
        combined: List[float] = []
        offset = 0.0
        for b in batches:
            bh = b.get("balance_history", [])
            combined.extend(v + offset for v in bh)
            if bh:
                offset += bh[-1]
        merged["balance_history"] = combined

        return merged

    # ── Metrics computation ───────────────────────────────────────────────────

    def _compute_metrics(self, b: dict) -> dict:
        num_spins = b["num_spins"]
        bet = self.bet_amount
        # Single multiplication — no float accumulation error
        total_wagered = num_spins * bet
        total_win = b["base_win"] + b["bonus_win"] + b["hs_win"]

        def safe_div(n, d):
            return n / d if d > 0 else 0.0

        bt = b["bonus_triggers"]
        ht = b["hs_triggers"]
        gj = b["grand_jackpots"]

        variance   = b["welf_M2"] / b["welf_n"] if b["welf_n"] > 1 else 0.0
        volatility = math.sqrt(variance) / bet if variance > 0 else 0.0
        ci_95      = 1.96 * volatility / math.sqrt(num_spins) if volatility > 0 else 0.0

        metrics = {
            "Total Spins":                       num_spins,
            "Total RTP":                         safe_div(total_win,       total_wagered),
            "Base RTP":                          safe_div(b["base_win"],   total_wagered),
            "Bonus RTP":                         safe_div(b["bonus_win"],  total_wagered),
            "Hold and Spin RTP":                 safe_div(b["hs_win"],     total_wagered),
            "Base Hit Rate":                     safe_div(b["base_hits"],  num_spins),
            "Bonus Trigger Frequency (1 in X)":  safe_div(num_spins, bt),
            "Hold and Spin Frequency (1 in X)":  safe_div(num_spins, ht),
            "Grand Jackpot Frequency (1 in X)":  safe_div(num_spins, gj),
            "Avg Win Per Spin":                  safe_div(total_win,       num_spins),
            "Avg Bonus Win":                     safe_div(b["bonus_win"],  bt),
            "Avg Hold and Spin Win":             safe_div(b["hs_win"],     ht),
            "Volatility":                        volatility,
            "RTP CI 95%":                        ci_95,
        }
        for k, v in b["buckets"].items():
            metrics[f"Bucket: {k} (%)"] = (v / num_spins) * 100

        metrics["balance_history"] = b.get("balance_history", [])
        return metrics

    # ── Output ────────────────────────────────────────────────────────────────

    def _print_results(self, metrics: dict) -> None:
        print("\n--- Simulation Results ---")
        for k, v in metrics.items():
            if isinstance(v, list):
                continue
            if "Bucket" in k:
                print(f"  {k}: {v:.4f}%")
            elif "RTP" in k or "Rate" in k:
                print(f"  {k}: {v:.4%}")
            elif "Frequency" in k:
                print(f"  {k}: 1 in {v:.1f}")
            elif "Avg" in k:
                print(f"  {k}: {v:.4f}")
            else:
                print(f"  {k}: {v:.4f}")

    def _export_csv(self, filename: str, metrics: dict) -> None:
        with open(filename, "w", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["Metric", "Value"])
            for k, v in metrics.items():
                writer.writerow([k, v])
        print(f"\nResults exported to {filename}")
