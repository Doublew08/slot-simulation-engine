"""
FastAPI backend — serves the web UI and exposes the Python simulation engine via HTTP.

Usage:
    pip install fastapi "uvicorn[standard]"
    python server.py

Opens http://localhost:8000 automatically.
API docs at http://localhost:8000/api/docs
"""
import asyncio
import hashlib
import json
import os
import sys
import threading
import time
import webbrowser
from collections import defaultdict
from typing import Annotated, Optional

from pydantic import Field

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from main import build_game, PAYLINES

try:
    import cma as _cma_lib
    CMA_AVAILABLE = True
except ImportError:
    CMA_AVAILABLE = False


app = FastAPI(title="Slot Simulation API", docs_url="/api/docs")

_result_cache: dict = {}
_ip_hits: dict = defaultdict(list)
_RATE_WINDOW = 60  # seconds
_CACHE_MAX   = 100

def _cache_key(req) -> str:
    raw = f"{req.num_spins}:{req.seed}:{req.wild_weight}"
    return hashlib.md5(raw.encode()).hexdigest()

def _cache_set(key: str, value: dict) -> None:
    if len(_result_cache) >= _CACHE_MAX:
        _result_cache.pop(next(iter(_result_cache)))  # FIFO eviction
    _result_cache[key] = value

def _check_rate(ip: str, bucket: str, max_req: int) -> None:
    key = f"{ip}:{bucket}"
    now = time.time()
    hits = [t for t in _ip_hits[key] if now - t < _RATE_WINDOW]
    if len(hits) >= max_req:
        raise HTTPException(status_code=429, detail=f"Rate limit: max {max_req} requests per minute.")
    hits.append(now)
    _ip_hits[key] = hits

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://doublew08.github.io",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:3000",
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

SSE_HEADERS = {"X-Accel-Buffering": "no", "Cache-Control": "no-cache"}


class SimulateRequest(BaseModel):
    num_spins:   Annotated[int,   Field(ge=1, le=10_000_000)] = 1_000_000
    seed:        Optional[int]  = None
    workers:     int            = 1
    wild_weight: Annotated[float, Field(gt=0, le=50.0)]      = 4.238


def _build_with_weights(weights: dict):
    """Build a SimulationRunner from an arbitrary 9-symbol weight dict."""
    from paytable import Paytable, Symbol
    from reels import Reel, ReelEngine
    from evaluator import LinesEvaluator
    from bonus import BonusFeature
    from hold_and_spin import HoldAndSpinFeature
    from simulation import SimulationRunner

    ww = float(weights.get("W", 4.238))
    syms = [
        Symbol("W",  {3: 0.5, 4: 2.0, 5: 10.0}, is_wild=True),
        Symbol("H1", {3: 0.4, 4: 1.5, 5:  5.0}),
        Symbol("H2", {3: 0.3, 4: 1.0, 5:  4.0}),
        Symbol("M1", {3: 0.2, 4: 0.8, 5:  2.5}),
        Symbol("M2", {3: 0.2, 4: 0.6, 5:  2.0}),
        Symbol("L1", {3: 0.1, 4: 0.4, 5:  1.5}),
        Symbol("L2", {3: 0.1, 4: 0.3, 5:  1.0}),
        Symbol("SC", {3: 2.0, 4: 10.0, 5: 50.0}, is_scatter=True),
        Symbol("CO", {}, is_coin=True),
    ]
    paytable = Paytable(syms)
    reels = [
        Reel(weights),
        Reel({**weights, "W": ww * 1.5, "SC": 3, "CO": 4}),
        Reel({**weights, "H1": 5,        "SC": 2, "CO": 5}),
        Reel({**weights, "W": ww * 2.0, "SC": 2, "CO": 4}),
        Reel({**weights, "H2": 6,        "SC": 3, "CO": 3}),
    ]
    reel_engine = ReelEngine(reels, num_rows=3)
    evaluator   = LinesEvaluator(paytable, PAYLINES)
    bonus       = BonusFeature(trigger_count=3, num_free_spins=10, multiplier=2.0, max_total_spins=500)
    hs          = HoldAndSpinFeature(
        trigger_count=6, coin_name="CO",
        coin_values=[1.0, 2.0, 3.0, 5.0, 10.0, 50.0],
        reel_engine=reel_engine,
        jackpots={"Mini": 10.0, "Minor": 50.0, "Major": 500.0, "Grand": 5000.0},
    )
    return SimulationRunner(reel_engine=reel_engine, evaluator=evaluator,
                            bet_amount=1.0, bonus_feature=bonus,
                            hold_and_spin_feature=hs, exclusive_features=False)


