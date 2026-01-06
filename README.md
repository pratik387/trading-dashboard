# Trading Dashboard

REST API for trading data from OCI Object Storage bucket.

## Architecture

```
OCI Bucket (backtest-results)
         │
         ▼
    oci_reader.py  ──▶  api.py (FastAPI)  ──▶  Any Frontend
                            │
                            ├── React/Next.js
                            ├── Mobile App
                            └── Streamlit
```

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Start API
./start.sh

# Access Swagger docs
open http://localhost:8000/docs
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/runs` | List all runs |
| `GET /api/runs/{id}/summary` | Run summary (PnL, win rate) |
| `GET /api/runs/{id}/sessions` | List sessions |
| `GET /api/runs/{id}/sessions/{date}` | Daily summary |
| `GET /api/runs/{id}/sessions/{date}/trades` | Trades for day |
| `GET /api/runs/{id}/analysis/setups` | Setup performance |
| `GET /api/runs/{id}/analysis/regimes` | Regime performance |
| `WS /api/ws/live/{id}` | WebSocket live updates |

## OCI Setup

Requires `~/.oci/config` or instance principal on OCI VM.
