# Slot Game Simulation Engine

A Monte Carlo simulation engine for slot game math design. Models a full 5×3 reel game with Lines or Ways evaluation, free-spins bonus, and Hold & Spin — the same features used in commercial titles.

Designed to compute theoretical RTP, volatility, hit rates, and win distributions with statistical accuracy across millions of spins.

---

## Architecture

```
main.py            Entry point + build_game() factory
paytable.py        Symbol definitions and payout lookups
reels.py           Weighted reel strips and grid generation
evaluator.py       Win evaluation — Lines (20-payline) and Ways (243)
bonus.py           Free-spins feature with retrigger cap
hold_and_spin.py   Hold & Spin with jackpots and reel-accurate respins
simulation.py      Monte Carlo runner — stats, RTP, volatility, CSV export
tuner.py           Binary-search wild weight to hit a target RTP
visualize.py       Matplotlib charts from results.csv
tests.py           40 unit tests (run: python tests.py)
```

---

## Quick Start

```bash
# Default: 1,000,000 spins
python main.py

# Custom spins + reproducible seed
python main.py 5000000 42

# Tune wild weight to hit 95% RTP
python tuner.py 0.95

# Visualize last run
python visualize.py
```

---

## Output

```
--- Simulation Results ---
  Total RTP: 94.8231%
  Base RTP: 61.2140%
  Bonus RTP: 22.5040%
  Hold and Spin RTP: 11.1051%
  Base Hit Rate: 30.2184%
  Bonus Trigger Frequency (1 in X): 1 in 148.3
  Hold and Spin Frequency (1 in X): 1 in 982.7
  Grand Jackpot Frequency (1 in X): 1 in 187,432.0
  Avg Win Per Spin: 0.9482
  Volatility: 8.34
```

Results export to `results.csv` automatically.

---

## Game Configuration (`main.py`)

All game parameters live in `build_game()`:

```python
# Symbol paytable
Symbol(name="H1", payouts={3: 0.4, 4: 1.5, 5: 5.0})

# Reel weights per column (higher weight = more frequent)
base_weights = {"W": 4.238, "H1": 4, "H2": 5, ..., "CO": 3}

# Free-spins bonus
BonusFeature(trigger_count=3, num_free_spins=10, multiplier=2.0, max_total_spins=500)

# Hold & Spin
HoldAndSpinFeature(
    trigger_count=6,
    coin_values=[1.0, 2.0, 3.0, 5.0, 10.0, 50.0],
    jackpots={"Mini": 10.0, "Minor": 50.0, "Major": 500.0, "Grand": 5000.0}
)
```

---

## Module Details

### `reels.py` — `Reel`, `ReelEngine`

- `Reel(symbol_weights)` — weighted symbol pool, spun via `random.choices`
- `spin_one()` — single-position spin used by Hold & Spin respins
- `ReelEngine.spin()` → `grid[row][col]` (row-major, 3×5)

### `evaluator.py` — `LinesEvaluator`, `WaysEvaluator`

- `LinesEvaluator(paytable, paylines)` — evaluates 20 fixed paylines left-to-right with wild substitution; scatters break lines
- `WaysEvaluator(paytable)` — computes all left-to-right symbol combinations; ways = product of matching positions per reel
- Both expose `evaluate(grid)` → `(payout, wins)` and `evaluate_scatters(grid)` → `(count, payout)`

### `bonus.py` — `BonusFeature`

- Triggers on `scatter_count >= trigger_count`
- Supports separate `bonus_reel_engine` for bonus-round strips
- `max_total_spins` cap prevents infinite retrigger loops
- Returns raw payout multipliers; `simulation.py` scales by `bet_amount`

### `hold_and_spin.py` — `HoldAndSpinFeature`

- Respins use `reel_engine.reels[col].spin_one()` — coin probability derives from actual reel weights, not a separate flat parameter
- 3 lives (respins); resets on each new coin
- Full-screen fill → Grand jackpot added on top of coin totals
- Mini/Minor jackpots via weighted pool; Major via rare 0.01% draw

### `simulation.py` — `SimulationRunner`

- Welford's online algorithm for variance (numerically stable at 10M+ spins)
- All feature payouts scaled by `bet_amount` before accumulation
- `seed` parameter for reproducible runs
- Tracks: total/base/bonus/H&S RTP, hit rates, trigger frequencies, average wins, volatility, win buckets

### `tuner.py`

- Binary-searches `wild_weight` in 8 iterations × 100K spins
- Verifies converged weight with a 3M-spin run
- Uses `contextlib.redirect_stdout` (no `builtins.print` monkey-patching)
- Imports `build_game` from `main.py` — zero code duplication

---

## Running Tests

```bash
python tests.py
```

40 tests covering: Paytable lookups, LinesEvaluator (3-oak, 4-oak, 5-oak, wild substitution, scatter isolation, multi-payline accumulation), WaysEvaluator (ways product, wild contribution, gap breaking), BonusFeature (retrigger cap, multiplier scaling, bonus reel override), HoldAndSpinFeature (trigger threshold, grand jackpot, respin counter, reel-weight coin probability), and ReelEngine grid shape.

Key design choice: `LinesEvaluator` tests use a single middle payline, and `WaysEvaluator` tests use a filler symbol not present in the paytable — both prevent accidental wins on adjacent rows/reels from polluting assertions.

---

## Math Notes

**RTP decomposition** — total RTP = base RTP + bonus RTP + H&S RTP. Each tracks wins and wagered amounts independently so contributions can be tuned separately.

**Volatility** — standard deviation of win-per-spin divided by bet size. Higher = less frequent but larger wins.

**Hold & Spin math** — respins pull from the actual reel strip distribution. A reel with `CO: 3` out of 53 total weight gives ~5.7% coin probability during respins, not a flat override. This keeps H&S RTP mathematically consistent with the base game.

**Wild evaluation** — wilds substitute left-to-right. A leading wild extends the first non-wild symbol's run. An all-wild line pays the wild symbol's own table. The evaluator also checks if a leading-wild-only run pays better than the substituted symbol run and takes the higher of the two.

**Scatter payouts** — scatters pay on total bet (any position); line evaluations skip scatter positions rather than treating them as blanks.

---

## License

MIT. Mathematical outputs should be validated against gaming regulations in your jurisdiction before commercial use.
