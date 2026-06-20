# 🎰 Slot‑Simulation‑Engine

High‑performance, browser‑based Monte‑Carlo slot‑machine math engine with a **Rust‑inspired** JavaScript core, a **FastAPI** backend, and a **Robbins‑Monro** auto‑balancer for RTP tuning.

[![Build Status](https://github.com/Doublew08/slot-simulation-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/Doublew08/slot-simulation-engine/actions)
[![Coverage Status](https://coveralls.io/repos/github/Doublew08/slot-simulation-engine/badge.svg?branch=main)](https://coveralls.io/github/Doublew08/slot-simulation-engine?branch=main)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## ✨ Quick Start

```bash
# Clone & install Python deps
git clone https://github.com/Doublew08/slot-simulation-engine.git
cd "Slot Game Simulation Engine"
python -m venv .venv && .venv\Scripts\activate   # Windows
pip install -r requirements.txt

# Run the web UI (via FastAPI)
uvicorn server:app --reload
# Open http://localhost:8000 in your browser
```

## 📚 Features

| Feature | Description |
|---|---|
| **High‑Fidelity Math Engine** | Exact Volatility Index tracking via **Welford's Online Algorithm**, exhaustive Hit Frequency counting, and 95% Confidence Intervals for millions of Monte Carlo iterations. |
| **Casino‑Grade RNGs** | Hardened **Xoshiro128++** PRNG for ultra-fast, deterministic Monte Carlo in JS. True **CSPRNG (`secrets`)** in the Python backend for cryptographically secure spins. |
| **Monte‑Carlo Scalability** | 100 k+ spins/s inside Web Workers (browser), fully supporting cascades, hold‑and‑spin, and progressive jackpots. |
| **Tuner / Balancer** | Robbins‑Monro stochastic approximation that adjusts a **global pay‑scale** to hit any target RTP programmatically. |
| **Dual Test Suites** | 46 Python unit tests (reels, paytables, line evaluation) + isolated Node.js test suite for frontend exactness and PRNG determinism. |
| **CI / Lint / Coverage** | GitHub Actions runs `pytest`, `eslint`, and uploads coverage to Coveralls. |
| **Responsive UI** | Glass‑morphism design, dynamic charts via Chart.js, dark‑mode ready. |

## 🤝 Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b my‑feature`)
3. Run the test suite (`pytest -q`) – all must pass
4. Open a Pull Request – CI will automatically run tests, lint, and coverage checks

See `CONTRIBUTING.md` for full guidelines.

## 📜 License

MIT – feel free to use, modify, and distribute.
