import io
import os
import threading
import wave
from array import array

import sherpa_onnx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response


ROOT = os.environ.get(
    "ZIPVOICE_MODEL_DIR",
    "/models/sherpa-onnx-zipvoice-distill-int8-zh-en-emilia",
)
VOCODER = os.environ.get("ZIPVOICE_VOCODER", "/models/vocos_24khz.onnx")
NUM_THREADS = int(os.environ.get("SHERPA_NUM_THREADS", "4"))

config = sherpa_onnx.OfflineTtsConfig(
    model=sherpa_onnx.OfflineTtsModelConfig(
        zipvoice=sherpa_onnx.OfflineTtsZipvoiceModelConfig(
            tokens=os.path.join(ROOT, "tokens.txt"),
            encoder=os.path.join(ROOT, "encoder.int8.onnx"),
            decoder=os.path.join(ROOT, "decoder.int8.onnx"),
            vocoder=VOCODER,
            data_dir=os.path.join(ROOT, "espeak-ng-data"),
            lexicon=os.path.join(ROOT, "lexicon.txt"),
        ),
        provider="cpu",
        num_threads=NUM_THREADS,
        debug=False,
    )
)
if not config.validate():
    raise RuntimeError("Invalid ZipVoice model configuration")

tts = sherpa_onnx.OfflineTts(config)
lock = threading.Lock()
app = FastAPI(title="Sherpa ONNX ZipVoice TTS", version="1.0")


def read_pcm_wav(data: bytes):
    with wave.open(io.BytesIO(data), "rb") as wav:
        if wav.getsampwidth() != 2:
            raise HTTPException(400, "reference_wav must be 16-bit PCM WAV")
        channels = wav.getnchannels()
        sample_rate = wav.getframerate()
        pcm = array("h")
        pcm.frombytes(wav.readframes(wav.getnframes()))
    if channels > 1:
        pcm = array("h", pcm[::channels])
    return [sample / 32768.0 for sample in pcm], sample_rate


def encode_wav(samples, sample_rate: int):
    pcm = array(
        "h",
        (
            max(-32768, min(32767, round(float(sample) * 32767)))
            for sample in samples
        ),
    )
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm.tobytes())
    return output.getvalue()


@app.get("/health")
def health():
    return {"status": "ok", "provider": "cpu", "model": "zipvoice-distill-int8"}


@app.post("/v1/tts")
async def synthesize(
    text: str = Form(...),
    reference_text: str = Form(...),
    reference_wav: UploadFile = File(...),
    num_steps: int = Form(4),
):
    text = text.strip()
    reference_text = reference_text.strip()
    if not text or not reference_text:
        raise HTTPException(400, "text and reference_text are required")
    if len(text) > 1000:
        raise HTTPException(400, "text is too long")
    if not 1 <= num_steps <= 16:
        raise HTTPException(400, "num_steps must be between 1 and 16")

    reference_audio, sample_rate = read_pcm_wav(await reference_wav.read())
    generation = sherpa_onnx.GenerationConfig()
    generation.reference_audio = reference_audio
    generation.reference_sample_rate = sample_rate
    generation.reference_text = reference_text
    generation.num_steps = num_steps
    generation.extra["min_char_in_sentence"] = "30"

    with lock:
        audio = tts.generate(text, generation)
    if not audio.samples:
        raise HTTPException(500, "generation returned no audio")
    return Response(
        encode_wav(audio.samples, audio.sample_rate),
        media_type="audio/wav",
        headers={"X-Sample-Rate": str(audio.sample_rate)},
    )
