#!/bin/bash

set -e

cd "$(dirname "$0")"

echo "Starting Workout Tracker..."

# Start backend
echo "Starting backend (FastAPI)..."
cd backend
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python -m venv venv
fi
source venv/bin/activate
pip install -q -r requirements.txt 2>/dev/null || true
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

cd ../frontend

# Start frontend
echo "Starting frontend (Next.js)..."
npm run dev &
FRONTEND_PID=$!

echo ""
echo "Backend: http://localhost:8000"
echo "Frontend: http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop both servers"

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT

wait
