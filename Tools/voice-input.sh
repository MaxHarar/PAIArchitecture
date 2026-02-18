#!/bin/bash
# PAI Voice Input - Records audio, transcribes with Whisper, copies to clipboard
# Usage: voice-input.sh [max_seconds]
#   max_seconds: Maximum recording duration (default: 30)
#   Recording stops on silence OR max duration, whichever comes first.
#   Ctrl+C also stops recording immediately.

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────────
WHISPER_MODEL="/Users/maxharar/.claude/models/whisper/ggml-base.en.bin"
MAX_SECONDS="${1:-30}"
TEMP_DIR="/tmp/pai-voice"
AUDIO_FILE="${TEMP_DIR}/input.wav"

# Sox silence detection: stop after 2.5s of silence below 2% volume
SILENCE_DURATION="2.5"
SILENCE_THRESHOLD="2%"

# ── Setup ──────────────────────────────────────────────────────────────────────
mkdir -p "$TEMP_DIR"
rm -f "$AUDIO_FILE"

# Trap Ctrl+C to stop recording gracefully
RECORDING_PID=""
cleanup() {
    if [[ -n "$RECORDING_PID" ]] && kill -0 "$RECORDING_PID" 2>/dev/null; then
        kill "$RECORDING_PID" 2>/dev/null
        wait "$RECORDING_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT

# ── Record ─────────────────────────────────────────────────────────────────────
printf "\n  🎙️  \033[1;36mListening...\033[0m (speak now, stops on silence or %ss max)\n\n" "$MAX_SECONDS"

# Play a subtle start sound
afplay /System/Library/Sounds/Tink.aiff 2>/dev/null &

# Record with silence detection
sox -d -r 16000 -c 1 -b 16 "$AUDIO_FILE" \
    trim 0 "$MAX_SECONDS" \
    silence 1 0.1 "$SILENCE_THRESHOLD" 1 "$SILENCE_DURATION" "$SILENCE_THRESHOLD" \
    2>/dev/null &
RECORDING_PID=$!

wait "$RECORDING_PID" 2>/dev/null || true
RECORDING_PID=""

# Check if we got audio
if [[ ! -f "$AUDIO_FILE" ]] || [[ ! -s "$AUDIO_FILE" ]]; then
    printf "  ❌ No audio captured.\n"
    exit 1
fi

DURATION=$(sox "$AUDIO_FILE" -n stat 2>&1 | grep "Length" | awk '{print $3}' || echo "0")
printf "  📝 Recorded %.1fs — transcribing...\n" "$DURATION"

# ── Transcribe ─────────────────────────────────────────────────────────────────
TRANSCRIPT=$(whisper-cli \
    -m "$WHISPER_MODEL" \
    -f "$AUDIO_FILE" \
    --no-prints \
    -t 4 \
    --no-timestamps \
    2>/dev/null)

# Clean up the transcript (remove leading/trailing whitespace, [BLANK_AUDIO], etc.)
TRANSCRIPT=$(echo "$TRANSCRIPT" | sed 's/\[BLANK_AUDIO\]//g' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | tr -s ' ')

if [[ -z "$TRANSCRIPT" ]]; then
    printf "  ❌ No speech detected.\n"
    afplay /System/Library/Sounds/Basso.aiff 2>/dev/null &
    exit 1
fi

# ── Output ─────────────────────────────────────────────────────────────────────
# Copy to clipboard
echo -n "$TRANSCRIPT" | pbcopy

# Play done sound
afplay /System/Library/Sounds/Pop.aiff 2>/dev/null &

printf "\n  ✅ \033[1;32mCopied to clipboard:\033[0m\n"
printf "  ┌─────────────────────────────────────────────\n"
printf "  │ %s\n" "$TRANSCRIPT"
printf "  └─────────────────────────────────────────────\n"
printf "\n  📋 Paste with \033[1mCmd+V\033[0m into Claude Code\n\n"

# Cleanup temp files
rm -f "$AUDIO_FILE"
