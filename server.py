"""
FastAPI backend — serves the web UI and exposes the Python simulation engine via HTTP.

Usage:
    pip install fastapi "uvicorn[standard]"
    python server.py

Opens http://localhost:8000 automatically.
API docs at http://localhost:8000/api/docs
"""
import asyncio
import json
import os
import sys
import threading
import webbrowser
from typing import Optional

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from main import build_game


app = FastAPI(title="Slot Simulation API", docs_url="/api/docs")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

SSE_HEADERS = {"X-Accel-Buffering": "no", "Cache-Control": "no-cache"}


class SimulateRequest(BaseModel):
    num_spins: int = 1_000_000
    seed: Optional[int] = None
    workers: int = 1
    wild_weight: float = 4.238


class TuneRequest(BaseModel):
    target_rtp: float = 0.95
    iterations: int = 8
    spins_per_iter: int = 500_000


def _sse(msg: dict) -> str:
    return f"data: {json.dumps(msg)}\n\n"


@app.get("/api/health")
def health():
    return {"status": "ok", "engine": "python"}


@app.post("/api/simulate")
async def simulate(req: SimulateRequest):
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
                "avg_win":         metrics["Avg Win Per Spin"],
                "avg_bonus_win":   metrics["Avg Bonus Win"],
                "avg_hs_win":      metrics["Avg Hold and Spin Win"],
                "buckets":         buckets,
                "balance_history": [],
                "strength_counts": None,
                "avg_upgrades":    None,
                "avg_jackpot":     None,
                "backend":         "python",
            }
            loop.call_soon_threadsafe(future.set_result, result)

        except Exception as exc:
            loop.call_soon_threadsafe(future.set_exception, exc)

    threading.Thread(target=run_thread, daemon=True).start()
    result = await future
    return result


@app.post("/api/tune")
async def tune(req: TuneRequest):
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
