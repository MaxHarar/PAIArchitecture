#!/usr/bin/env python3
"""
Kokoro TTS Server — Lightweight HTTP server using kokoro-onnx.
OpenAI-compatible /v1/audio/speech endpoint for the PAI Voice Server.

Usage: python kokoro-server.py [--port 8000]
"""

import argparse
import io
import json
import os
import sys
import time
from http.server import HTTPServer, BaseHTTPRequestHandler

import soundfile as sf

# Lazy-load kokoro to show startup message faster
kokoro_instance = None
MODEL_DIR = os.path.expanduser("~/.cache/kokoro-onnx")
MODEL_PATH = os.path.join(MODEL_DIR, "kokoro-v1.0.int8.onnx")
VOICES_PATH = os.path.join(MODEL_DIR, "voices-v1.0.bin")


def get_kokoro():
    """Lazy-load and cache the Kokoro model."""
    global kokoro_instance
    if kokoro_instance is None:
        from kokoro_onnx import Kokoro

        os.makedirs(MODEL_DIR, exist_ok=True)

        # Download model files if missing
        if not os.path.exists(MODEL_PATH):
            print("Downloading Kokoro model (first time, ~80MB int8)...", flush=True)
            import urllib.request
            urllib.request.urlretrieve(
                "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx",
                MODEL_PATH,
            )

        if not os.path.exists(VOICES_PATH):
            print("Downloading voice data...", flush=True)
            import urllib.request
            urllib.request.urlretrieve(
                "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin",
                VOICES_PATH,
            )

        print("Loading Kokoro model...", flush=True)
        kokoro_instance = Kokoro(MODEL_PATH, VOICES_PATH)
        print("Kokoro model ready.", flush=True)

    return kokoro_instance


class KokoroHandler(BaseHTTPRequestHandler):
    """Handle TTS requests."""

    def do_GET(self):
        if self.path == "/v1/models":
            self._json_response(200, {"data": [{"id": "kokoro-onnx", "object": "model"}]})
        elif self.path == "/health":
            self._json_response(200, {"status": "healthy", "model": "kokoro-onnx-int8", "backend": "onnxruntime"})
        else:
            self._json_response(200, {"message": "Kokoro TTS Server. POST /v1/audio/speech"})

    def do_POST(self):
        if self.path != "/v1/audio/speech":
            self._json_response(404, {"error": "Not found. Use POST /v1/audio/speech"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(content_length))

            text = body.get("input", "")
            voice = body.get("voice", "af_heart")
            speed = float(body.get("speed", 1.0))

            if not text:
                self._json_response(400, {"error": "Missing 'input' field"})
                return

            t0 = time.time()
            kokoro = get_kokoro()
            samples, sample_rate = kokoro.create(text, voice=voice, speed=speed, lang="en-us")
            gen_time = time.time() - t0

            # Write WAV to buffer
            buf = io.BytesIO()
            sf.write(buf, samples, sample_rate, format="WAV")
            wav_bytes = buf.getvalue()

            duration = len(samples) / sample_rate
            print(f"Generated {duration:.1f}s audio in {gen_time:.2f}s (voice={voice}, speed={speed})", flush=True)

            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(wav_bytes)))
            self.end_headers()
            self.wfile.write(wav_bytes)

        except Exception as e:
            print(f"Error: {e}", flush=True, file=sys.stderr)
            self._json_response(500, {"error": str(e)})

    def _json_response(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        """Quiet request logging — only errors."""
        if args and "500" in str(args[0]):
            super().log_message(format, *args)


def main():
    parser = argparse.ArgumentParser(description="Kokoro TTS Server")
    parser.add_argument("--port", type=int, default=8000, help="Port to listen on (default: 8000)")
    args = parser.parse_args()

    # Pre-load the model at startup
    get_kokoro()

    server = HTTPServer(("0.0.0.0", args.port), KokoroHandler)
    print(f"Kokoro TTS server running on port {args.port}", flush=True)
    print(f"  POST http://localhost:{args.port}/v1/audio/speech", flush=True)
    print(f"  GET  http://localhost:{args.port}/health", flush=True)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.", flush=True)
        server.shutdown()


if __name__ == "__main__":
    main()