class TuneRequest(BaseModel):
    target_rtp:     Annotated[float, Field(ge=0.50, le=1.0)]          = 0.95
    iterations:     Annotated[int,   Field(ge=1,    le=20)]           = 8
    spins_per_iter: Annotated[int,   Field(ge=10_000, le=1_000_000)] = 500_000


class BalanceRequest(BaseModel):
    target_rtp:     Annotated[float, Field(ge=0.50, le=1.0)]      = 0.95
    max_evals:      Annotated[int,   Field(ge=10, le=500)]         = 150
    spins_per_eval: Annotated[int,   Field(ge=50_000, le=500_000)] = 100_000


def _sse(msg: dict) -> str:
    return f"data: {json.dumps(msg)}\n\n"


@app.get("/api/health")
def health():
    return {"status": "ok", "engine": "python"}


@app.post("/api/simulate")
async def simulate(req: SimulateRequest, request: Request):
    _check_rate(request.client.host, "sim", 10)
    key = _cache_key(req)
    if key in _result_cache:
        return _result_cache[key]

    loop = asyncio.get_event_loop()
    future: asyncio.Future = loop.create_future()

    def run_thread():
        try:
            runner = build_game(req.wild_weight)
            metrics = runner.run(
                num_spins=req.num_spins,
                output_csv=None,
                seed=req.seed,
                workers=1,  # multiprocessing unreliable on Render containers
            )

            buckets = {}
            for k, v in metrics.items():
                if k.startswith("Bucket: "):
                    label = k[len("Bucket: "):-len(" (%)")]
                    buckets[label] = round(v, 4)

            result = {
                "num_spins":       int(metrics["Total Spins"]),
                "total_rtp":       metrics["Total RTP"],
                "base_rtp":        metrics["Base RTP"],
                "bonus_rtp":       metrics["Bonus RTP"],
                "hs_rtp":          metrics["Hold and Spin RTP"],
                "hit_rate":        metrics["Base Hit Rate"],
                "bonus_freq":      metrics["Bonus Trigger Frequency (1 in X)"],
                "hs_freq":         metrics["Hold and Spin Frequency (1 in X)"],
                "grand_freq":      metrics["Grand Jackpot Frequency (1 in X)"],
                "volatility":      metrics["Volatility"],
                "rtp_ci_95":       metrics.get("RTP CI 95%", 0.0),
                "avg_win":         metrics["Avg Win Per Spin"],
                "avg_bonus_win":   metrics["Avg Bonus Win"],
                "avg_hs_win":      metrics["Avg Hold and Spin Win"],
                "buckets":         buckets,
                "balance_history": metrics.get("balance_history", []),
                "strength_counts": None,
                "avg_upgrades":    None,
                "avg_jackpot":     None,
                "backend":         "python",
            }
            _cache_set(key, result)
            loop.call_soon_threadsafe(future.set_result, result)

        except Exception as exc:
            loop.call_soon_threadsafe(future.set_exception, exc)

    threading.Thread(target=run_thread, daemon=True).start()
    result = await future
    return result


@app.post("/api/tune")
async def tune(req: TuneRequest, request: Request):
    _check_rate(request.client.host, "tune", 3)
    loop = asyncio.get_event_loop()
    aq: asyncio.Queue = asyncio.Queue()

    def run_thread():
        try:
            from tuner import evaluate_rtp
            import math as _math

            # Robbins-Monro: x_{k+1} = x_k − (C/k^α)(rtp − target)
            C = 3.0; ALPHA = 0.6
            x = 4.0; x_history = []; best_w = x; best_fitness = float("inf")

            for i in range(req.iterations):
                k   = i + 1
                rtp = evaluate_rtp(x, num_spins=req.spins_per_iter)
                err = rtp - req.target_rtp
                fitness = abs(err)
                x_history.append(x)
                if fitness < best_fitness:
                    best_fitness = fitness; best_w = x
                win   = x_history[-5:]
                x_avg = sum(win) / len(win)

                loop.call_soon_threadsafe(aq.put_nowait, {
                    "type":        "progress",
                    "iteration":   k,
                    "total":       req.iterations,
                    "weight":      round(x, 4),
                    "weight_avg":  round(x_avg, 4),
                    "rtp":         round(rtp, 6),
                    "direction":   "up" if err < 0 else "down",
                })

                if fitness < 0.001:
                    break

                step = C / _math.pow(k, ALPHA)
                x = max(0.3, min(20.0, x - step * err))

            win   = x_history[-5:]
            best_w = sum(win) / len(win)

            loop.call_soon_threadsafe(aq.put_nowait, {"type": "verifying", "weight": round(best_w, 4)})
            final_rtp = evaluate_rtp(best_w, num_spins=3_000_000)
            loop.call_soon_threadsafe(aq.put_nowait, {
                "type":   "done",
                "weight": round(best_w, 4),
                "rtp":    round(final_rtp, 6),
                "target": req.target_rtp,
                "delta":  round(abs(final_rtp - req.target_rtp), 6),
            })

        except Exception as exc:
            loop.call_soon_threadsafe(aq.put_nowait, {"type": "error", "message": str(exc)})

    threading.Thread(target=run_thread, daemon=True).start()

    async def stream():
        while True:
            try:
                msg = await asyncio.wait_for(aq.get(), timeout=20)
            except asyncio.TimeoutError:
                yield ": keep-alive\n\n"
                continue
            yield _sse(msg)
            if msg["type"] in ("done", "error"):
                break

    return StreamingResponse(stream(), media_type="text/event-stream", headers=SSE_HEADERS)


