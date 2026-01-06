"""
Trading Dashboard API - FastAPI Backend
=======================================

REST API for trading data. Frontend-agnostic - works with:
- Streamlit (current)
- React/Next.js (future)
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
    GET  /api/config-types                              - List config types (fixed, relative, 1year)
    GET  /api/runs/{config_type}                        - List runs for a config type
    GET  /api/runs/{config_type}/{run_id}               - Get run details
    GET  /api/runs/{config_type}/{run_id}/summary       - Get run summary
    GET  /api/runs/{config_type}/{run_id}/analytics     - Get analytics data
    GET  /api/runs/{config_type}/{run_id}/events        - Get events data
    GET  /api/runs/{config_type}/{run_id}/trades/{id}   - Get trade details
    GET  /api/runs/{config_type}/{run_id}/files         - List files in run
    GET  /api/runs/{config_type}/{run_id}/logs/agent    - Get agent log
    GET  /api/runs/{config_type}/{run_id}/logs/trade    - Get trade logs
"""

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Dict, Optional
from pydantic import BaseModel
import asyncio
from datetime import datetime

from oci_reader import OCIDataReader

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

# Initialize OCI reader
reader = None

def get_reader():
    global reader
    if reader is None:
        reader = OCIDataReader()
    return reader


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
    """List all config types (top-level folders like fixed, relative, 1year)"""
    try:
        config_types = get_reader().list_config_types()
        return {"config_types": config_types}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{config_type}")
async def list_runs(config_type: str, limit: int = 50):
    """List all runs for a config type"""
    try:
        runs = get_reader().list_runs(config_type=config_type, limit=limit)
        return {"config_type": config_type, "runs": runs, "count": len(runs)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{config_type}/{run_id}")
async def get_run(config_type: str, run_id: str):
    """Get run metadata and performance"""
    try:
        performance = get_reader().get_performance(config_type, run_id)
        if not performance:
            # Try to get basic info from list
            runs = get_reader().list_runs(config_type=config_type, limit=100)
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
        files = get_reader().list_files(config_type, run_id)
        return {"config_type": config_type, "run_id": run_id, "files": files}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{config_type}/{run_id}/summary")
async def get_run_summary(config_type: str, run_id: str):
    """Get aggregate summary for a run"""
    try:
        summary = get_reader().get_run_summary(config_type, run_id)
        return summary
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{config_type}/{run_id}/analytics")
async def get_analytics(config_type: str, run_id: str):
    """Get analytics data for a run"""
    try:
        analytics = get_reader().get_analytics(config_type, run_id)
        return {"config_type": config_type, "run_id": run_id, "analytics": analytics, "count": len(analytics)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{config_type}/{run_id}/events")
async def get_events(config_type: str, run_id: str):
    """Get all events (DECISION, TRIGGER, EXIT) for a run"""
    try:
        events = get_reader().get_events(config_type, run_id)
        return {"config_type": config_type, "run_id": run_id, "events": events, "count": len(events)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{config_type}/{run_id}/decisions")
async def get_decisions(config_type: str, run_id: str):
    """Get decision events for a run"""
    try:
        decisions = get_reader().get_decisions(config_type, run_id)
        return {"config_type": config_type, "run_id": run_id, "decisions": decisions, "count": len(decisions)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{config_type}/{run_id}/planning")
async def get_planning(config_type: str, run_id: str):
    """Get planning data for a run"""
    try:
        planning = get_reader().get_planning(config_type, run_id)
        return {"config_type": config_type, "run_id": run_id, "planning": planning, "count": len(planning)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{config_type}/{run_id}/ranking")
async def get_ranking(config_type: str, run_id: str):
    """Get ranking data for a run"""
    try:
        ranking = get_reader().get_ranking(config_type, run_id)
        return {"config_type": config_type, "run_id": run_id, "ranking": ranking, "count": len(ranking)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{config_type}/{run_id}/scanning")
async def get_scanning(config_type: str, run_id: str):
    """Get scanning data for a run"""
    try:
        scanning = get_reader().get_scanning(config_type, run_id)
        return {"config_type": config_type, "run_id": run_id, "scanning": scanning, "count": len(scanning)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{config_type}/{run_id}/screening")
async def get_screening(config_type: str, run_id: str):
    """Get screening data for a run"""
    try:
        screening = get_reader().get_screening(config_type, run_id)
        return {"config_type": config_type, "run_id": run_id, "screening": screening, "count": len(screening)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{config_type}/{run_id}/trades")
async def get_trades(config_type: str, run_id: str):
    """Get all trades (final exits) for a run"""
    try:
        analytics = get_reader().get_analytics(config_type, run_id)
        trades = [a for a in analytics if a.get('is_final_exit')]
        return {"config_type": config_type, "run_id": run_id, "trades": trades, "count": len(trades)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{config_type}/{run_id}/trades/{trade_id}")
async def get_trade_details(config_type: str, run_id: str, trade_id: str):
    """Get complete details for a specific trade"""
    try:
        details = get_reader().get_trade_details(config_type, run_id, trade_id)
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
        content = get_reader().get_agent_log(config_type, run_id)
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
        content = get_reader().get_trade_logs(config_type, run_id)
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
        summary = get_reader().get_run_summary(config_type, run_id)
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
        summary = get_reader().get_run_summary(config_type, run_id)
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
        while True:
            summary = get_reader().get_run_summary(config_type, run_id)

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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
