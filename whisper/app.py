"""
faster-whisper transcription sidecar for piwebui.

Deliberately boring: one model held in memory, one lock so requests serialize,
one endpoint. Whisper inference is CPU-bound, so concurrency would only add
memory pressure without throughput.

    uvicorn app:app --host 127.0.0.1 --port 8001
"""

from __future__ import annotations

import os
import tempfile
import threading
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from faster_whisper import WhisperModel

MODEL_NAME = os.getenv("WHISPER_MODEL", "small")
DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
CPU_THREADS = int(os.getenv("WHISPER_CPU_THREADS", "0")) or None
BEAM_SIZE = int(os.getenv("WHISPER_BEAM_SIZE", "5"))
DEFAULT_LANGUAGE = os.getenv("WHISPER_LANGUAGE", "zh")
AUTH_TOKEN = os.getenv("WHISPER_TOKEN", "")
# A domain hint sharply improves punctuation and terminology for Chinese speech.
INITIAL_PROMPT = os.getenv("WHISPER_INITIAL_PROMPT", "")
MAX_BYTES = int(os.getenv("WHISPER_MAX_MB", "30")) * 1024 * 1024

model = None
model_lock = threading.Lock()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model
    started = time.time()
    print(f"[whisper] loading model={MODEL_NAME} device={DEVICE} compute={COMPUTE_TYPE}", flush=True)
    # WhisperModel downloads on first use; HF_ENDPOINT can point at a mirror.
    model = WhisperModel(
        MODEL_NAME,
        device=DEVICE,
        compute_type=COMPUTE_TYPE,
        cpu_threads=CPU_THREADS or 0,
        num_workers=1,
    )
    print(f"[whisper] ready in {time.time() - started:.1f}s", flush=True)
    yield
    model = None


app = FastAPI(title="piwebui-whisper", lifespan=lifespan)


def check_auth(authorization: str | None) -> None:
    if not AUTH_TOKEN:
        return
    expected = f"Bearer {AUTH_TOKEN}"
    if not authorization or authorization != expected:
        raise HTTPException(status_code=401, detail="unauthorized")


@app.get("/health")
def health() -> JSONResponse:
    return JSONResponse(
        {
            "ok": model is not None,
            "model": MODEL_NAME,
            "device": DEVICE,
            "computeType": COMPUTE_TYPE,
        }
    )


@app.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    language: str = Form(""),
    initial_prompt: str = Form(""),
    authorization: str | None = Header(default=None),
) -> JSONResponse:
    check_auth(authorization)

    if model is None:
        raise HTTPException(status_code=503, detail="model not loaded")

    payload = await audio.read()
    if not payload:
        raise HTTPException(status_code=400, detail="empty audio")
    if len(payload) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="audio too large")

    suffix = os.path.splitext(audio.filename or "")[1] or ".webm"
    started = time.time()

    # faster-whisper decodes through PyAV, so a temp file avoids holding a second
    # copy in memory and keeps the container probing simple.
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(payload)
            tmp_path = tmp.name

        lang = (language or DEFAULT_LANGUAGE or "").strip()
        if lang.lower() in ("auto", "detect", ""):
            lang = None

        # The model object is not safe for concurrent transcribe() calls.
        with model_lock:
            segments, info = model.transcribe(
                tmp_path,
                language=lang,
                beam_size=BEAM_SIZE,
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 350},
                initial_prompt=(initial_prompt or INITIAL_PROMPT or None),
                condition_on_previous_text=False,
            )
            text = "".join(segment.text for segment in segments).strip()

        return JSONResponse(
            {
                "text": text,
                "language": getattr(info, "language", None) or lang or "auto",
                "durationMs": int((time.time() - started) * 1000),
                "model": MODEL_NAME,
            }
        )
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=os.getenv("WHISPER_HOST", "127.0.0.1"),
        port=int(os.getenv("WHISPER_PORT", "8001")),
        log_level="info",
    )
