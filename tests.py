"""
Unit tests for the slot simulation engine.

Run with:
    python tests.py
    python -m pytest tests.py -v   (if pytest installed)
"""
import random
import unittest

from paytable import Paytable, Symbol
from reels import Reel, ReelEngine
from evaluator import LinesEvaluator, WaysEvaluator
from bonus import BonusFeature
from hold_and_spin import HoldAndSpinFeature


# ── Fixtures ─────────────────────────────────────────────────────────────────

# "NP" = no-pay filler; not in paytable → payout always 0, won't pollute tests
FILLER = "NP"

MIDDLE_PAYLINE  = [[1, 1, 1, 1, 1]]   # single row — LinesEvaluator tests only

THREE_PAYLINES = [
    [1, 1, 1, 1, 1],
    [0, 0, 0, 0, 0],
    [2, 2, 2, 2, 2],
]


def make_paytable() -> Paytable:
    return Paytable([
        Symbol("W",  {3: 0.5,  4: 2.0,  5: 10.0}, is_wild=True),
        Symbol("H1", {3: 0.4,  4: 1.5,  5:  5.0}),
        Symbol("H2", {3: 0.3,  4: 1.0,  5:  4.0}),
        Symbol("L1", {3: 0.1,  4: 0.4,  5:  1.5}),
        Symbol("SC", {3: 2.0,  4: 10.0, 5: 50.0}, is_scatter=True),
        Symbol("CO", {}, is_coin=True),
        # FILLER ("NP") intentionally omitted — unknown symbol → payout 0
    ])


def make_reel_engine(symbol_weights: dict = None) -> ReelEngine:
    w = symbol_weights or {"W": 2, "H1": 4, "H2": 5, "L1": 10, "SC": 2, "CO": 3}
    return ReelEngine([Reel(w) for _ in range(5)], num_rows=3)


def make_hs(trigger_count: int = 6, coin_re: ReelEngine = None, **kwargs) -> HoldAndSpinFeature:
    if coin_re is None:
        coin_re = make_reel_engine()
    return HoldAndSpinFeature(
        trigger_count=trigger_count,
        coin_name="CO",
        coin_values=[1.0, 2.0, 5.0],
        reel_engine=coin_re,
        **kwargs,
    )


# ── Paytable ─────────────────────────────────────────────────────────────────

class TestPaytable(unittest.TestCase):
    def setUp(self):
        self.pt = make_paytable()

    def test_payout_lookup(self):
        self.assertAlmostEqual(self.pt.payout("H1", 3), 0.4)
        self.assertAlmostEqual(self.pt.payout("H1", 5), 5.0)

    def test_missing_count_returns_zero(self):
        self.assertEqual(self.pt.payout("H1", 2), 0.0)

    def test_missing_symbol_returns_zero(self):
        self.assertEqual(self.pt.payout("MISSING", 3), 0.0)

    def test_flags(self):
        self.assertTrue(self.pt.is_wild("W"))
        self.assertFalse(self.pt.is_wild("H1"))
        self.assertTrue(self.pt.is_scatter("SC"))
        self.assertTrue(self.pt.is_coin("CO"))

    def test_is_special(self):
        self.assertTrue(self.pt.is_special("W"))
        self.assertTrue(self.pt.is_special("SC"))
        self.assertTrue(self.pt.is_special("CO"))
        self.assertFalse(self.pt.is_special("H1"))

    def test_filler_not_in_paytable(self):
        self.assertEqual(self.pt.payout(FILLER, 5), 0.0)
        self.assertIsNone(self.pt.get(FILLER))


# ── LinesEvaluator ───────────────────────────────────────────────────────────
# All tests use a SINGLE middle payline so top/bottom rows never interfere.

