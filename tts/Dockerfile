FROM ghcr.io/remsky/kokoro-fastapi-cpu:v0.7.1

ARG ORT_PACKAGE=onnxruntime

USER root
WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN uv pip install --python /app/.venv/bin/python --no-cache -r requirements.txt \
    && if [ "$ORT_PACKAGE" != "onnxruntime" ]; then \
         uv pip uninstall --python /app/.venv/bin/python onnxruntime \
         && uv pip install --python /app/.venv/bin/python --no-cache "$ORT_PACKAGE"; \
       fi

COPY app.py entrypoint.sh /app/

RUN chmod +x /app/entrypoint.sh \
    && chown 1000:1000 /app/app.py /app/entrypoint.sh

ENV MODEL_PATH=/models/kokoro-v1.0.onnx \
    VOICES_PATH=/models/voices-v1.0.bin \
    ONNX_PROVIDER=CPUExecutionProvider \
    PYTHONUNBUFFERED=1

EXPOSE 8880

USER 1000
CMD ["/app/entrypoint.sh"]
