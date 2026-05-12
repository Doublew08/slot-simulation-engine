"""
RTP Tuner — Robbins-Monro stochastic approximation to find wild_weight that
achieves a target RTP.  Polyak-Ruppert averaging of last 5 iterates reduces
variance without adding spin budget.

Usage:
    python tuner.py [target_rtp]        # default target: 0.95
"""
import io
import sys
import contextlib

from main import build_game


def evaluate_rtp(wild_weight: float, num_spins: int = 500_000) -> float:
    """Run a silent simulation and return Total RTP (random seed for unbiased RM estimates)."""
    runner = build_game(wild_weight)
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        metrics = runner.run(num_spins=num_spins, output_csv=None, seed=None)
    return metrics["Total RTP"]


def main():
    target_rtp = float(sys.argv[1]) if len(sys.argv) > 1 else 0.95

    # Robbins-Monro: x_{k+1} = x_k − (C / k^α) × (rtp(x_k) − target)
    # C tuned for ~1-2% RTP sensitivity per wild_weight unit.
    # α=0.6 balances convergence speed vs noise robustness.
    C        = 3.0
    ALPHA    = 0.6
    MAX_ITER = 20
    SPINS    = 500_000

    print(f"Target RTP: {target_rtp:.4%}")
    print(f"Robbins-Monro ({MAX_ITER} iterations × {SPINS:,} spins, Polyak-Ruppert averaging)")

    x          = 4.0   # sensible starting wild_weight
    x_history  = []
    best_x     = x
    best_fitness = float("inf")

    for k in range(1, MAX_ITER + 1):
        rtp     = evaluate_rtp(x, num_spins=SPINS)
        error   = rtp - target_rtp
        fitness = abs(error)
        x_history.append(x)

        if fitness < best_fitness:
            best_fitness = fitness
            best_x       = x

        win   = x_history[-5:]
        x_avg = sum(win) / len(win)

        direction = "↑" if error < 0 else "↓"
        print(f"  [{k:>2}/{MAX_ITER}] W={x:.4f}  RTP={rtp:.4%}  err={error:+.4%}  avg={x_avg:.4f}  {direction}")

        if fitness < 0.001:
            print("  Converged (error < 0.1%)")
            break

        step = C / (k ** ALPHA)
        x = max(0.3, min(20.0, x - step * error))

    # Final estimate: Polyak-Ruppert average of last 5 iterates
    win     = x_history[-5:]
    x_final = sum(win) / len(win)

    print(f"\nPhase 2 — verification (3 M spins, random seed)")
    final_rtp = evaluate_rtp(x_final, num_spins=3_000_000)
    print(f"  W={x_final:.4f}  RTP={final_rtp:.4%}")

    print(f"\nTUNING COMPLETE")
    print(f"  Optimal wild weight : {x_final:.4f}")
    print(f"  Verified RTP        : {final_rtp:.4%}")
    print(f"  Target RTP          : {target_rtp:.4%}")
    print(f"  Delta               : {abs(final_rtp - target_rtp):.4%}")


if __name__ == "__main__":
    main()
