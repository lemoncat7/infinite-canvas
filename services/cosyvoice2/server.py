import argparse
import os
import sys
import threading

import numpy as np
import uvicorn
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import StreamingResponse

ROOT = "/opt/CosyVoice"
sys.path.insert(0, ROOT)
sys.path.insert(0, f"{ROOT}/third_party/Matcha-TTS")

from cosyvoice.cli.cosyvoice import AutoModel
from cosyvoice.utils.file_utils import load_wav

app = FastAPI(title="CosyVoice2 CPU Internal API")
model = None
model_lock = threading.Lock()


def pcm_stream(outputs):
    for output in outputs:
        audio = output["tts_speech"].detach().cpu().numpy()
        yield (audio * 32767).clip(-32768, 32767).astype(np.int16).tobytes()


@app.get("/health")
def health():
    return {"ok": model is not None, "model": "CosyVoice2-0.5B", "device": "cpu"}


@app.post("/v1/tts/zero-shot")
def zero_shot(
    text: str = Form(...),
    prompt_text: str = Form(...),
    prompt_wav: UploadFile = File(...),
    stream: bool = Form(True),
):
    prompt_audio = load_wav(prompt_wav.file, 16000)

    def generate():
        with model_lock:
            yield from pcm_stream(
                model.inference_zero_shot(text, prompt_text, prompt_audio, stream=stream)
            )

    return StreamingResponse(
        generate(),
        media_type="audio/L16;rate=24000;channels=1",
        headers={"X-Audio-Format": "pcm_s16le", "X-Audio-Sample-Rate": "24000"},
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", default=os.environ.get("MODEL_DIR"))
    parser.add_argument("--port", type=int, default=50000)
    args = parser.parse_args()
    model = AutoModel(model_dir=args.model_dir, load_jit=False, load_trt=False, load_vllm=False, fp16=False)
    uvicorn.run(app, host="0.0.0.0", port=args.port, workers=1)
