FROM dockerproxy.net/library/python:3.10-slim-bookworm

ARG HTTPS_PROXY
ARG HTTP_PROXY
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    MODEL_DIR=/models/CosyVoice2-0.5B \
    MODELSCOPE_CACHE=/models/cache \
    OMP_NUM_THREADS=3 \
    MKL_NUM_THREADS=3

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential curl git git-lfs libsndfile1 libsox-dev sox && \
    rm -rf /var/lib/apt/lists/* && git lfs install

WORKDIR /opt
RUN git clone --depth 1 --recursive https://github.com/FunAudioLLM/CosyVoice.git
WORKDIR /opt/CosyVoice

RUN pip install --no-cache-dir 'pip<26' 'setuptools<70' wheel && \
    pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu \
      torch==2.3.1 torchaudio==2.3.1 && \
    sed -e '/^--extra-index-url/d' \
        -e '/^deepspeed/d' \
        -e '/^onnxruntime-gpu/d' \
        -e '/^tensorrt/d' \
        -e '/^torch==/d' \
        -e '/^torchaudio==/d' \
        -e '/^gradio==/d' \
        -e '/^fastapi-cli==/d' \
        -e '/^gdown==/d' \
        -e '/^grpcio/d' \
        -e '/^pyarrow==/d' \
        -e '/^pyworld==/d' \
        -e '/^tensorboard==/d' \
        -e '/^openai-whisper==/d' requirements.txt > /tmp/requirements-cpu.txt && \
    pip install --no-cache-dir -r /tmp/requirements-cpu.txt && \
    pip install --no-cache-dir tiktoken && \
    pip install --no-cache-dir --no-build-isolation --no-deps openai-whisper==20231117 && \
    pip install --no-cache-dir onnxruntime==1.18.0 python-multipart gdown

# CosyVoice's YAML configuration imports the dataset processor at startup.
# Keep pyarrow separate so small runtime dependency changes retain the main layer.
RUN pip install --no-cache-dir pyarrow==18.1.0 pyworld==0.3.4

COPY server.py /opt/CosyVoice/cosyvoice_cpu_server.py
COPY start.sh /usr/local/bin/start-cosyvoice2
RUN chmod +x /usr/local/bin/start-cosyvoice2

EXPOSE 50000
HEALTHCHECK --interval=20s --timeout=5s --start-period=15m --retries=3 \
  CMD curl -fsS http://127.0.0.1:50000/health || exit 1
CMD ["start-cosyvoice2"]
