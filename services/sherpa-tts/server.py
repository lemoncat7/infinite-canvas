import gc
import io
import os
import threading
import wave
from array import array
from collections import OrderedDict

import sherpa_onnx
from fastapi import FastAPI, Form, HTTPException
from fastapi.responses import Response


MODEL_ROOT = os.environ.get("MODEL_ROOT", "/models")
NUM_THREADS = int(os.environ.get("SHERPA_NUM_THREADS", "4"))
MAX_CACHED_MODELS = int(os.environ.get("SHERPA_MAX_CACHED_MODELS", "2"))

VOICE_PROFILES = OrderedDict(
    [
        ("hero_male", {"name": "男主·沉稳青年", "model": "vits-zh-hf-fanchen-C", "file": "vits-zh-hf-fanchen-C.onnx"}),
        ("heroine", {"name": "女主·清晰坚定", "model": "vits-zh-hf-eula", "file": "eula.onnx"}),
        ("support_male", {"name": "男配·低沉有力", "model": "vits-zh-hf-doom", "file": "doom.onnx"}),
        ("support_female", {"name": "女配·冷静克制", "model": "vits-zh-hf-bronya", "file": "bronya.onnx"}),
        (
            "elder",
            {"name": "老者·沧桑睿智", "model": "vits-zh-hf-fanchen-ZhiHuiLaoZhe_new", "file": "vits-zh-hf-fanchen-ZhiHuiLaoZhe_new.onnx"},
        ),
        ("system", {"name": "系统·机械冷静", "model": "vits-zh-hf-zenyatta", "file": "zenyatta.onnx"}),
        ("narrator", {"name": "旁白·自然叙述", "model": "vits-melo-tts-zh_en", "file": "model.onnx"}),
    ]
)

cache = OrderedDict()
lock = threading.Lock()
app = FastAPI(title="Sherpa ONNX Multi-Voice TTS", version="2.0")


def build_tts(profile):
    model_name = profile["model"]
    model_dir = os.path.join(MODEL_ROOT, model_name)
    config = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                model=os.path.join(model_dir, profile["file"]),
                lexicon=os.path.join(model_dir, "lexicon.txt"),
                tokens=os.path.join(model_dir, "tokens.txt"),
                data_dir="",
            ),
            provider="cpu",
            num_threads=NUM_THREADS,
            debug=False,
        )
    )
    if not config.validate():
        raise RuntimeError(f"Invalid TTS model configuration: {model_name}")
    return sherpa_onnx.OfflineTts(config)


def get_tts(voice_id: str):
    profile = VOICE_PROFILES[voice_id]
    model_name = profile["model"]
    if model_name in cache:
        cache.move_to_end(model_name)
        return cache[model_name]
    tts = build_tts(profile)
    cache[model_name] = tts
    while len(cache) > MAX_CACHED_MODELS:
        cache.popitem(last=False)
        gc.collect()
    return tts


@app.get("/health")
def health():
    return {
        "status": "ok",
        "provider": "cpu",
        "voices": len(VOICE_PROFILES),
        "cached_models": list(cache.keys()),
    }


@app.get("/v1/voices")
def voices():
    return {
        "voices": [
            {"id": voice_id, "name": profile["name"], "model": profile["model"]}
            for voice_id, profile in VOICE_PROFILES.items()
        ]
    }


@app.post("/v1/tts")
def synthesize(
    text: str = Form(...),
    voice_id: str = Form("narrator"),
    speed: float = Form(1.0),
):
    text = text.strip()
    if not text:
        raise HTTPException(400, "text is required")
    if len(text) > 1000:
        raise HTTPException(400, "text is too long")
    if voice_id == "0":
        voice_id = "narrator"
    if voice_id not in VOICE_PROFILES:
        raise HTTPException(400, "invalid voice_id")
    if not 0.5 <= speed <= 2.0:
        raise HTTPException(400, "speed must be between 0.5 and 2.0")

    with lock:
        tts = get_tts(voice_id)
        audio = tts.generate(text, sid=0, speed=speed)

    pcm = array(
        "h",
        (
            max(-32768, min(32767, round(float(sample) * 32767)))
            for sample in audio.samples
        ),
    )
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(audio.sample_rate)
        wav.writeframes(pcm.tobytes())
    return Response(
        output.getvalue(),
        media_type="audio/wav",
        headers={"X-Voice-Id": voice_id, "X-Sample-Rate": str(audio.sample_rate)},
    )
