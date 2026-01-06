#!/bin/bash
#
# Start Trading Dashboard API
# ============================
#
# Usage:
#   ./start.sh              # Foreground
#   ./start.sh --background # Background
#
# Access:
#   http://<ip>:8000/docs   # Swagger UI
#   http://<ip>:8000/api/   # API

cd "$(dirname "$0")"

# Install deps if needed
if ! python3 -c "import fastapi" 2>/dev/null; then
    pip3 install -r requirements.txt
fi

VM_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

if [ "$1" == "--background" ]; then
    nohup uvicorn api:app --host 0.0.0.0 --port 8000 > api.log 2>&1 &
    echo "API started! PID: $!"
    echo "Swagger: http://${VM_IP}:8000/docs"
else
    echo "Swagger: http://${VM_IP}:8000/docs"
    uvicorn api:app --host 0.0.0.0 --port 8000
fi
