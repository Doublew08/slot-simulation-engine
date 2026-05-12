"""
RTP Tuner — binary-searches the wild weight to hit a target RTP.

Usage:
    python tuner.py [target_rtp]        # default target: 0.95
"""
import io
import sys
import contextlib

from main import build_game


def evaluate_rtp(wild_weight: float, num_spins: int = 100_000) -> float:
    """Run a silent simulation and return Total RTP."""
    runner = build_game(wild_weight)
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        metrics = runner.run(num_spins=num_spins, output_csv="tuner_results.csv", seed=42)
    return metrics["Total RTP"]


def main():
    target_rtp = float(sys.argv[1]) if len(sys.argv) > 1 else 0.95

    low_w, high_w = 0.5, 15.0
    best_w = (low_w + high_w) / 2.0

    print(f"Target RTP: {target_rtp:.4%}")
    print("Phase 1 — binary search (8 iterations × 100 K spins each)")

    for i in range(8):
        mid_w = (low_w + high_w) / 2.0
        rtp = evaluate_rtp(mid_w, num_spins=100_000)
        direction = "↑" if rtp < target_rtp else "↓"
        print(f"  [{i+1}/8] W={mid_w:.4f}  RTP={rtp:.4%}  {direction}")
        if rtp < target_rtp:
            low_w = mid_w
        else:
            high_w = mid_w
        best_w = mid_w

    print(f"\nPhase 2 — verification (3 M spins, seed=0)")
    final_rtp = evaluate_rtp(best_w, num_spins=3_000_000)
    print(f"  W={best_w:.4f}  RTP={final_rtp:.4%}")

    print(f"\nTUNING COMPLETE")
    print(f"  Optimal wild weight : {best_w:.4f}")
    print(f"  Verified RTP        : {final_rtp:.4%}")
    print(f"  Target RTP          : {target_rtp:.4%}")
    print(f"  Delta               : {abs(final_rtp - target_rtp):.4%}")


if __name__ == "__main__":
    main()