class TestLinesEvaluator(unittest.TestCase):
    def setUp(self):
        self.pt = make_paytable()
        self.ev = LinesEvaluator(self.pt, MIDDLE_PAYLINE)

    def _grid(self, middle):
        """3×5 grid: middle row is the test row; top/bottom use non-paying FILLER."""
        return [
            [FILLER] * 5,
            middle,
            [FILLER] * 5,
        ]

    def test_3oak_middle_row(self):
        grid = self._grid(["H1", "H1", "H1", FILLER, FILLER])
        payout, wins = self.ev.evaluate(grid)
        self.assertAlmostEqual(payout, self.pt.payout("H1", 3))
        self.assertEqual(len(wins), 1)

    def test_4oak(self):
        grid = self._grid(["H1", "H1", "H1", "H1", FILLER])
        payout, _ = self.ev.evaluate(grid)
        self.assertAlmostEqual(payout, self.pt.payout("H1", 4))

    def test_5oak(self):
        grid = self._grid(["H1"] * 5)
        payout, _ = self.ev.evaluate(grid)
        self.assertAlmostEqual(payout, self.pt.payout("H1", 5))

    def test_wild_prefix_substitutes(self):
        # W + H1 + H1 → treated as H1×3
        grid = self._grid(["W", "H1", "H1", FILLER, FILLER])
        payout, _ = self.ev.evaluate(grid)
        self.assertAlmostEqual(payout, self.pt.payout("H1", 3))

    def test_wild_middle_substitutes(self):
        # H1 + W + H1 + H1 + H1 → H1×5
        grid = self._grid(["H1", "W", "H1", "H1", "H1"])
        payout, _ = self.ev.evaluate(grid)
        self.assertAlmostEqual(payout, self.pt.payout("H1", 5))

    def test_all_wilds_pays_wild_table(self):
        grid = self._grid(["W"] * 5)
        payout, _ = self.ev.evaluate(grid)
        self.assertGreater(payout, 0.0)

    def test_scatter_breaks_line(self):
        # SC at col 0 — not a wild, breaks the left-to-right sequence
        grid = self._grid(["SC", "H1", "H1", "H1", "H1"])
        payout, _ = self.ev.evaluate(grid)
        self.assertEqual(payout, 0.0)

    def test_mismatched_symbols_no_win(self):
        grid = self._grid(["H1", "H2", "H1", "H2", "H1"])
        payout, _ = self.ev.evaluate(grid)
        self.assertEqual(payout, 0.0)

    def test_short_run_no_win(self):
        grid = self._grid(["H1", "H1", FILLER, FILLER, FILLER])
        payout, _ = self.ev.evaluate(grid)
        self.assertEqual(payout, 0.0)

    def test_scatter_count_3(self):
        # Scatters anywhere on the full grid
        grid = [
            ["SC", "SC", "SC", FILLER, FILLER],
            [FILLER] * 5,
            [FILLER] * 5,
        ]
        count, sc_pay = self.ev.evaluate_scatters(grid)
        self.assertEqual(count, 3)
        self.assertAlmostEqual(sc_pay, self.pt.payout("SC", 3))

    def test_scatter_below_threshold_no_payout(self):
        grid = [
            ["SC", "SC", FILLER, FILLER, FILLER],
            [FILLER] * 5,
            [FILLER] * 5,
        ]
        count, sc_pay = self.ev.evaluate_scatters(grid)
        self.assertEqual(count, 2)
        self.assertEqual(sc_pay, 0.0)

    def test_multiple_paylines_accumulate(self):
        # With 3 paylines and H1 on all 3 rows — each line should pay H1×5
        ev3 = LinesEvaluator(self.pt, THREE_PAYLINES)
        grid = [
            ["H1"] * 5,   # row 0 = top payline
            ["H1"] * 5,   # row 1 = middle payline
            ["H1"] * 5,   # row 2 = bottom payline
        ]
        payout, wins = ev3.evaluate(grid)
        expected = self.pt.payout("H1", 5) * 3
        self.assertAlmostEqual(payout, expected)
        self.assertEqual(len(wins), 3)


# ── WaysEvaluator ────────────────────────────────────────────────────────────
# FILLER symbol is not in the paytable → payout always 0 → no accidental wins.

