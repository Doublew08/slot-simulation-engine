# 🎰 Professional Slot Game Simulation Engine

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Build](https://img.shields.io/badge/build-passing-brightgreen)
![Version](https://img.shields.io/badge/version-2.0.0-orange)

A comprehensive, industry-standard Monte Carlo simulation engine and web-based Math Design Suite. Designed to replicate the proprietary auditing tools used by professional mathematicians at tier-1 casino gaming suppliers (e.g., IGT, Aristocrat, Light & Wonder).

This engine rapidly simulates millions of mathematical permutations to converge on theoretical probabilities, ensuring math models hit target payouts, remain profitable for the house, and are engaging for the player.

[**Launch the Live Math Suite**](https://doublew08.github.io/slot-simulation-engine/)

---

## 🌟 Key Features

### Advanced Core Engine Mechanics
*   **243-Ways Evaluation:** Accurate left-to-right calculations with full Wild substitution support.
*   **Cascading / Tumble Reels (Megaways-Style):** Dynamic grid evaluation where winning combinations explode, columns shift down, and new symbols are injected from reel strips. A single spin can theoretically cascade infinitely.
*   **Hold & Spin with Strength Levels:** Independent reel spin mechanics featuring Jackpots (Mini, Minor, Major, Grand). Includes hidden "Strength Levels" (Weak, Normal, Strong, Ultra) that dictate coin drop probabilities.
*   **Symbol Upgrades:** Locked coins in Hold & Spin are not static. Coins have a probability to mathematically level up (e.g., doubling in cash value or upgrading Jackpots).
*   **Networked Progressive Jackpots:** Simulates a persistent global progressive pool. Skims exactly `0.5%` off every bet, allowing the progressive jackpot to scale accurately over millions of spins.
*   **Feature Buy Mode (Bonus Buy):** Simulates bypassing the base game by deducting 100x the bet size and forcefully dropping 6 coins to trigger Hold & Spin, allowing for independent RTP auditing of the bonus buy.

### The Math Studio Web Application
A massively parallel client-side JavaScript architecture wrapped in a premium **Glassmorphism Aesthetic**.

*   **Monte Carlo Dashboard:** Run up to 50,000,000 spins in seconds. Dumps a complete breakdown of Total RTP, Base RTP, Bonus RTP, Hit Rates, Volatility Index, and Win Buckets (Log Scale).
*   **Reel Editor:** Dynamically change the base weight of every single symbol and inject the math straight into the simulator.
*   **Visualizer:** A playable 3x5 visual grid with Auto-Spin, win pulse animations, and a fully functional Web Audio API synthesizer.
*   **Production JSON PAR Sheet Exporter:** 1-click export of the Paytable, Reel Strips, and math configuration into a standard `math_config.json` payload—mirroring how math departments hand off models to front-end developers.

### Machine Learning & Risk Analysis
*   **Genetic Auto-Balancer Studio:** A standalone ML-powered tool. Enter a "Target RTP" (e.g., 96.00%), and a custom Genetic Algorithm will spawn populations of reel weights, simulate spins, cross-breed the most accurate models, and apply mutations to mathematically evolve the perfect reel strips.
*   **Session Risk Simulator:** Models 5,000+ unique human players given a specific Bankroll and Bet Size over a timeframe (e.g., 30 minutes). Outputs precise **Risk of Ruin** metrics and end-balance distribution histograms.

---

## 🧮 Understanding The Math Metrics

*   **RTP (Return to Player):** The theoretical percentage of wagered money paid back over millions of spins. (e.g., 95% RTP means the house retains a 5% edge).
*   **Volatility Index:** A measure of variance. High Volatility = infrequent but massive wins. Low Volatility = frequent but small wins.
*   **Hit Rate:** The percentage of spins that result in any payout greater than zero.
*   **Risk of Ruin:** The statistical probability that a player will hit a bankroll of $0.00 during a given session.

---

## 🛠️ Repository Structure

```text
/
├── main.py                # Original Python-based Monte Carlo Runner
├── simulation.py          # Python Engine Simulator Logic
├── hold_and_spin.py       # Python Feature Mechanics
├── docs/                  # Web App Deployment Directory (GitHub Pages)
│   ├── index.html         # Main Math Studio Dashboard
│   ├── balancer.html      # Genetic Auto-Balancer UI
│   ├── engine.js          # Core JavaScript Monte Carlo Engine
│   ├── app.js             # Web App Logic & Charting
│   ├── balancer.js        # Genetic Algorithm Engine
│   └── styles.css         # Glassmorphism UI Styles
```

---

## 🚀 How to Run Locally

If you wish to run the web application locally instead of using the live GitHub Pages link:

1. Clone the repository:
   ```bash
   git clone https://github.com/Doublew08/slot-simulation-engine.git
   ```
2. Navigate to the `docs/` folder:
   ```bash
   cd slot-simulation-engine/docs
   ```
3. Open `index.html` in any modern web browser. No local web server or dependencies are required.

## 🤝 Contributing
This engine is designed for mathematical analysis and game development purposes. Contributions, feature requests, and math optimizations are always welcome! 

## ⚖️ License
This project is licensed under the MIT License - see the LICENSE file for details. Note: All probability calculations and game mechanics generated by this simulator should be validated according to the gaming regulations in your specific jurisdiction before commercial deployment.
