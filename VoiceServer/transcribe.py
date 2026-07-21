#!/usr/bin/env python3
"""
Whisper transcription script using mlx-whisper (Apple Silicon optimized).

Usage:
  python transcribe.py <audio_file_path>

Outputs JSON to stdout:
  {"text": "transcribed text here"}

Errors output JSON to stderr:
  {"error": "error message"}
"""

import sys
import os
import json

# Ensure Homebrew bin is in PATH for ffmpeg
os.environ["PATH"] = f"/opt/homebrew/bin:/usr/local/bin:{os.environ.get('PATH', '')}"

def transcribe(audio_path: str) -> str:
    """Transcribe audio file using mlx-whisper."""
    import mlx_whisper

    result = mlx_whisper.transcribe(
        audio_path,
        path_or_hf_repo="mlx-community/whisper-tiny",
        language="en",
    )
    return result["text"].strip()


def main():
    if len(sys.argv) != 2:
        print(json.dumps({"error": "Usage: transcribe.py <audio_file>"}), file=sys.stderr)
        sys.exit(1)

    audio_path = sys.argv[1]

    try:
        text = transcribe(audio_path)
        print(json.dumps({"text": text}))
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