class TestWaysEvaluator(unittest.TestCase):
    def setUp(self):
        self.pt = make_paytable()
        self.ev = WaysEvaluator(self.pt)

    def test_3reel_single_way(self):
        # H1 on exactly one row, first 3 cols; FILLER everywhere else
        grid = [
            [FILLER] * 5,
            ["H1", "H1", "H1", FILLER, FILLER],
            [FILLER] * 5,
        ]
        payout, wins = self.ev.evaluate(grid)
        self.assertAlmostEqual(payout, self.pt.payout("H1", 3) * 1)

    def test_5reel_3row_ways_product(self):
        # H1 fills all 3 rows on all 5 cols → 3^5 = 243 ways
        grid = [["H1"] * 5 for _ in range(3)]
        payout, wins = self.ev.evaluate(grid)
        self.assertAlmostEqual(payout, self.pt.payout("H1", 5) * 243)

    def test_3reel_ways_product(self):
        # H1 fills all 3 rows on first 3 cols → 3×3×3 = 27 ways
        grid = [
            ["H1", "H1", "H1", FILLER, FILLER],
            ["H1", "H1", "H1", FILLER, FILLER],
            ["H1", "H1", "H1", FILLER, FILLER],
        ]
        payout, _ = self.ev.evaluate(grid)
        self.assertAlmostEqual(payout, self.pt.payout("H1", 3) * 27)

    def test_wild_adds_to_ways_count(self):
        # Col 0: H1 (row0) + W (row1) = 2 H1-matches; cols 1+2: 1 H1 each → ways=2
        grid = [
            ["H1",   "H1",   "H1",   FILLER, FILLER],
            ["W",    FILLER, FILLER, FILLER, FILLER],
            [FILLER, FILLER, FILLER, FILLER, FILLER],
        ]
        payout, _ = self.ev.evaluate(grid)
        # H1×3: 2 ways (from col0 having 2 matches)
        self.assertAlmostEqual(payout, self.pt.payout("H1", 3) * 2)

    def test_gap_in_reels_stops_count(self):
        # H1 on cols 0 and 2, nothing on col 1 → no win
        grid = [
            ["H1",   FILLER, "H1",   FILLER, FILLER],
            [FILLER, FILLER, FILLER, FILLER, FILLER],
            [FILLER, FILLER, FILLER, FILLER, FILLER],
        ]
        payout, wins = self.ev.evaluate(grid)
        h1_wins = [w for w in wins if w["symbol"] == "H1"]
        self.assertEqual(h1_wins, [])

    def test_two_symbols_independent_wins(self):
        # H1 on row0 cols 0-2; H2 on row1 cols 0-2 → each pays independently
        grid = [
            ["H1", "H1", "H1", FILLER, FILLER],
            ["H2", "H2", "H2", FILLER, FILLER],
            [FILLER] * 5,
        ]
        payout, wins = self.ev.evaluate(grid)
        expected = self.pt.payout("H1", 3) * 1 + self.pt.payout("H2", 3) * 1
        self.assertAlmostEqual(payout, expected)


# ── BonusFeature ─────────────────────────────────────────────────────────────

class TestBonusFeature(unittest.TestCase):
    def setUp(self):
        self.re = make_reel_engine()
        self.pt = make_paytable()
        self.ev = LinesEvaluator(self.pt, MIDDLE_PAYLINE)

    def test_trigger_at_threshold(self):
        bonus = BonusFeature(trigger_count=3, num_free_spins=10, multiplier=2.0)
        self.assertTrue(bonus.check_trigger(3))
        self.assertTrue(bonus.check_trigger(5))
        self.assertFalse(bonus.check_trigger(2))

    def test_retrigger_cap_enforced(self):
        random.seed(0)
        scatter_re = make_reel_engine({"SC": 1})
        bonus = BonusFeature(
            trigger_count=1, num_free_spins=10, multiplier=1.0, max_total_spins=50
        )
        _, spins_played = bonus.run_free_spins(scatter_re, self.ev)
        self.assertLessEqual(spins_played, 50)

    def test_returns_non_negative_payout(self):
        random.seed(42)
        bonus = BonusFeature(trigger_count=3, num_free_spins=10, multiplier=2.0)
        payout, spins = bonus.run_free_spins(self.re, self.ev)
        self.assertGreaterEqual(payout, 0.0)
        self.assertGreaterEqual(spins, 1)
        self.assertLessEqual(spins, 500)

    def test_bonus_reel_engine_used_when_provided(self):
        random.seed(1)
        base_re  = make_reel_engine({FILLER: 1})   # base: never pays
        bonus_re = make_reel_engine({"H1": 1})     # bonus: always H1
        ev = LinesEvaluator(self.pt, MIDDLE_PAYLINE)
        bonus_with    = BonusFeature(3, 5, 2.0, bonus_reel_engine=bonus_re)
        bonus_without = BonusFeature(3, 5, 2.0)
        p_with,    _ = bonus_with.run_free_spins(base_re, ev)
        p_without, _ = bonus_without.run_free_spins(base_re, ev)
        self.assertGreater(p_with, p_without)

    def test_multiplier_increases_payout(self):
        random.seed(7)
        ev = LinesEvaluator(self.pt, MIDDLE_PAYLINE)
        re = make_reel_engine({"H1": 1})   # always H1 → always wins
        bonus_x1 = BonusFeature(3, 5, multiplier=1.0)
        bonus_x3 = BonusFeature(3, 5, multiplier=3.0)
        p1, _ = bonus_x1.run_free_spins(re, ev)
        random.seed(7)
        p3, _ = bonus_x3.run_free_spins(re, ev)
        self.assertAlmostEqual(p3, p1 * 3, places=5)


