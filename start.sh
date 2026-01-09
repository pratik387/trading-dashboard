#!/bin/bash
#
# Start Trading Dashboard
# =======================
#
# Usage:
#   ./start.sh api          # FastAPI backend (port 8000)
#   ./start.sh frontend     # Next.js frontend (port 8501)
#   ./start.sh both         # Both services

cd "$(dirname "$0")"

VM_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

case "$1" in
    api)
        echo "Starting API on port 8000..."
        echo "Swagger: http://${VM_IP}:8000/docs"
        pip3 install -r requirements.txt -q
        uvicorn api:app --host 0.0.0.0 --port 8000
        ;;
    frontend)
        echo "Starting Frontend on port 8501..."
        echo "Dashboard: http://${VM_IP}:8501"
        cd frontend && npm run dev
        ;;
    both)
        echo "Starting API on port 8000..."
        pip3 install -r requirements.txt -q
        nohup uvicorn api:app --host 0.0.0.0 --port 8000 > api.log 2>&1 &
        echo "API PID: $!"
        echo ""
        echo "Starting Frontend on port 8501..."
        echo "Dashboard: http://${VM_IP}:8501"
        echo "API Swagger: http://${VM_IP}:8000/docs"
        cd frontend && npm run dev
        ;;
    *)
        echo "Usage: ./start.sh [api|frontend|both]"
        echo ""
        echo "  api       Start FastAPI backend on port 8000"
        echo "  frontend  Start Next.js frontend on port 8501"
        echo "  both      Start both services"
        ;;
esac
