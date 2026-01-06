#!/bin/bash
#
# Start Trading Dashboard
# =======================
#
# Usage:
#   ./start.sh dashboard    # Streamlit UI (port 8501)
#   ./start.sh api          # FastAPI backend (port 8000)
#   ./start.sh both         # Both services

cd "$(dirname "$0")"

# Install deps if needed
pip3 install -r requirements.txt -q

VM_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

case "$1" in
    api)
        echo "Starting API on port 8000..."
        echo "Swagger: http://${VM_IP}:8000/docs"
        uvicorn api:app --host 0.0.0.0 --port 8000
        ;;
    both)
        echo "Starting API on port 8000..."
        nohup uvicorn api:app --host 0.0.0.0 --port 8000 > api.log 2>&1 &
        echo "API PID: $!"
        echo ""
        echo "Starting Dashboard on port 8501..."
        echo "Dashboard: http://${VM_IP}:8501"
        echo "API Swagger: http://${VM_IP}:8000/docs"
        streamlit run app.py --server.port 8501 --server.address 0.0.0.0 --server.headless true
        ;;
    dashboard|*)
        echo "Starting Dashboard on port 8501..."
        echo "Dashboard: http://${VM_IP}:8501"
        streamlit run app.py --server.port 8501 --server.address 0.0.0.0 --server.headless true
        ;;
esac
