FROM dockerproxy.net/library/python:3.11-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    MODEL_DIR=/models/vits-melo-tts-zh_en \
    SHERPA_NUM_THREADS=4

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl bzip2 && \
    rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir --timeout 180 --retries 8 \
      --index-url https://pypi.org/simple \
      sherpa-onnx==1.13.4 fastapi==0.116.1 uvicorn==0.35.0 python-multipart==0.0.20

WORKDIR /app
COPY server.py /app/server.py
COPY start.sh /usr/local/bin/start-sherpa-tts
RUN chmod +x /usr/local/bin/start-sherpa-tts

EXPOSE 8000
HEALTHCHECK --interval=20s --timeout=5s --start-period=3m --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/health || exit 1

CMD ["start-sherpa-tts"]
