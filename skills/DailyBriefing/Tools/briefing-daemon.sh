#!/bin/bash
# Wake-Triggered Briefing Daemon Wrapper
#
# This wrapper ensures proper environment setup for launchd execution.
# Logs all output to briefing-daemon.log for debugging.
#
# Usage (typically via launchd):
#   ~/.claude/skills/DailyBriefing/Tools/briefing-daemon.sh

set -e

# Configuration
SCRIPT_DIR="$HOME/.claude/skills/DailyBriefing"
LOG_FILE="$SCRIPT_DIR/State/briefing-daemon.log"
WAKE_SCRIPT="$SCRIPT_DIR/Tools/briefing-on-wake.ts"

# Ensure log directory exists
mkdir -p "$SCRIPT_DIR/State"

# Rotate log if over 1MB
if [ -f "$LOG_FILE" ] && [ $(stat -f%z "$LOG_FILE" 2>/dev/null || echo 0) -gt 1048576 ]; then
    mv "$LOG_FILE" "$LOG_FILE.old"
fi

# Log function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

log "=========================================="
log "Briefing daemon starting"

# Verify bun is available
if ! command -v /opt/homebrew/bin/bun &> /dev/null; then
    log "ERROR: bun not found at /opt/homebrew/bin/bun"
    exit 1
fi

# Verify script exists
if [ ! -f "$WAKE_SCRIPT" ]; then
    log "ERROR: Wake script not found at $WAKE_SCRIPT"
    exit 1
fi

# Run the wake detection script
# Uses Garmin sleep data to detect wake time
log "Running wake detection (Garmin-based)..."
/opt/homebrew/bin/bun run "$WAKE_SCRIPT" 2>&1 | while read line; do
    log "  $line"
done

EXIT_CODE=${PIPESTATUS[0]}

if [ $EXIT_CODE -eq 0 ]; then
    log "Wake detection completed successfully"
else
    log "Wake detection exited with code $EXIT_CODE"
fi

log "Daemon cycle complete"
exit $EXIT_CODE
