"""
Trading Dashboard API - FastAPI Backend
=======================================

REST API for trading data. Frontend-agnostic - works with:
- Streamlit (current)
- React/Next.js (frontend/)
- Mobile apps (future)

Bucket structure:
    paper-trading-logs/
    ├── fixed/
    │   └── paper_20260101_084724/
    │       ├── analytics.jsonl
    │       ├── events.jsonl
    │       └── ...
    ├── relative/
    └── 1year/

Run:
    uvicorn api:app --host 0.0.0.0 --port 8000

Endpoints:
    # Engine Instances (real-time from health servers)
    GET  /api/instances                                 - List all instances with status
    GET  /api/instances/{instance}/health               - Get instance health
    GET  /api/instances/{instance}/status               - Get full instance status
    GET  /api/instances/{instance}/positions            - Get real-time positions

    # Admin Controls (X-Admin-Token header required)
    POST /api/instances/{instance}/admin/capital        - Set capital
    POST /api/instances/{instance}/admin/mis            - Toggle MIS mode
    POST /api/instances/{instance}/admin/exit           - Exit position
    POST /api/instances/{instance}/admin/exit-all       - Exit all positions
    POST /api/instances/{instance}/admin/pause          - Pause trading (no new entries)
    POST /api/instances/{instance}/admin/resume         - Resume trading

    # Live Trading (LocalDataReader - VM filesystem)
    GET  /api/live/config-types                         - List available config types
    GET  /api/live/summary?config_type=fixed            - Get live trading summary
    GET  /api/live/positions?config_type=fixed          - Get open positions
    GET  /api/live/closed?config_type=fixed             - Get closed positions
    GET  /api/live/events?config_type=fixed             - Get recent events

    # Historical (OCIDataReader - Object Storage)
    GET  /api/config-types                              - List config types (fixed, relative, 1year)
    GET  /api/runs/{config_type}                        - List runs for a config type
    GET  /api/runs/{config_type}/{run_id}               - Get run details
    GET  /api/runs/{config_type}/{run_id}/summary       - Get run summary
    GET  /api/runs/{config_type}/{run_id}/analytics     - Get analytics data
    GET  /api/runs/{config_type}/{run_id}/events        - Get events data
    GET  /api/runs/{config_type}/{run_id}/trades        - Get all trades
    GET  /api/runs/{config_type}/{run_id}/trades/{id}   - Get trade details
    GET  /api/runs/{config_type}/{run_id}/files         - List files in run
    GET  /api/runs/{config_type}/{run_id}/logs/agent    - Get agent log
    GET  /api/runs/{config_type}/{run_id}/logs/trade    - Get trade logs
"""

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Header
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Dict, Optional
from pydantic import BaseModel
import asyncio
import httpx
import os
import json
from datetime import datetime
from pathlib import Path

from oci_reader import OCIDataReader
from local_reader import LocalDataReader


# ============ Instance Registry ============
# Maps instance names to their health server ports
# Can be overridden by instances.json config file

DEFAULT_INSTANCES = {
    "fixed": {"port": 8081, "type": "paper", "description": "Fixed risk paper trading"},
    "relative": {"port": 8082, "type": "paper", "description": "Relative risk paper trading"},
    "1year": {"port": 8083, "type": "paper", "description": "1-year backtest config"},
    "live": {"port": 8090, "type": "live", "description": "Live trading"},
}

def load_instances() -> Dict[str, Dict]:
    """Load instance registry from config file or use defaults."""
    config_path = Path(__file__).parent / "instances.json"
    if config_path.exists():
        try:
            with open(config_path) as f:
                return json.load(f)
        except Exception as e:
            print(f"Warning: Failed to load instances.json: {e}")
    return DEFAULT_INSTANCES

INSTANCES = load_instances()


async def proxy_to_engine(instance: str, path: str, method: str = "GET",
                          body: Optional[dict] = None,
                          admin_token: Optional[str] = None) -> dict:
    """Proxy request to engine health server."""
    if instance not in INSTANCES:
        raise HTTPException(status_code=404, detail=f"Instance '{instance}' not found")

    port = INSTANCES[instance]["port"]
    url = f"http://localhost:{port}{path}"

    headers = {}
    if admin_token:
        headers["X-Admin-Token"] = admin_token

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            if method == "GET":
                response = await client.get(url, headers=headers)
            elif method == "POST":
                response = await client.post(url, json=body or {}, headers=headers)
            else:
                raise HTTPException(status_code=405, detail=f"Method {method} not allowed")

            return response.json()
        except httpx.ConnectError:
            raise HTTPException(status_code=503, detail=f"Engine '{instance}' not reachable on port {port}")
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail=f"Engine '{instance}' request timed out")
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

