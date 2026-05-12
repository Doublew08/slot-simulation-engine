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
from main import build_game


app = FastAPI(title="Slot Simulation API", docs_url="/api/docs")

_result_cache: dict = {}
_ip_hits: dict = defaultdict(list)
_RATE_WINDOW = 60  # seconds

def _cache_key(req) -> str:
    raw = f"{req.num_spins}:{req.seed}:{req.wild_weight}"
    return hashlib.md5(raw.encode()).hexdigest()

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


class TuneRequest(BaseModel):
    target_rtp:     Annotated[float, Field(ge=0.50, le=1.0)]          = 0.95
    iterations:     Annotated[int,   Field(ge=1,    le=20)]           = 8
    spins_per_iter: Annotated[int,   Field(ge=10_000, le=1_000_000)] = 500_000


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
            _result_cache[key] = result
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

            low_w, high_w = 0.5, 15.0
            best_w = (low_w + high_w) / 2.0

            for i in range(req.iterations):
                mid_w = (low_w + high_w) / 2.0
                rtp = evaluate_rtp(mid_w, num_spins=req.spins_per_iter)
                loop.call_soon_threadsafe(aq.put_nowait, {
                    "type":      "progress",
                    "iteration": i + 1,
                    "total":     req.iterations,
                    "weight":    round(mid_w, 4),
                    "rtp":       round(rtp, 6),
                    "direction": "up" if rtp < req.target_rtp else "down",
                })
                if rtp < req.target_rtp:
                    low_w = mid_w
                else:
                    high_w = mid_w
                best_w = mid_w

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


# Static frontend — mount last so API routes take priority
app.mount("/", StaticFiles(directory="docs", html=True), name="frontend")


if __name__ == "__main__":
    print("Slot Game Simulation Engine")
    print("  UI:  http://localhost:8000")
    print("  API: http://localhost:8000/api/docs")
    webbrowser.open("http://localhost:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="warning")
