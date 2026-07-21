#!/bin/bash

# Start the Kokoro TTS server (kokoro-onnx) via launchd
# Launchd manages the process with auto-restart on crash

SERVICE_NAME="com.pai.kokoro-tts"
PLIST_PATH="$HOME/Library/LaunchAgents/${SERVICE_NAME}.plist"
KOKORO_PORT="${KOKORO_PORT:-8000}"
LOGFILE="$HOME/Library/Logs/kokoro-tts.log"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}> Starting Kokoro TTS server (kokoro-onnx via launchd)...${NC}"

# Check if launchd plist exists
if [ ! -f "$PLIST_PATH" ]; then
    echo -e "${RED}X Service not installed${NC}"
    echo "  Missing: $PLIST_PATH"
    echo "  This should not happen - launchd plist is part of PAI installation"
    exit 1
fi

# Check if already running via launchd
if launchctl list | grep -q "$SERVICE_NAME" 2>/dev/null; then
    echo -e "${YELLOW}! Kokoro server already running (managed by launchd)${NC}"
    echo "  Port: $KOKORO_PORT"
    echo "  To restart: launchctl kickstart -k gui/$(id -u)/${SERVICE_NAME}"
    exit 0
fi

# Check if kokoro_onnx is installed
if ! /opt/anaconda3/bin/python -c "import kokoro_onnx" 2>/dev/null; then
    echo -e "${RED}X kokoro-onnx not installed${NC}"
    echo "  Install: /opt/anaconda3/bin/pip install kokoro-onnx onnxruntime soundfile"
    exit 1
fi

# Load the launchd service
echo "  Port: $KOKORO_PORT"
echo "  Log:  $LOGFILE"
launchctl load "$PLIST_PATH" 2>/dev/null

if [ $? -eq 0 ]; then
    # Wait for server to become responsive (model download + load on first run)
    echo -n "  Waiting for server"
    for i in $(seq 1 60); do
        if curl -s -f "http://localhost:$KOKORO_PORT/health" > /dev/null 2>&1; then
            echo ""
            echo -e "${GREEN}OK Kokoro TTS server started (managed by launchd)${NC}"
            echo "  Service: $SERVICE_NAME"
            echo "  Test: curl -X POST http://localhost:$KOKORO_PORT/v1/audio/speech -H 'Content-Type: application/json' -d '{\"voice\":\"af_heart\",\"input\":\"Hello\"}' --output test.wav && afplay test.wav"
            exit 0
        fi
        echo -n "."
        sleep 2
    done

    echo ""
    echo -e "${YELLOW}! Server started but not responding yet (first run downloads model ~80MB)${NC}"
    echo "  Check logs: tail -f $LOGFILE"
    echo "  Check status: launchctl list | grep $SERVICE_NAME"
else
    echo -e "${RED}X Failed to load launchd service${NC}"
    echo "  Check plist: plutil -lint $PLIST_PATH"
    echo "  Check logs: tail -f $LOGFILE"
    exit 1
fi
