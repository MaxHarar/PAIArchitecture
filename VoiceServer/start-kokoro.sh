#!/bin/bash

# Start the Kokoro TTS server (kokoro-onnx)
# This must be running before the Voice Server can generate speech

KOKORO_PORT="${KOKORO_PORT:-8000}"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PIDFILE="/tmp/kokoro-tts.pid"
LOGFILE="$HOME/Library/Logs/kokoro-tts.log"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}> Starting Kokoro TTS server (kokoro-onnx)...${NC}"

# Check if already running
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo -e "${YELLOW}! Kokoro server already running (PID: $(cat "$PIDFILE"))${NC}"
    echo "  Port: $KOKORO_PORT"
    exit 0
fi

# Check if kokoro_onnx is installed
if ! python -c "import kokoro_onnx" 2>/dev/null; then
    echo -e "${RED}X kokoro-onnx not installed${NC}"
    echo "  Install: pip install kokoro-onnx onnxruntime soundfile"
    exit 1
fi

# Start the server in background
echo "  Port: $KOKORO_PORT"
echo "  Log:  $LOGFILE"

nohup python "$SCRIPT_DIR/kokoro-server.py" --port "$KOKORO_PORT" > "$LOGFILE" 2>&1 &
echo $! > "$PIDFILE"

# Wait for server to become responsive (model download + load on first run)
echo -n "  Waiting for server"
for i in $(seq 1 60); do
    if curl -s -f "http://localhost:$KOKORO_PORT/health" > /dev/null 2>&1; then
        echo ""
        echo -e "${GREEN}OK Kokoro TTS server started (PID: $(cat "$PIDFILE"))${NC}"
        echo "  Test: curl -X POST http://localhost:$KOKORO_PORT/v1/audio/speech -H 'Content-Type: application/json' -d '{\"voice\":\"af_heart\",\"input\":\"Hello\"}' --output test.wav && afplay test.wav"
        exit 0
    fi
    echo -n "."
    sleep 2
done

echo ""
echo -e "${YELLOW}! Server started but not responding yet (first run downloads model ~80MB)${NC}"
echo "  Check logs: tail -f $LOGFILE"
echo "  PID: $(cat "$PIDFILE")"
