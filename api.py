"""
Trading Dashboard API - FastAPI Backend
=======================================

REST API for trading data. Frontend-agnostic - works with:
- Streamlit (current)
- React/Next.js (future)
- Mobile apps (future)

Run:
    uvicorn api:app --host 0.0.0.0 --port 8000

Endpoints:
    GET  /api/runs                     - List all runs
    GET  /api/runs/{run_id}            - Get run details
    GET  /api/runs/{run_id}/summary    - Get run summary
    GET  /api/runs/{run_id}/sessions   - List sessions
    GET  /api/runs/{run_id}/sessions/{date}        - Get session data
    GET  /api/runs/{run_id}/sessions/{date}/trades - Get trades
    GET  /api/runs/{run_id}/trades/{trade_id}      - Get trade details
    WS   /api/ws/live/{run_id}         - WebSocket for live updates
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
    version="1.0.0"
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
    submitted_at: str
    start_date: str
    end_date: str
    days: int
    description: str


# ============ REST Endpoints ============

@app.get("/")
async def root():
    """API health check"""
    return {
        "status": "ok",
        "service": "Trading Dashboard API",
        "timestamp": datetime.now().isoformat()
    }


@app.get("/api/runs", response_model=List[RunInfo])
async def list_runs(limit: int = 50):
    """List all available runs from OCI bucket"""
    try:
        runs = get_reader().list_runs(limit=limit)
        return runs
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{run_id}")
async def get_run(run_id: str):
    """Get run metadata"""
    try:
        runs = get_reader().list_runs(limit=100)
        for run in runs:
            if run['run_id'] == run_id:
                return run
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{run_id}/sessions")
async def list_sessions(run_id: str):
    """List all sessions for a run"""
    try:
        sessions = get_reader().list_sessions(run_id)
        return {"run_id": run_id, "sessions": sessions, "count": len(sessions)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{run_id}/summary")
async def get_run_summary(run_id: str, days: int = 30):
    """Get aggregate summary for a run"""
    try:
        summary = get_reader().get_run_summary(run_id, last_n_days=days)
        return summary
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{run_id}/sessions/{session_date}")
async def get_session_summary(run_id: str, session_date: str):
    """Get summary for a specific session"""
    try:
        summary = get_reader().get_daily_summary(run_id, session_date)
        return summary
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{run_id}/sessions/{session_date}/trades")
async def get_session_trades(run_id: str, session_date: str):
    """Get all trades for a session"""
    try:
        analytics = get_reader().get_analytics(run_id, session_date)
        trades = [a for a in analytics if a.get('is_final_exit')]
        return {"session_date": session_date, "trades": trades, "count": len(trades)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{run_id}/sessions/{session_date}/events")
async def get_session_events(run_id: str, session_date: str):
    """Get all events (DECISION, TRIGGER, EXIT) for a session"""
    try:
        events = get_reader().get_events(run_id, session_date)
        return {"session_date": session_date, "events": events, "count": len(events)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{run_id}/sessions/{session_date}/trades/{trade_id}")
async def get_trade_details(run_id: str, session_date: str, trade_id: str):
    """Get complete details for a specific trade"""
    try:
        details = get_reader().get_trade_details(run_id, session_date, trade_id)
        if not details.get('decision') and not details.get('exits'):
            raise HTTPException(status_code=404, detail=f"Trade {trade_id} not found")
        return details
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{run_id}/analysis/setups")
async def get_setup_analysis(run_id: str, days: int = 30):
    """Get setup performance analysis"""
    try:
        summary = get_reader().get_run_summary(run_id, last_n_days=days)
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
        return {"run_id": run_id, "days": days, "setups": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{run_id}/analysis/regimes")
async def get_regime_analysis(run_id: str, days: int = 30):
    """Get regime performance analysis"""
    try:
        summary = get_reader().get_run_summary(run_id, last_n_days=days)
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
        return {"run_id": run_id, "days": days, "regimes": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ WebSocket for Live Updates ============

class ConnectionManager:
    """Manages WebSocket connections"""
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, run_id: str):
        await websocket.accept()
        if run_id not in self.active_connections:
            self.active_connections[run_id] = []
        self.active_connections[run_id].append(websocket)

    def disconnect(self, websocket: WebSocket, run_id: str):
        if run_id in self.active_connections:
            self.active_connections[run_id].remove(websocket)


manager = ConnectionManager()


@app.websocket("/api/ws/live/{run_id}")
async def websocket_live(websocket: WebSocket, run_id: str):
    """WebSocket endpoint for live updates (every 10 seconds)"""
    await manager.connect(websocket, run_id)
    try:
        while True:
            sessions = get_reader().list_sessions(run_id)
            if sessions:
                latest = sessions[0]
                summary = get_reader().get_daily_summary(run_id, latest)

                await websocket.send_json({
                    "type": "update",
                    "timestamp": datetime.now().isoformat(),
                    "session": latest,
                    "data": summary
                })

            await asyncio.sleep(10)

    except WebSocketDisconnect:
        manager.disconnect(websocket, run_id)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
