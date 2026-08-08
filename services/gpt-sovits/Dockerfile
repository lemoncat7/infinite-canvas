FROM dockerproxy.net/mwader/static-ffmpeg:7.1 AS ffmpeg
FROM dockerproxy.net/library/python:3.10-slim-bookworm

ARG HTTP_PROXY
ARG HTTPS_PROXY
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    OMP_NUM_THREADS=3 \
    MKL_NUM_THREADS=3 \
    is_half=false \
    version=v2

COPY --from=ffmpeg /ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg /ffprobe /usr/local/bin/ffprobe

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl git libsndfile1 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /opt
RUN git clone --depth 1 https://github.com/RVC-Boss/GPT-SoVITS.git
WORKDIR /opt/GPT-SoVITS

RUN pip install --no-cache-dir --upgrade 'pip<26' 'setuptools<81' wheel && \
    pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu \
      torch==2.3.1 torchaudio==2.3.1

RUN sed -i 's/^import jieba_fast$/import jieba as jieba_fast/' GPT_SoVITS/text/chinese.py && \
    sed -i 's/^import jieba_fast.posseg as psg$/import jieba.posseg as psg/' GPT_SoVITS/text/chinese.py && \
    sed -i 's/^import jieba_fast$/import jieba as jieba_fast/' GPT_SoVITS/text/chinese2.py && \
    sed -i 's/^import jieba_fast.posseg as psg$/import jieba.posseg as psg/' GPT_SoVITS/text/chinese2.py && \
    sed -i 's/^import jieba_fast as jieba$/import jieba/' GPT_SoVITS/text/tone_sandhi.py && \
    sed -e '/^--no-binary=/d' \
        -e '/^onnxruntime-gpu/d' \
        -e '/^torchaudio$/d' \
        -e '/^tensorboard$/d' \
        -e '/^pytorch-lightning/d' \
        -e '/^funasr/d' \
        -e '/^modelscope$/d' \
        -e '/^jieba_fast$/d' \
        -e '/^pyopenjtalk/d' \
        -e '/^g2pk2/d' \
        -e '/^ko_pron/d' \
        -e '/^python_mecab_ko/d' requirements.txt > /tmp/requirements-cpu.txt && \
    sed -i \
        -e '/^gradio/d' \
        -e '/^ctranslate2/d' \
        -e '/^av>/d' \
        -e '/^x_transformers/d' \
        -e '/^torchmetrics/d' \
        -e '/^rotary_embedding_torch/d' \
        -e 's/^fastapi\[standard\]/fastapi/' \
        /tmp/requirements-cpu.txt && \
    printf 'torch==2.3.1\ntorchaudio==2.3.1\n' > /tmp/constraints-cpu.txt && \
    pip install --no-cache-dir -c /tmp/constraints-cpu.txt -r /tmp/requirements-cpu.txt && \
    pip install --no-cache-dir -c /tmp/constraints-cpu.txt \
      'rotary_embedding_torch==0.6.5' 'x_transformers==1.40.1' \
      'torchmetrics==1.5.0' 'pytorch-lightning==2.4.0' 'peft==0.17.1' \
      matplotlib uvicorn python-multipart && \
    pip install --no-cache-dir onnxruntime==1.18.0

COPY start.sh /usr/local/bin/start-gpt-sovits
RUN chmod +x /usr/local/bin/start-gpt-sovits

EXPOSE 9880
HEALTHCHECK --interval=20s --timeout=5s --start-period=20m --retries=3 \
  CMD curl -fsS http://127.0.0.1:9880/docs >/dev/null || exit 1
CMD ["start-gpt-sovits"]
