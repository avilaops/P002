"""Private, asynchronous HTTP adapter for Faster Whisper."""

import asyncio
import io
import os
import threading

from fastapi import FastAPI, File, HTTPException, UploadFile
from faster_whisper import WhisperModel

MODEL_NAME = os.getenv("WHISPER_MODEL", "small")
DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
MAX_AUDIO_BYTES = int(os.getenv("WHISPER_MAX_AUDIO_BYTES", str(200 * 1024 * 1024)))

_model_instance: WhisperModel | None = None
_model_lock = threading.Lock()
app = FastAPI(title="CRM private transcription", docs_url=None, redoc_url=None)


def _model() -> WhisperModel:
    global _model_instance
    if _model_instance is None:
        with _model_lock:
            if _model_instance is None:
                _model_instance = WhisperModel(
                    MODEL_NAME,
                    device=DEVICE,
                    compute_type=COMPUTE_TYPE,
                )
    return _model_instance


def _transcribe(audio: bytes) -> dict[str, str]:
    segments, info = _model().transcribe(
        io.BytesIO(audio),
        language="pt",
        beam_size=5,
    )
    text = " ".join(segment.text.strip() for segment in segments).strip()
    return {"texto": text[:100_000], "idioma": info.language}


@app.get("/saude")
async def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/transcrever")
async def transcrever(arquivo: UploadFile = File(...)) -> dict[str, str]:
    audio = await arquivo.read(MAX_AUDIO_BYTES + 1)
    await arquivo.close()
    if len(audio) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Áudio excede o limite permitido.")
    if not audio:
        raise HTTPException(status_code=400, detail="Arquivo de áudio vazio.")
    return await asyncio.to_thread(_transcribe, audio)
