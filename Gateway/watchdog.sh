#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Sentinel Gateway -- External Watchdog
#
# Runs from launchd or cron. Checks /health, restarts if unhealthy,
# and alerts via Telegram (bypassing the gateway entirely).
#
# Usage:
#   bash ~/.claude/Gateway/watchdog.sh
#
# Install in crontab for periodic checks:
#   * * * * * /bin/bash ~/.claude/Gateway/watchdog.sh >> /tmp/gateway-watchdog.log 2>&1
# ---------------------------------------------------------------------------

set -euo pipefail

GATEWAY_URL="http://127.0.0.1:18800/health"
LAUNCHD_LABEL="com.pai.gateway"
LOG_PREFIX="[gateway-watchdog $(date -u +%Y-%m-%dT%H:%M:%SZ)]"

# ---------------------------------------------------------------------------
# Read Telegram credentials from macOS Keychain (never from env or files)
# ---------------------------------------------------------------------------
BOT_TOKEN=$(security find-generic-password -a "pai-gateway" -s "telegram-bot-token" -w 2>/dev/null || echo "")
CHAT_ID=$(security find-generic-password -a "pai-gateway" -s "telegram-chat-id" -w 2>/dev/null || echo "")

# ---------------------------------------------------------------------------
# Send a Telegram alert (direct API call, bypasses gateway)
# ---------------------------------------------------------------------------
send_alert() {
  local message="$1"
  if [[ -z "$BOT_TOKEN" || -z "$CHAT_ID" ]]; then
    echo "$LOG_PREFIX WARN: Cannot send Telegram alert -- missing BOT_TOKEN or CHAT_ID in Keychain"
    return 1
  fi

  curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -H "Content-Type: application/json" \
    -d "{\"chat_id\": \"${CHAT_ID}\", \"text\": \"${message}\", \"parse_mode\": \"HTML\"}" \
    > /dev/null 2>&1 || true
}

# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
HTTP_CODE=$(curl -s -o /tmp/gateway-health-response.json -w "%{http_code}" \
  --max-time 5 \
  "$GATEWAY_URL" 2>/dev/null || echo "000")

if [[ "$HTTP_CODE" == "200" ]]; then
  # Got a 200 -- check the status field in the JSON response
  STATUS=$(cat /tmp/gateway-health-response.json 2>/dev/null | \
    /usr/bin/python3 -c "import sys,json; print(json.load(sys.stdin).get('status','unknown'))" 2>/dev/null || echo "unknown")

  if [[ "$STATUS" == "healthy" ]]; then
    # All good -- exit silently
    exit 0
  fi

  echo "$LOG_PREFIX Gateway returned status=$STATUS (HTTP 200) -- restarting"
  send_alert "Gateway degraded (status=${STATUS}). Restarting via launchctl."
else
  echo "$LOG_PREFIX Gateway health check failed (HTTP $HTTP_CODE) -- restarting"
  send_alert "Gateway unreachable (HTTP ${HTTP_CODE}). Restarting via launchctl."
fi

# ---------------------------------------------------------------------------
# Restart the gateway via launchd
# ---------------------------------------------------------------------------
LAUNCHD_UID=$(id -u)

if launchctl print "gui/${LAUNCHD_UID}/${LAUNCHD_LABEL}" > /dev/null 2>&1; then
  echo "$LOG_PREFIX Kicking ${LAUNCHD_LABEL}..."
  launchctl kickstart -k "gui/${LAUNCHD_UID}/${LAUNCHD_LABEL}" 2>&1 || {
    echo "$LOG_PREFIX Failed to kickstart -- attempting bootout/bootstrap"
    PLIST_PATH="${HOME}/Library/LaunchAgents/${LAUNCHD_LABEL}.plist"
    if [[ -f "$PLIST_PATH" ]]; then
      launchctl bootout "gui/${LAUNCHD_UID}/${LAUNCHD_LABEL}" 2>/dev/null || true
      sleep 1
      launchctl bootstrap "gui/${LAUNCHD_UID}" "$PLIST_PATH" 2>&1
    else
      echo "$LOG_PREFIX FATAL: plist not found at $PLIST_PATH"
      send_alert "Gateway restart failed: plist not found. Manual intervention required."
    fi
  }
else
  echo "$LOG_PREFIX Service ${LAUNCHD_LABEL} not registered -- attempting bootstrap"
  PLIST_PATH="${HOME}/Library/LaunchAgents/${LAUNCHD_LABEL}.plist"
  if [[ -f "$PLIST_PATH" ]]; then
    launchctl bootstrap "gui/${LAUNCHD_UID}" "$PLIST_PATH" 2>&1
  else
    echo "$LOG_PREFIX FATAL: plist not found at $PLIST_PATH"
    send_alert "Gateway not registered and plist missing. Manual intervention required."
    exit 1
  fi
fi

echo "$LOG_PREFIX Restart command issued. Waiting 5s to verify..."
sleep 5

# Verify the restart worked
VERIFY_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$GATEWAY_URL" 2>/dev/null || echo "000")
if [[ "$VERIFY_CODE" == "200" ]]; then
  echo "$LOG_PREFIX Gateway restarted successfully."
  send_alert "Gateway restarted successfully and is now healthy."
else
  echo "$LOG_PREFIX Gateway still unhealthy after restart (HTTP $VERIFY_CODE)."
  send_alert "Gateway restart FAILED. Still unreachable (HTTP ${VERIFY_CODE}). Manual intervention required."
  exit 1
fi