# ── HoldAndSpinFeature ────────────────────────────────────────────────────────

class TestHoldAndSpin(unittest.TestCase):
    def test_trigger_below_count_not_triggered(self):
        hs = make_hs(trigger_count=6)
        grid = [
            ["CO", "CO", "L1", "L1", "L1"],
            ["CO", "CO", "L1", "L1", "L1"],
            ["CO", "L1", "L1", "L1", "L1"],  # 5 coins total
        ]
        triggered, _, _ = hs.check_trigger(grid)
        self.assertFalse(triggered)

    def test_trigger_fires_at_count(self):
        hs = make_hs(trigger_count=6)
        grid = [
            ["CO", "CO", "CO", "CO", "CO"],
            ["CO", "L1", "L1", "L1", "L1"],  # 6 coins
            ["L1", "L1", "L1", "L1", "L1"],
        ]
        triggered, _, _ = hs.check_trigger(grid)
        self.assertTrue(triggered)

    def test_initial_value_positive(self):
        random.seed(7)
        hs = make_hs(trigger_count=1)
        grid = [["CO"] * 5 for _ in range(3)]  # full coin grid
        _, _, initial_val = hs.check_trigger(grid)
        self.assertGreater(initial_val, 0.0)

    def test_grand_jackpot_on_full_screen(self):
        random.seed(0)
        coin_re = make_reel_engine({"CO": 1})   # all coins → full screen guaranteed
        jackpots = {"Mini": 10.0, "Minor": 50.0, "Major": 500.0, "Grand": 5000.0}
        hs = make_hs(trigger_count=1, coin_re=coin_re, jackpots=jackpots)
        mask = [[False] * 5 for _ in range(3)]
        mask[0][0] = True   # one coin already held, rest will fill
        payout, _, hit_grand = hs.run_hold_and_spin(mask, 1.0)
        self.assertTrue(hit_grand)
        self.assertGreaterEqual(payout, jackpots["Grand"])

    def test_no_new_coins_uses_exactly_3_respins(self):
        random.seed(0)
        empty_re = make_reel_engine({"L1": 1})  # no coins → all 3 lives wasted
        hs = make_hs(trigger_count=1, coin_re=empty_re)
        mask = [[False] * 5 for _ in range(3)]
        mask[0][0] = True
        _, spins_played, hit_grand = hs.run_hold_and_spin(mask, 5.0)
        self.assertEqual(spins_played, 3)
        self.assertFalse(hit_grand)

    def test_new_coin_resets_respins(self):
        random.seed(0)
        # Medium coin reel: ~50% chance per position. Start with 13 free positions.
        # High enough that new coins land but unlikely to fill the full screen in 1 spin.
        coin_re = make_reel_engine({"CO": 1, "L1": 1})
        hs = make_hs(trigger_count=1, coin_re=coin_re)
        # Hold 2 coins; 13 free positions with ~50% each → almost certain some land
        mask = [[False] * 5 for _ in range(3)]
        mask[0][0] = True
        mask[0][1] = True
        payout, _, _ = hs.run_hold_and_spin(mask, 2.0)
        # Payout must at least equal the initial value
        self.assertGreaterEqual(payout, 2.0)

    def test_respin_coin_probability_matches_reel_weights(self):
        # Rare coin reel → nearly no new coins during respins.
        random.seed(0)
        rare_re = make_reel_engine({"L1": 10_000, "CO": 1})
        hs = make_hs(trigger_count=1, coin_re=rare_re)
        extra_spin_count = 0
        for _ in range(200):
            m = [[False] * 5 for _ in range(3)]
            m[0][0] = True   # one coin held; 14 free positions
            _, sp, _ = hs.run_hold_and_spin(m, 1.0)
            if sp > 3:   # respin counter reset = new coin landed
                extra_spin_count += 1
        # CO weight ≈ 1/10001 ≈ 0.01% per position → very rare resets
        self.assertLess(extra_spin_count / 200, 0.15)