# Initialize FastAPI
app = FastAPI(
    title="Trading Dashboard API",
    description="API for trading data from OCI Object Storage",
    version="2.0.0"
)

# CORS - allow all origins for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize OCI readers
# paper_reader for paper trading logs (fixed, relative, 1year)
# live_reader for live trading logs
paper_reader = None
live_reader = None

# Fallback capital for old runs without capital in performance.json
# New runs should have capital stored in performance.json
CAPITAL_FALLBACK = {
    "live": 10000,      # Default fallback for live runs
    "fixed": 500000,    # 5L for paper trading
    "relative": None,   # % based, no fixed capital
    "1year": None,      # varies
}

def get_reader(config_type: str = None):
    """
    Get the appropriate OCI reader based on config type.
    - 'live' uses live-trading-logs bucket
    - Others use paper-trading-logs bucket
    """
    global paper_reader, live_reader

    if config_type == "live":
        if live_reader is None:
            live_reader = OCIDataReader(bucket_name='live-trading-logs')
        return live_reader
    else:
        if paper_reader is None:
            paper_reader = OCIDataReader(bucket_name='paper-trading-logs')
        return paper_reader


def get_effective_config_type(config_type: str) -> str:
    """
    Map frontend config type to actual folder name in OCI bucket.
    Currently 1:1 mapping, kept for future flexibility.
    """
    return config_type


def get_capital(config_type: str) -> int | None:
    """Get fallback capital for old runs without capital in performance.json"""
    return CAPITAL_FALLBACK.get(config_type)


# ============ Response Models ============

class RunInfo(BaseModel):
    run_id: str
    config_type: str
    timestamp: str
    total_pnl: float
    total_trades: int
    win_rate: float


# ============ REST Endpoints ============

@app.get("/")
async def root():
    """API health check"""
    return {
        "status": "ok",
        "service": "Trading Dashboard API",
        "version": "2.0.0",
        "timestamp": datetime.now().isoformat()
    }


@app.get("/api/config-types")
async def list_config_types():
    """List all config types (top-level folders like fixed, relative, 1year, live)"""
    try:
        config_types = get_reader().list_config_types()
        # Add live option (reads from live-trading-logs bucket)
        if "live" not in config_types:
            config_types.append("live")
        return {"config_types": config_types}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{config_type}")