@app.post("/api/balance")
async def balance(req: BalanceRequest, request: Request):
    if not CMA_AVAILABLE:
        raise HTTPException(status_code=501, detail="cma not installed — pip install cma")
    _check_rate(request.client.host, "balance", 2)
    loop = asyncio.get_event_loop()
    aq: asyncio.Queue = asyncio.Queue()

    def run_thread():
        try:
            import cma
            import math as _math

            _SYMS = ["W", "H1", "H2", "M1", "M2", "L1", "L2", "SC", "CO"]
            _DEF  = {"W": 4.238, "H1": 4.0, "H2": 5.0, "M1": 6.0,
                     "M2": 7.0,  "L1": 10.0, "L2": 12.0, "SC": 2.0, "CO": 3.0}

            x0     = [_math.log(_DEF[s]) for s in _SYMS]
            opts   = {"popsize": 6, "verbose": -9, "maxfevals": req.max_evals}
            es     = cma.CMAEvolutionStrategy(x0, 0.3, opts)

            eval_count = 0
            best_fitness = float("inf")
            best_rtp  = None
            best_w    = None

            while not es.stop() and eval_count < req.max_evals:
                solutions = es.ask()
                fitnesses = []
                for x in solutions:
                    if eval_count >= req.max_evals:
                        fitnesses.append(1e9)
                        continue
                    weights = {s: _math.exp(x[i]) for i, s in enumerate(_SYMS)}
                    # Average 2 runs to reduce jackpot-driven variance
                    _rtps = []
                    for _ in range(2):
                        runner  = _build_with_weights(weights)
                        metrics = runner.run(num_spins=req.spins_per_eval, output_csv=None,
                                            seed=None, workers=1)
                        _rtps.append(metrics["Total RTP"])
                    rtp     = sum(_rtps) / len(_rtps)
                    fitness = abs(rtp - req.target_rtp)
                    fitnesses.append(fitness)
                    eval_count += 1

                    if fitness < best_fitness:
                        best_fitness = fitness
                        best_rtp     = rtp
                        best_w       = {k: round(v, 4) for k, v in weights.items()}

                    loop.call_soon_threadsafe(aq.put_nowait, {
                        "type":    "progress",
                        "eval":    eval_count,
                        "total":   req.max_evals,
                        "rtp":     round(rtp, 6),
                        "fitness": round(fitness, 6),
                        "best_rtp": round(best_rtp, 6) if best_rtp is not None else None,
                        "weights": {k: round(v, 4) for k, v in weights.items()},
                    })

                es.tell(solutions, fitnesses)

            loop.call_soon_threadsafe(aq.put_nowait, {
                "type":    "done",
                "weights": best_w or {},
                "rtp":     round(best_rtp, 6) if best_rtp is not None else 0.0,
                "evals":   eval_count,
                "target":  req.target_rtp,
                "delta":   round(best_fitness, 6),
            })

        except Exception as exc:
            loop.call_soon_threadsafe(aq.put_nowait, {"type": "error", "message": str(exc)})

    threading.Thread(target=run_thread, daemon=True).start()

    async def stream():
        while True:
            try:
                msg = await asyncio.wait_for(aq.get(), timeout=30)
            except asyncio.TimeoutError:
                yield ": keep-alive\n\n"
                continue
            yield _sse(msg)
            if msg["type"] in ("done", "error"):
                break

    return StreamingResponse(stream(), media_type="text/event-stream", headers=SSE_HEADERS)


# Static frontend — mount last so API routes take priority
app.mount("/", StaticFiles(directory="docs", html=True), name="frontend")


if __name__ == "__main__":
    print("Slot Game Simulation Engine")
    print("  UI:  http://localhost:8000")
    print("  API: http://localhost:8000/api/docs")
    webbrowser.open("http://localhost:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="warning")