# ── Reels ────────────────────────────────────────────────────────────────────

class TestReels(unittest.TestCase):
    def test_spin_column_length(self):
        reel = Reel({"H1": 5, "L1": 10})
        result = reel.spin_column(3)
        self.assertEqual(len(result), 3)
        self.assertTrue(all(s in {"H1", "L1"} for s in result))

    def test_spin_one_in_symbol_set(self):
        reel = Reel({"H1": 5, "L1": 10})
        for _ in range(100):
            self.assertIn(reel.spin_one(), {"H1", "L1"})

    def test_reel_engine_grid_shape(self):
        re = make_reel_engine()
        grid = re.spin()
        self.assertEqual(len(grid), 3)       # 3 rows
        self.assertEqual(len(grid[0]), 5)    # 5 cols

    def test_reel_engine_grid_access(self):
        re = make_reel_engine()
        grid = re.spin()
        # grid[row][col] must always be a non-empty string
        for row in grid:
            for sym in row:
                self.assertIsInstance(sym, str)
                self.assertGreater(len(sym), 0)


# ── SimulationRunner integration ─────────────────────────────────────────────

def _build_runner():
    from main import build_game
    return build_game()


class TestSimulationRunner(unittest.TestCase):
    """End-to-end tests for the full pipeline. Catches wiring bugs that unit
    tests miss (e.g. a missing local alias inside _run_batch)."""

    def test_basic_metrics_in_range(self):
        metrics = _build_runner().run(num_spins=10_000, output_csv=None, seed=42)
        self.assertGreater(metrics["Total RTP"], 0.0)
        self.assertLess(metrics["Total RTP"], 2.0)
        self.assertGreater(metrics["Base Hit Rate"], 0.0)

    def test_seeded_run_reproducible(self):
        m1 = _build_runner().run(num_spins=5_000, output_csv=None, seed=99)
        m2 = _build_runner().run(num_spins=5_000, output_csv=None, seed=99)
        self.assertAlmostEqual(m1["Total RTP"], m2["Total RTP"], places=10)

    def test_rtp_ci_present_and_plausible(self):
        metrics = _build_runner().run(num_spins=10_000, output_csv=None, seed=1)
        ci = metrics["RTP CI 95%"]
        self.assertGreater(ci, 0.0)
        self.assertLess(ci, 0.5)

    def test_bonus_and_hs_both_contribute(self):
        # 100K spins: both features must fire at least once
        metrics = _build_runner().run(num_spins=100_000, output_csv=None, seed=7)
        self.assertGreater(metrics["Bonus RTP"], 0.0)
        self.assertGreater(metrics["Hold and Spin RTP"], 0.0)

    def test_balance_history_populated(self):
        metrics = _build_runner().run(num_spins=10_000, output_csv=None, seed=3)
        bh = metrics.get("balance_history", [])
        self.assertGreater(len(bh), 0)

    def test_bucket_percentages_sum_to_100(self):
        metrics = _build_runner().run(num_spins=10_000, output_csv=None, seed=5)
        total = sum(v for k, v in metrics.items() if k.startswith("Bucket:"))
        self.assertAlmostEqual(total, 100.0, places=6)


if __name__ == "__main__":
    unittest.main(verbosity=2)
