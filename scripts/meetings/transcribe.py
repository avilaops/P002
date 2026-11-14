"""Loopback-only Faster Whisper endpoint for bounded CRM audio chunks."""
import io
import json
import os
import secrets
from http.server import BaseHTTPRequestHandler, HTTPServer
from faster_whisper import WhisperModel

MAX_BYTES = 2 * 1024 * 1024
API_KEY = os.environ["MEETING_STT_KEY"]
MODEL_NAME = os.environ.get("MEETING_WHISPER_MODEL", "base")
MODEL = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8", cpu_threads=2, num_workers=1)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass  # Audio, credentials and transcripts must not appear in access logs.

    def respond(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.respond(200 if self.path == "/health" else 404, {"ok": self.path == "/health", "model": MODEL_NAME})

    def do_POST(self):
        if self.path != "/transcribe":
            return self.respond(404, {"error": "Not found"})
        if not secrets.compare_digest(self.headers.get("Authorization", ""), "Bearer " + API_KEY):
            return self.respond(401, {"error": "Unauthorized"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self.respond(400, {"error": "Invalid length"})
        if length < 16 or length > MAX_BYTES:
            return self.respond(413, {"error": "Invalid audio size"})
        self.connection.settimeout(15)
        audio = self.rfile.read(length)
        if len(audio) != length:
            return self.respond(400, {"error": "Incomplete audio"})
        try:
            segments, _info = MODEL.transcribe(io.BytesIO(audio), language="pt", beam_size=3, vad_filter=True, condition_on_previous_text=False)
            text = " ".join(segment.text.strip() for segment in segments).strip()
            self.respond(200, {"text": text})
        except Exception:
            self.respond(422, {"error": "Audio could not be transcribed"})


if __name__ == "__main__":
    print("Whisper ready on 127.0.0.1:15435", flush=True)
    HTTPServer(("127.0.0.1", 15435), Handler).serve_forever()
