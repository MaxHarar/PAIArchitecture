#!/bin/bash

# Stop the Kokoro TTS server

PIDFILE="/tmp/kokoro-tts.pid"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ -f "$PIDFILE" ]; then
    PID=$(cat "$PIDFILE")
    if kill -0 "$PID" 2>/dev/null; then
        kill "$PID"
        rm -f "$PIDFILE"
        echo -e "${GREEN}OK Kokoro TTS server stopped (PID: $PID)${NC}"
    else
        rm -f "$PIDFILE"
        echo -e "${YELLOW}! PID file existed but process was not running${NC}"
    fi
else
    echo -e "${YELLOW}! Kokoro TTS server not running (no PID file)${NC}"
fi
