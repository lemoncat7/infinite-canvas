#!/bin/sh
set -eu

root=/models/sherpa-onnx-zipvoice-distill-int8-zh-en-emilia
archive=/models/sherpa-onnx-zipvoice-distill-int8-zh-en-emilia.tar.bz2
vocoder=/models/vocos_24khz.onnx

mkdir -p /models
if [ ! -f "$root/encoder.int8.onnx" ]; then
  curl -fL --retry 8 --retry-delay 3 --connect-timeout 30 \
    -o "$archive.part" \
    https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-zipvoice-distill-int8-zh-en-emilia.tar.bz2
  mv "$archive.part" "$archive"
  tar -xjf "$archive" -C /models
  rm -f "$archive"
fi
if [ ! -f "$vocoder" ]; then
  curl -fL --retry 8 --retry-delay 3 --connect-timeout 30 \
    -o "$vocoder.part" \
    https://github.com/k2-fsa/sherpa-onnx/releases/download/vocoder-models/vocos_24khz.onnx
  mv "$vocoder.part" "$vocoder"
fi

exec uvicorn zipvoice_server:app --host 0.0.0.0 --port 8001 --workers 1
