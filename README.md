<div align="center">

# Slot Game Simulation Engine

**Production-grade Monte Carlo slot math engine — RTP, volatility, and win distribution at millions of spins per second.**

[![Python](https://img.shields.io/badge/Python-3.9%2B-3776ab?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![Tests](https://img.shields.io/badge/Tests-40%20passing-22c55e?style=flat-square&logo=pytest&logoColor=white)](#testing)
[![License](https://img.shields.io/badge/License-MIT-f59e0b?style=flat-square)](#license)
[![Multiprocessing](https://img.shields.io/badge/Multiprocessing-enabled-8b5cf6?style=flat-square)](#parallel-execution)
[![Web UI](https://img.shields.io/badge/Web%20UI-live-06b6d4?style=flat-square)](docs/index.html)

</div>

---

## What This Is

A full-stack slot game math toolkit — Python simulation engine on the backend, interactive browser UI on the frontend. Models the same mechanics used in commercial casino titles: 20-line payline evaluation, free-spins with retrigger, and Dragon Link–style Hold & Spin with a four-tier jackpot system.

Built for math designers who need numbers fast, not stories.

---

## Features

| | |
|---|---|
| **Monte Carlo runner** | 10M+ spins with Welford online variance (numerically stable) |
| **Parallel execution** | `multiprocessing.Pool` — near-linear scaling across cores |
| **Reproducible runs** | Seeded RNG with deterministic per-worker seed derivation |
| **RTP decomposition** | Base / Bonus / Hold & Spin contributions tracked independently |
| **Win evaluation** | Lines (20-payline) and Ways (243) evaluators, wild substitution |
| **Free Spins** | Scatter-triggered, configurable multiplier, retrigger cap |
| **Hold & Spin** | Reel-weight coin probability, 3 lives, Grand jackpot on full screen |
| **RTP Tuner** | Binary search converges wild weight to any target RTP |
| **Web simulator** | In-browser Monte Carlo — no server needed |
| **40 unit tests** | Full coverage of paytable, evaluators, bonus, and H&S logic |

---

## Project Layout

```
slot-simulation-engine/
├── main.py              Entry point + build_game() factory
├── paytable.py          Symbol definitions and payout tables
├── reels.py             Weighted reel strips and grid generation
├── evaluator.py         Win evaluation — LinesEvaluator, WaysEvaluator
├── bonus.py             Free-spins feature with retrigger cap
├── hold_and_spin.py     Hold & Spin — jackpots, reel-accurate respins
├── simulation.py        Monte Carlo runner — stats, CSV export
├── tuner.py             Binary-search wild weight to target RTP
├── visualize.py         Matplotlib charts from results.csv
├── tests.py             40 unit tests
└── docs/
    ├── index.html       Web simulator UI
    ├── balancer.html    Auto-balancer studio
    ├── engine.js        JS port of the math engine
    └── app.js           UI bindings and chart rendering
```

---

## Quick Start

**Prerequisites:** Python 3.9+, no external dependencies for the core engine.

```bash
# Clone
git clone https://github.com/Doublew08/slot-simulation-engine.git
cd slot-simulation-engine

# Optional: charts
pip install matplotlib
```

```bash
# Run 1M spins (default)
python main.py

# Custom spin count + reproducible seed
python main.py 5000000 42

# Parallel — 4 worker processes
python main.py 10000000 42 4

# Tune wild weight to exactly 95% RTP
python tuner.py 0.95

# Visualize the last run
python visualize.py

# Run all tests
python tests.py
```

**Web UI** — open `docs/index.html` in any browser. No server required.

---

## Sample Output

```
Starting: 10,000,000 spins | bet=1.0 | seed=42 | workers=4

--- Simulation Results ---
  Total RTP:                        94.8231%
  Base RTP:                         61.2140%
  Bonus RTP:                        22.5040%
  Hold and Spin RTP:                11.1051%
  Base Hit Rate:                    30.2184%
  Bonus Trigger Frequency (1 in X): 1 in 148.3
  Hold and Spin Frequency (1 in X): 1 in 982.7
  Grand Jackpot Frequency (1 in X): 1 in 187,432.0
  Avg Win Per Spin:                  0.9482
  Avg Bonus Win:                    14.1035
  Avg Hold and Spin Win:           126.7778
  Volatility:                        8.34
  Bucket: 0x (%):                   42.4440%
  Bucket: >0x to 1x (%):           41.0220%
  Bucket: >1x to 5x (%):           13.4060%
  Bucket: >5x to 15x (%):           2.0380%
  Bucket: >15x to 50x (%):          0.9920%
  Bucket: >50x (%):                  0.0980%

Results exported to results.csv
```

---

## Game Configuration

All parameters are centralized in `build_game()` inside `main.py`.

### Paytable

| Symbol | Type | 3x | 4x | 5x |
|--------|------|----|----|-----|
| W | Wild | 0.5× | 2.0× | 10.0× |
| H1 | High | 0.4× | 1.5× | 5.0× |
| H2 | High | 0.3× | 1.0× | 4.0× |
| M1 | Mid | 0.2× | 0.8× | 2.5× |
| M2 | Mid | 0.2× | 0.6× | 2.0× |
| L1 | Low | 0.1× | 0.4× | 1.5× |
| L2 | Low | 0.1× | 0.3× | 1.0× |
| SC | Scatter | 2.0× | 10.0× | 50.0× |
| CO | Coin | — | — | — |

All multipliers are relative to `bet_amount`.

### Reel Weights

| Symbol | Reel 1 | Reel 2 | Reel 3 | Reel 4 | Reel 5 |
|--------|--------|--------|--------|--------|--------|
| W | 4.24 | 6.36 | 4.24 | 8.48 | 4.24 |
| H1 | 4 | 4 | 5 | 4 | 4 |
| H2 | 5 | 5 | 5 | 5 | 6 |
| M1 | 6 | 6 | 6 | 6 | 6 |
| M2 | 7 | 7 | 7 | 7 | 7 |
| L1 | 10 | 10 | 10 | 10 | 10 |
| L2 | 12 | 12 | 12 | 12 | 12 |
| SC | 2 | 3 | 2 | 2 | 3 |
| CO | 3 | 4 | 5 | 4 | 3 |

Higher weight = more frequent. Wild weight is the tuner's control knob.

### Bonus & Hold and Spin

```python
BonusFeature(
    trigger_count=3,        # scatter symbols to trigger
    num_free_spins=10,      # spins awarded
    multiplier=2.0,         # win multiplier during bonus
    max_total_spins=500,    # retrigger safety cap
)

HoldAndSpinFeature(
    trigger_count=6,        # coin symbols on grid to trigger
    coin_values=[1.0, 2.0, 3.0, 5.0, 10.0, 50.0],
    jackpots={"Mini": 10.0, "Minor": 50.0, "Major": 500.0, "Grand": 5000.0},
    initial_respins=3,
    major_probability=0.0001,
)
```

---

## Module Reference

<details>
<summary><strong>reels.py</strong> — Reel and ReelEngine</summary>

- `Reel(symbol_weights)` — builds a weighted symbol pool, sampled via `random.choices`
- `spin_column(num_rows)` — returns a list of symbols for one reel position
- `spin_one()` — single symbol draw; used by Hold & Spin respins so coin probability derives from actual reel weights
- `ReelEngine.spin()` → `grid[row][col]`, row-major 3×5 matrix

</details>

<details>
<summary><strong>evaluator.py</strong> — LinesEvaluator, WaysEvaluator</summary>

- `LinesEvaluator(paytable, paylines)` — evaluates 20 fixed paylines left-to-right; wilds substitute; scatters break lines
- `WaysEvaluator(paytable)` — counts matching positions per reel; ways = product across consecutive reels; requires ≥ 3 reels
- Both expose `evaluate(grid) → (payout, wins)` and `evaluate_scatters(grid) → (count, payout)`
- Wild evaluation picks the higher of: substituted-symbol run vs pure-wild run

</details>

<details>
<summary><strong>bonus.py</strong> — BonusFeature</summary>

- Triggers when scatter count ≥ `trigger_count`
- Retrigger adds `num_free_spins` to remaining count; hard-capped at `max_total_spins`
- Optional `bonus_reel_engine` for dedicated bonus strips
- Returns raw multiplier totals; `simulation.py` scales by `bet_amount`

</details>

<details>
<summary><strong>hold_and_spin.py</strong> — HoldAndSpinFeature</summary>

- **Two-pass `check_trigger`** — counts coin positions first (no RNG consumed); assigns coin values only after trigger threshold is confirmed
- Respins call `reel_engine.reels[col].spin_one()` — coin probability is the live reel weight, not a flat override
- 3 lives reset on each new coin landing
- Full-screen fill adds the Grand jackpot on top of accumulated coin totals (Dragon Link style)
- Mini/Minor from weighted pool; Major via separate 0.01% draw; Grand on full screen only

</details>

<details>
<summary><strong>simulation.py</strong> — SimulationRunner</summary>

- `run(num_spins, seed, workers)` — dispatches serial or parallel execution
- `_run_batch()` — inner spin loop; returns raw accumulator dict
- `_merge_batches()` — parallel Welford merge (Chan et al. 1979) for numerically stable variance across workers
- `_compute_metrics()` — derives all reported metrics; `total_wagered = num_spins × bet` (single multiply, no float accumulation)
- `exclusive_features=True` — skips Hold & Spin on spins where bonus already fired

</details>

<details>
<summary><strong>tuner.py</strong></summary>

- Binary-searches `wild_weight` across 8 iterations × 100K spins
- Verifies the converged weight with a 3M-spin confirmation run
- Imports `build_game` from `main.py` — no code duplication
- Uses `contextlib.redirect_stdout` to suppress inner simulation output

</details>

---

## Parallel Execution

Workers split the spin count evenly, each seeded deterministically:

```
seed=42, workers=4, spins=10M
  Worker 0 → seed 42, 2,500,000 spins
  Worker 1 → seed 43, 2,500,000 spins
  Worker 2 → seed 44, 2,500,000 spins
  Worker 3 → seed 45, 2,500,000 spins
```

Variance across workers is merged using the parallel Welford formula (Chan et al. 1979) — the combined result is mathematically identical to a single-pass run with the same total spins.

The worker function is defined at module level (`_simulation_worker`) for Windows spawn-mode pickling compatibility.

---

## Math Notes

**RTP decomposition** — total RTP = base RTP + bonus RTP + H&S RTP. Each tracks wins independently so contributions can be tuned in isolation.

**Variance / Volatility** — Welford's online algorithm accumulates mean and M2 in a single pass. No catastrophic cancellation at large spin counts. Volatility = `sqrt(M2 / n) / bet`.

**Hold & Spin coin probability** — a reel with `CO: 3` out of 53 total weight gives ≈5.7% coin probability per respin position, not a flat override. This makes H&S RTP mathematically consistent with base game reel math.

**Wild evaluation** — leading wilds extend the first non-wild symbol's run. All-wild lines pay the wild's own table. The evaluator always takes the higher of: (substituted run payout) vs (pure-wild prefix payout).

**Scatter payouts** — scatters pay on total count anywhere in the grid, independent of paylines. Scatter positions break line evaluation for non-wild symbols.

---

## Testing

```bash
python tests.py
```

```
Ran 40 tests in 0.060s — OK
```

Coverage: Paytable lookups · LinesEvaluator (3/4/5-oak, wild substitution, scatter isolation, multi-payline accumulation) · WaysEvaluator (ways product, wild contribution, reel gap break) · BonusFeature (retrigger cap, multiplier, bonus reel override) · HoldAndSpinFeature (trigger threshold, Grand jackpot, respin counter reset, reel-weight coin probability) · ReelEngine grid shape

**Test isolation patterns:**
- `LinesEvaluator` tests use a single middle payline — prevents adjacent-row wins from contaminating assertions
- `WaysEvaluator` tests use a `"NP"` filler symbol not in the paytable — zero-payout filler stops unintended reel bleed

---

## License

MIT — mathematical outputs must be validated against applicable gaming regulations before commercial deployment.
