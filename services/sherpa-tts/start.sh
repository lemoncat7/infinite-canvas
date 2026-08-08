#!/bin/sh
set -eu

mkdir -p /models

models="
vits-melo-tts-zh_en
vits-zh-hf-fanchen-C
vits-zh-hf-eula
vits-zh-hf-doom
vits-zh-hf-bronya
vits-zh-hf-fanchen-ZhiHuiLaoZhe_new
vits-zh-hf-zenyatta
"

for name in $models; do
  model_dir="/models/$name"
  archive="/models/$name.tar.bz2"
  if [ -f "$model_dir/model.onnx" ]; then
    continue
  fi
  if [ ! -f "$archive" ]; then
    curl -fL --retry 8 --retry-delay 3 --connect-timeout 30 \
      -o "$archive.part" \
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/$name.tar.bz2"
    mv "$archive.part" "$archive"
  fi
  tar -xjf "$archive" -C /models
  rm -f "$archive"
done

exec uvicorn server:app --host 0.0.0.0 --port 8000 --workers 1