async def list_runs(config_type: str, limit: int = 50):
    """List all runs for a config type"""
    try:
        reader = get_reader(config_type)
        effective_type = get_effective_config_type(config_type)
        runs = reader.list_runs(config_type=effective_type, limit=limit)
        return {"config_type": config_type, "runs": runs, "count": len(runs)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{config_type}/aggregate")
async def get_aggregate_summary(config_type: str, date_from: str = None, date_to: str = None):
    """
    Get aggregated summary across all runs for a config type.
    Optionally filter by date range (YYYY-MM-DD format).
    """
    try:
        reader = get_reader(config_type)
        effective_type = get_effective_config_type(config_type)
        runs = reader.list_runs(config_type=effective_type, limit=500)

        # Filter by date range if provided
        if date_from or date_to:
            filtered_runs = []
            for run in runs:
                ts = run.get('timestamp')
                if ts and ts != 'Unknown':
                    try:
                        run_date = ts[:10]  # YYYY-MM-DD
                        if date_from and run_date < date_from:
                            continue
                        if date_to and run_date > date_to:
                            continue
                        filtered_runs.append(run)
                    except:
                        filtered_runs.append(run)
            runs = filtered_runs

        if not runs:
            return {"config_type": config_type, "error": "No runs found", "days": 0}

        # Aggregate all summaries
        total_pnl = 0
        total_trades = 0
        total_winners = 0
        total_losers = 0
        total_fees = 0
        total_return_pct = 0  # Sum of per-run % returns
        runs_with_capital = 0  # Count runs that have capital data
        all_trades = []
        by_setup = {}
        daily_data = []

        # Fallback capital from config type (for old runs without capital in performance.json)
        fallback_capital = get_capital(config_type)

        for run in runs:
            run_id = run['run_id']
            summary = reader.get_run_summary(effective_type, run_id)

            run_pnl = summary.get('total_pnl', 0)
            total_pnl += run_pnl
            total_trades += summary.get('total_trades', 0)
            total_winners += summary.get('winners', 0)
            total_losers += summary.get('losers', 0)
            total_fees += summary.get('total_fees', 0)

            # Get capital for this run (from performance.json, fallback to config map)
            run_capital = summary.get('capital') or fallback_capital

            # Calculate % return for this run
            run_return_pct = None
            if run_capital:
                run_return_pct = run_pnl / run_capital * 100
                total_return_pct += run_return_pct
                runs_with_capital += 1

            # Collect trades
            all_trades.extend(summary.get('trades', []))

            # Aggregate by setup
            for setup, data in summary.get('by_setup', {}).items():
                if setup not in by_setup:
                    by_setup[setup] = {'pnl': 0, 'count': 0, 'wins': 0}
                by_setup[setup]['pnl'] += data.get('pnl', 0)
                by_setup[setup]['count'] += data.get('count', 0)
                by_setup[setup]['wins'] += data.get('wins', 0)

            # Daily data (includes per-run capital and % return)
            daily_data.append({
                'date': run.get('timestamp', 'Unknown'),
                'run_id': run_id,
                'pnl': run_pnl,
                'capital': run_capital,
                'return_pct': run_return_pct,
                'trades': summary.get('total_trades', 0),
                'winners': summary.get('winners', 0),
                'losers': summary.get('losers', 0),
                'win_rate': summary.get('win_rate', 0)
            })

        # Sort daily data by date
        daily_data.sort(key=lambda x: x['date'])

        # Format setup stats
        setup_stats = []
        for setup, data in by_setup.items():
            win_rate = data['wins'] / data['count'] * 100 if data['count'] else 0
            avg_pnl = data['pnl'] / data['count'] if data['count'] else 0
            setup_stats.append({
                'setup': setup,
                'trades': data['count'],
                'pnl': data['pnl'],
                'wins': data['wins'],
                'win_rate': win_rate,
                'avg_pnl': avg_pnl
            })
        setup_stats.sort(key=lambda x: x['pnl'], reverse=True)

        # Get actual date range from data
        actual_date_from = daily_data[0]['date'][:10] if daily_data else None
        actual_date_to = daily_data[-1]['date'][:10] if daily_data else None

        # Calculate cumulative PnL and % returns
        cumulative_pnl = 0
        cumulative_return_pct = 0
        for d in daily_data:
            cumulative_pnl += d['pnl']
            d['cumulative_pnl'] = cumulative_pnl
            if d.get('return_pct') is not None:
                cumulative_return_pct += d['return_pct']
                d['cumulative_return_pct'] = cumulative_return_pct

        gross_pnl = total_pnl
        net_pnl = total_pnl - total_fees

        # % returns are sum of per-run returns (not from fixed capital)
        gross_return_pct = total_return_pct if runs_with_capital > 0 else None
        # Approximate net return by subtracting fees proportionally
        net_return_pct = None
        if gross_return_pct is not None and gross_pnl != 0:
            net_return_pct = gross_return_pct * (net_pnl / gross_pnl) if gross_pnl else gross_return_pct
        avg_daily_return_pct = (total_return_pct / runs_with_capital) if runs_with_capital > 0 else None

        return {
            "config_type": config_type,
            "capital": None,  # Varies per run, see daily_data for per-run capital
            "days": len(runs),
            "gross_pnl": gross_pnl,
            "net_pnl": net_pnl,
            "total_pnl": total_pnl,
            "gross_return_pct": gross_return_pct,
            "net_return_pct": net_return_pct,
            "avg_daily_return_pct": avg_daily_return_pct,
            "total_trades": total_trades,
            "winners": total_winners,
            "losers": total_losers,
            "win_rate": (total_winners / total_trades * 100) if total_trades else 0,
            "total_fees": total_fees,
            "avg_pnl_per_day": net_pnl / len(runs) if runs else 0,
            "avg_pnl_per_trade": net_pnl / total_trades if total_trades else 0,
            "by_setup": setup_stats,
            "daily_data": daily_data,
            "trades": all_trades,
            "date_from": actual_date_from,
            "date_to": actual_date_to
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{config_type}/{run_id}")
async def get_run(config_type: str, run_id: str):
    """Get run metadata and performance"""
    try:
        reader = get_reader(config_type)
        effective_type = get_effective_config_type(config_type)
        performance = reader.get_performance(effective_type, run_id)
        if not performance:
            # Try to get basic info from list
            runs = reader.list_runs(config_type=effective_type, limit=100)
            for run in runs:
                if run['run_id'] == run_id:
                    return run
            raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
        return {
            "run_id": run_id,
            "config_type": config_type,
            "performance": performance
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{config_type}/{run_id}/files")
async def list_run_files(config_type: str, run_id: str):
    """List all files in a run folder"""
    try:
        reader = get_reader(config_type)
        effective_type = get_effective_config_type(config_type)
        files = reader.list_files(effective_type, run_id)
        return {"config_type": config_type, "run_id": run_id, "files": files}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{config_type}/{run_id}/summary")
async def get_run_summary(config_type: str, run_id: str):
    """Get aggregate summary for a run"""
    try:
        reader = get_reader(config_type)
        effective_type = get_effective_config_type(config_type)
        summary = reader.get_run_summary(effective_type, run_id)
        return summary
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{config_type}/{run_id}/analytics")
async def get_analytics(config_type: str, run_id: str):
    """Get analytics data for a run"""
    try:
        reader = get_reader(config_type)
        effective_type = get_effective_config_type(config_type)
        analytics = reader.get_analytics(effective_type, run_id)
        return {"config_type": config_type, "run_id": run_id, "analytics": analytics, "count": len(analytics)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{config_type}/{run_id}/events")
async def get_events(config_type: str, run_id: str):
    """Get all events (DECISION, TRIGGER, EXIT) for a run"""
    try:
        reader = get_reader(config_type)
        effective_type = get_effective_config_type(config_type)
        events = reader.get_events(effective_type, run_id)
        return {"config_type": config_type, "run_id": run_id, "events": events, "count": len(events)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{config_type}/{run_id}/decisions")
async def get_decisions(config_type: str, run_id: str):
    """Get decision events for a run"""
    try:
        reader = get_reader(config_type)
        effective_type = get_effective_config_type(config_type)
        decisions = reader.get_decisions(effective_type, run_id)
        return {"config_type": config_type, "run_id": run_id, "decisions": decisions, "count": len(decisions)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{config_type}/{run_id}/planning")
async def get_planning(config_type: str, run_id: str):
    """Get planning data for a run"""
    try:
        reader = get_reader(config_type)
        effective_type = get_effective_config_type(config_type)
        planning = reader.get_planning(effective_type, run_id)
        return {"config_type": config_type, "run_id": run_id, "planning": planning, "count": len(planning)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{config_type}/{run_id}/ranking")
async def get_ranking(config_type: str, run_id: str):
    """Get ranking data for a run"""
    try:
        reader = get_reader(config_type)
        effective_type = get_effective_config_type(config_type)
        ranking = reader.get_ranking(effective_type, run_id)
        return {"config_type": config_type, "run_id": run_id, "ranking": ranking, "count": len(ranking)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{config_type}/{run_id}/scanning")
async def get_scanning(config_type: str, run_id: str):
    """Get scanning data for a run"""
    try:
        reader = get_reader(config_type)
        effective_type = get_effective_config_type(config_type)
        scanning = reader.get_scanning(effective_type, run_id)
        return {"config_type": config_type, "run_id": run_id, "scanning": scanning, "count": len(scanning)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{config_type}/{run_id}/screening")
async def get_screening(config_type: str, run_id: str):
    """Get screening data for a run"""
    try:
        reader = get_reader(config_type)
        effective_type = get_effective_config_type(config_type)
        screening = reader.get_screening(effective_type, run_id)
        return {"config_type": config_type, "run_id": run_id, "screening": screening, "count": len(screening)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{config_type}/{run_id}/trades")
async def get_trades(config_type: str, run_id: str):
    """Get all trades (final exits) for a run"""
    try:
        reader = get_reader(config_type)
        effective_type = get_effective_config_type(config_type)
        analytics = reader.get_analytics(effective_type, run_id)
        trades = [a for a in analytics if a.get('is_final_exit')]
        return {"config_type": config_type, "run_id": run_id, "trades": trades, "count": len(trades)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{config_type}/{run_id}/trades/{trade_id}")
async def get_trade_details(config_type: str, run_id: str, trade_id: str):
    """Get complete details for a specific trade"""
    try:
        reader = get_reader(config_type)
        effective_type = get_effective_config_type(config_type)
        details = reader.get_trade_details(effective_type, run_id, trade_id)
        if not details.get('decision') and not details.get('exits'):
            raise HTTPException(status_code=404, detail=f"Trade {trade_id} not found")
        return details
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{config_type}/{run_id}/logs/agent")
async def get_agent_log(config_type: str, run_id: str, lines: int = 100):
    """Get agent log content (last N lines)"""
    try:
        reader = get_reader(config_type)
        effective_type = get_effective_config_type(config_type)
        content = reader.get_agent_log(effective_type, run_id)
        if content is None:
            raise HTTPException(status_code=404, detail="agent.log not found")

        # Return last N lines
        all_lines = content.strip().split('\n')
        last_lines = all_lines[-lines:] if lines < len(all_lines) else all_lines

        return {
            "config_type": config_type,
            "run_id": run_id,
            "total_lines": len(all_lines),
            "lines_returned": len(last_lines),
            "content": '\n'.join(last_lines)
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{config_type}/{run_id}/logs/trade")
async def get_trade_log(config_type: str, run_id: str, lines: int = 100):
    """Get trade logs content (last N lines)"""
    try:
        reader = get_reader(config_type)
        effective_type = get_effective_config_type(config_type)
        content = reader.get_trade_logs(effective_type, run_id)
        if content is None:
            raise HTTPException(status_code=404, detail="trade_logs.log not found")

        # Return last N lines
        all_lines = content.strip().split('\n')
        last_lines = all_lines[-lines:] if lines < len(all_lines) else all_lines

        return {
            "config_type": config_type,
            "run_id": run_id,
            "total_lines": len(all_lines),
            "lines_returned": len(last_lines),
            "content": '\n'.join(last_lines)
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{config_type}/{run_id}/analysis/setups")
async def get_setup_analysis(config_type: str, run_id: str):
    """Get setup performance analysis"""
    try:
        reader = get_reader(config_type)
        effective_type = get_effective_config_type(config_type)
        summary = reader.get_run_summary(effective_type, run_id)
        setup_data = summary.get('by_setup', {})

        result = []
        for setup, data in setup_data.items():
            win_rate = data['wins'] / data['count'] * 100 if data['count'] else 0
            avg_pnl = data['pnl'] / data['count'] if data['count'] else 0
            result.append({
                'setup': setup,
                'trades': data['count'],
                'pnl': data['pnl'],
                'wins': data['wins'],
                'win_rate': win_rate,
                'avg_pnl': avg_pnl
            })

        result.sort(key=lambda x: x['pnl'], reverse=True)
        return {"config_type": config_type, "run_id": run_id, "setups": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{config_type}/{run_id}/analysis/regimes")
async def get_regime_analysis(config_type: str, run_id: str):
    """Get regime performance analysis"""
    try:
        reader = get_reader(config_type)
        effective_type = get_effective_config_type(config_type)
        summary = reader.get_run_summary(effective_type, run_id)
        regime_data = summary.get('by_regime', {})

        result = []
        for regime, data in regime_data.items():
            avg_pnl = data['pnl'] / data['count'] if data['count'] else 0
            result.append({
                'regime': regime,
                'trades': data['count'],
                'pnl': data['pnl'],
                'avg_pnl': avg_pnl
            })

        result.sort(key=lambda x: x['pnl'], reverse=True)
        return {"config_type": config_type, "run_id": run_id, "regimes": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ Live Trading Endpoints (Local Reader) ============

# Cache local readers per config type
local_readers: Dict[str, LocalDataReader] = {}

def get_local_reader(config_type: str) -> LocalDataReader:
    """Get or create a LocalDataReader for the given config type."""
    if config_type not in local_readers:
        local_readers[config_type] = LocalDataReader(config_type)
    return local_readers[config_type]


@app.get("/api/live/summary")
async def get_live_summary(config_type: str = "fixed"):
    """Get live trading summary (for VM during market hours)"""
    try:
        reader = get_local_reader(config_type)
        summary = reader.get_live_summary()
        return {"config_type": config_type, **summary}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/live/positions")
async def get_live_positions(config_type: str = "fixed"):
    """Get open positions for live trading"""
    try:
        reader = get_local_reader(config_type)
        today_run = reader.get_today_run()
        if not today_run:
            return {"config_type": config_type, "positions": [], "error": "No active run today"}

        positions = reader.get_open_positions(today_run['run_id'])

        # Get latest ticks for unrealized PnL
        symbols = [p['symbol'] for p in positions]
        ticks = reader.get_latest_ticks(symbols) if symbols else {}
        positions = reader.calculate_unrealized_pnl(positions, ticks)

        return {"config_type": config_type, "run_id": today_run['run_id'], "positions": positions}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/live/closed")
async def get_live_closed(config_type: str = "fixed"):
    """Get closed positions for live trading"""
    try:
        reader = get_local_reader(config_type)
        today_run = reader.get_today_run()
        if not today_run:
            return {"config_type": config_type, "positions": [], "error": "No active run today"}

        positions = reader.get_closed_positions(today_run['run_id'])
        return {"config_type": config_type, "run_id": today_run['run_id'], "positions": positions}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/live/events")
async def get_live_events(config_type: str = "fixed", limit: int = 100):
    """Get recent events for live trading"""
    try:
        reader = get_local_reader(config_type)
        today_run = reader.get_today_run()
        if not today_run:
            return {"config_type": config_type, "events": [], "error": "No active run today"}

        events = reader.get_events(today_run['run_id'])
        # Return most recent events first, limited
        events = sorted(events, key=lambda x: x.get('ts', ''), reverse=True)[:limit]
        return {"config_type": config_type, "run_id": today_run['run_id'], "events": events, "count": len(events)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/live/config-types")
async def get_live_config_types():
    """Get available config types for live trading"""
    return {"config_types": ["fixed", "relative", "1year"]}


# ============ WebSocket for Live Updates ============

class ConnectionManager:
    """Manages WebSocket connections"""
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, key: str):
        await websocket.accept()
        if key not in self.active_connections:
            self.active_connections[key] = []
        self.active_connections[key].append(websocket)

    def disconnect(self, websocket: WebSocket, key: str):
        if key in self.active_connections:
            self.active_connections[key].remove(websocket)


manager = ConnectionManager()


@app.websocket("/api/ws/live/{config_type}/{run_id}")
async def websocket_live(websocket: WebSocket, config_type: str, run_id: str):
    """WebSocket endpoint for live updates (every 10 seconds)"""
    key = f"{config_type}/{run_id}"
    await manager.connect(websocket, key)
    try:
        reader = get_reader(config_type)
        effective_type = get_effective_config_type(config_type)
        while True:
            summary = reader.get_run_summary(effective_type, run_id)

            await websocket.send_json({
                "type": "update",
                "timestamp": datetime.now().isoformat(),
                "config_type": config_type,
                "run_id": run_id,
                "data": summary
            })

            await asyncio.sleep(10)

    except WebSocketDisconnect:
        manager.disconnect(websocket, key)


# ============ Engine Instance Endpoints ============
# Proxy to engine health servers for real-time data and admin controls

class AdminRequest(BaseModel):
    """Base model for admin requests"""
    pass

class CapitalRequest(AdminRequest):
    capital: float

class MISRequest(AdminRequest):
    enabled: bool

class ExitRequest(AdminRequest):
    symbol: str
    qty: Optional[int] = None  # None means full exit

class ExitAllRequest(AdminRequest):
    reason: str = "manual_exit"

class PauseRequest(AdminRequest):
    reason: str = "manual_pause"

class ResumeRequest(AdminRequest):
    pass


@app.get("/api/instances")
async def list_instances():
    """List all configured engine instances with their status"""
    results = []
    for name, config in INSTANCES.items():
        instance_info = {
            "name": name,
            "port": config["port"],
            "type": config["type"],
            "description": config.get("description", ""),
            "status": "unknown"
        }
        # Try to get health status
        try:
            status = await proxy_to_engine(name, "/health")
            instance_info["status"] = status.get("status", "unknown")
            instance_info["state"] = status.get("state", "unknown")
        except HTTPException:
            instance_info["status"] = "offline"

        results.append(instance_info)

    return {"instances": results}


@app.get("/api/instances/{instance}/health")
async def get_instance_health(instance: str):
    """Get health status from engine instance"""
    return await proxy_to_engine(instance, "/health")


@app.get("/api/instances/{instance}/status")
async def get_instance_status(instance: str):
    """Get full status from engine instance"""
    return await proxy_to_engine(instance, "/status")


@app.get("/api/instances/{instance}/positions")
async def get_instance_positions(instance: str):
    """Get open positions from engine instance"""
    return await proxy_to_engine(instance, "/positions")


@app.get("/api/instances/{instance}/funds")
async def get_instance_funds(instance: str):
    """Get broker account funds (Kite DMAT balance)"""
    return await proxy_to_engine(instance, "/funds")


@app.get("/api/instances/{instance}/closed")
async def get_instance_closed_trades(instance: str):
    """Get closed trades for this session"""
    return await proxy_to_engine(instance, "/closed")


# ============ Admin Endpoints (Token Protected) ============
# These proxy to engine admin endpoints with token forwarding
# Requires X-Admin-Token header for authentication

@app.post("/api/instances/{instance}/admin/capital")
async def set_instance_capital(
    instance: str,
    request: CapitalRequest,
    x_admin_token: Optional[str] = Header(None)
):
    """Set capital for an engine instance (requires admin token)"""
    if not x_admin_token:
        raise HTTPException(status_code=401, detail="X-Admin-Token header required")

    return await proxy_to_engine(
        instance, "/admin/capital",
        method="POST",
        body={"capital": request.capital},
        admin_token=x_admin_token
    )


@app.post("/api/instances/{instance}/admin/mis")
async def toggle_instance_mis(
    instance: str,
    request: MISRequest,
    x_admin_token: Optional[str] = Header(None)
):
    """Toggle MIS mode for an engine instance (requires admin token)"""
    if not x_admin_token:
        raise HTTPException(status_code=401, detail="X-Admin-Token header required")

    return await proxy_to_engine(
        instance, "/admin/mis",
        method="POST",
        body={"enabled": request.enabled},
        admin_token=x_admin_token
    )


@app.post("/api/instances/{instance}/admin/exit")
async def exit_instance_position(
    instance: str,
    request: ExitRequest,
    x_admin_token: Optional[str] = Header(None)
):
    """Exit a position on an engine instance (requires admin token)"""
    if not x_admin_token:
        raise HTTPException(status_code=401, detail="X-Admin-Token header required")

    body = {"symbol": request.symbol}
    if request.qty is not None:
        body["qty"] = request.qty

    return await proxy_to_engine(
        instance, "/admin/exit",
        method="POST",
        body=body,
        admin_token=x_admin_token
    )


@app.post("/api/instances/{instance}/admin/exit-all")
async def exit_all_instance_positions(
    instance: str,
    request: ExitAllRequest,
    x_admin_token: Optional[str] = Header(None)
):
    """Exit all positions on an engine instance (requires admin token)"""
    if not x_admin_token:
        raise HTTPException(status_code=401, detail="X-Admin-Token header required")

    return await proxy_to_engine(
        instance, "/admin/exit-all",
        method="POST",
        body={"reason": request.reason},
        admin_token=x_admin_token
    )


@app.post("/api/instances/{instance}/admin/pause")
async def pause_instance_trading(
    instance: str,
    request: PauseRequest,
    x_admin_token: Optional[str] = Header(None)
):
    """
    Pause trading on an engine instance (requires admin token).

    When paused:
    - No new trade entries will be taken
    - Tick processing and bar building continue
    - Existing positions continue to be monitored
    - Use /admin/resume to resume trading
    """
    if not x_admin_token:
        raise HTTPException(status_code=401, detail="X-Admin-Token header required")

    return await proxy_to_engine(
        instance, "/admin/pause",
        method="POST",
        body={"reason": request.reason},
        admin_token=x_admin_token
    )


@app.post("/api/instances/{instance}/admin/resume")
async def resume_instance_trading(
    instance: str,
    request: ResumeRequest = ResumeRequest(),
    x_admin_token: Optional[str] = Header(None)
):
    """
    Resume trading on an engine instance (requires admin token).

    Transitions from PAUSED state back to TRADING.
    New trade entries will be taken again.
    """
    if not x_admin_token:
        raise HTTPException(status_code=401, detail="X-Admin-Token header required")

    return await proxy_to_engine(
        instance, "/admin/resume",
        method="POST",
        body={},
        admin_token=x_admin_token
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
