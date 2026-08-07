#!/bin/sh
set -eu

model_path="${MODEL_PATH:-/models/kokoro-v1.0.onnx}"
voices_path="${VOICES_PATH:-/models/voices-v1.0.bin}"

mkdir -p "$(dirname "$model_path")" "$(dirname "$voices_path")"

download_if_missing() {
  url="$1"
  destination="$2"
  temporary="${destination}.part"
  if [ ! -s "$destination" ]; then
    rm -f "$temporary"
    curl --fail --location --retry 5 --retry-delay 2 --connect-timeout 15 \
      --output "$temporary" "$url"
    mv "$temporary" "$destination"
  fi
}

download_if_missing \
  "${KOKORO_MODEL_URL:-https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/kokoro-v1.0.onnx}" \
  "$model_path"
download_if_missing \
  "${KOKORO_VOICES_URL:-https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/voices-v1.0.bin}" \
  "$voices_path"

exec /app/.venv/bin/python -m uvicorn app:app --host 0.0.0.0 --port 8880
