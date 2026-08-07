import asyncio
import io
import os
import re
import subprocess
import tempfile
from contextlib import asynccontextmanager
from typing import AsyncIterator, Literal

import numpy as np
import onnxruntime as ort
import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response, StreamingResponse
from kokoro_onnx import Kokoro
from pydantic import BaseModel, Field


MODEL_PATH = os.getenv("MODEL_PATH", "/models/kokoro-v1.0.onnx")
VOICES_PATH = os.getenv("VOICES_PATH", "/models/voices-v1.0.bin")
DEFAULT_LANGUAGE = os.getenv("KOKORO_DEFAULT_LANGUAGE", "cmn")
MAX_CONCURRENCY = max(1, int(os.getenv("KOKORO_MAX_CONCURRENCY", "1")))
SAMPLE_RATE = 24000

kokoro: Kokoro | None = None
active_providers: list[str] = []
provider_fallback: str | None = None
inference_slots = asyncio.Semaphore(MAX_CONCURRENCY)


class SpeechRequest(BaseModel):
    model: str = "kokoro"
    input: str = Field(min_length=1, max_length=20000)
    voice: str = "zf_xiaoxiao"
    response_format: Literal["wav", "pcm", "mp3", "opus", "flac", "aac"] = "mp3"
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    stream: bool = False
    lang_code: str | None = None


def split_text(text: str) -> list[str]:
    chunks = [part.strip() for part in re.findall(r"[^。！？!?；;\n]+[。！？!?；;\n]?", text)]
    return [part for part in chunks if part]


def pcm_bytes(samples: np.ndarray) -> bytes:
    clipped = np.clip(samples, -1.0, 1.0)
    return (clipped * 32767).astype("<i2").tobytes()


def wav_bytes(samples: np.ndarray) -> bytes:
    target = io.BytesIO()
    sf.write(target, samples, SAMPLE_RATE, format="WAV", subtype="PCM_16")
    return target.getvalue()


def encoded_bytes(samples: np.ndarray, output_format: str) -> bytes:
    if output_format == "pcm":
        return pcm_bytes(samples)
    if output_format == "wav":
        return wav_bytes(samples)

    ffmpeg_format = {"mp3": "mp3", "opus": "opus", "flac": "flac", "aac": "adts"}[output_format]
    with tempfile.NamedTemporaryFile(suffix=".wav") as source:
        sf.write(source.name, samples, SAMPLE_RATE, format="WAV", subtype="PCM_16")
        process = subprocess.run(
            ["ffmpeg", "-v", "error", "-i", source.name, "-f", ffmpeg_format, "pipe:1"],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    return process.stdout


def create_audio(text: str, voice: str, speed: float, language: str) -> np.ndarray:
    assert kokoro is not None
    samples, _ = kokoro.create(text, voice=voice, speed=speed, lang=language)
    return samples


async def generate_chunk(text: str, request: SpeechRequest) -> np.ndarray:
    language = request.lang_code or DEFAULT_LANGUAGE
    async with inference_slots:
        return await asyncio.to_thread(create_audio, text, request.voice, request.speed, language)


async def stream_pcm(request: SpeechRequest) -> AsyncIterator[bytes]:
    for sentence in split_text(request.input):
        samples = await generate_chunk(sentence, request)
        yield pcm_bytes(samples)


@asynccontextmanager
async def lifespan(_: FastAPI):
    global kokoro, active_providers, provider_fallback
    provider = os.getenv("ONNX_PROVIDER", "CPUExecutionProvider")
    if provider == "OpenVINOExecutionProvider":
        device = os.getenv("KOKORO_OPENVINO_DEVICE", "CPU")
        try:
            session = await asyncio.to_thread(
                ort.InferenceSession,
                MODEL_PATH,
                providers=[(provider, {"device_type": device})],
            )
        except Exception as error:
            provider_fallback = f"{provider}:{device} unavailable: {type(error).__name__}"
            session = await asyncio.to_thread(
                ort.InferenceSession, MODEL_PATH, providers=["CPUExecutionProvider"]
            )
        if provider not in session.get_providers() and provider_fallback is None:
            provider_fallback = f"{provider}:{device} unavailable; runtime selected CPU"
        kokoro = Kokoro.from_session(session, VOICES_PATH)
    else:
        kokoro = await asyncio.to_thread(Kokoro, MODEL_PATH, VOICES_PATH)
    active_providers = kokoro.sess.get_providers()
    await asyncio.to_thread(create_audio, "你好。", "zf_xiaoxiao", 1.0, DEFAULT_LANGUAGE)
    yield
    kokoro = None
    active_providers = []
    provider_fallback = None


app = FastAPI(title="Kokoro ONNX OpenAI-compatible TTS", lifespan=lifespan)


@app.get("/health")
async def health():
    if kokoro is None:
        raise HTTPException(status_code=503, detail="model_not_ready")
    return {
        "status": "healthy",
        "provider": active_providers,
        "openvino_device": os.getenv("KOKORO_OPENVINO_DEVICE"),
        "fallback": provider_fallback,
        "max_concurrency": MAX_CONCURRENCY,
    }


@app.get("/v1/audio/voices")
async def voices():
    if kokoro is None:
        raise HTTPException(status_code=503, detail="model_not_ready")
    return {"voices": [{"id": voice, "name": voice} for voice in kokoro.get_voices()]}


@app.post("/v1/audio/speech")
async def speech(request: SpeechRequest):
    if kokoro is None:
        raise HTTPException(status_code=503, detail="model_not_ready")
    if request.model not in {"kokoro", "tts-1", "tts-1-hd"}:
        raise HTTPException(status_code=400, detail="unsupported_model")
    if request.voice not in kokoro.get_voices():
        raise HTTPException(status_code=400, detail="unsupported_voice")

    content_type = {
        "wav": "audio/wav",
        "pcm": "audio/pcm",
        "mp3": "audio/mpeg",
        "opus": "audio/opus",
        "flac": "audio/flac",
        "aac": "audio/aac",
    }[request.response_format]

    if request.stream:
        if request.response_format != "pcm":
            raise HTTPException(status_code=400, detail="streaming_requires_pcm")
        return StreamingResponse(
            stream_pcm(request),
            media_type=content_type,
            headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
        )

    samples = await generate_chunk(request.input, request)
    return Response(encoded_bytes(samples, request.response_format), media_type=content_type)
