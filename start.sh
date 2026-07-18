#!/bin/bash
# Start both Django backend and React frontend together.
# Press Ctrl+C once to stop both.

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "  Starting Ads Manager..."
echo "  Backend  → http://localhost:8000"
echo "  Frontend → http://localhost:5173"
echo "  Press Ctrl+C to stop both."
echo ""

# Use the app's venv if present, otherwise fall back to system python3
if [ -f "$PROJECT_DIR/venv/bin/activate" ]; then
  source "$PROJECT_DIR/venv/bin/activate"
  PYTHON=python
else
  PYTHON=python3
fi

# Start Django in background
cd "$PROJECT_DIR"
"$PYTHON" manage.py runserver 0.0.0.0:8000 &
DJANGO_PID=$!

# Start Vite in background
cd "$PROJECT_DIR/ads-dashboard"
npm run dev &
VITE_PID=$!

# Trap Ctrl+C — kill both cleanly
trap "echo ''; echo 'Stopping...'; kill $DJANGO_PID $VITE_PID 2>/dev/null; wait; echo 'Stopped.'; exit 0" SIGINT SIGTERM

# Wait for both processes
wait $DJANGO_PID $VITE_PID
