#!/bin/sh
set -eu

root=/opt/GPT-SoVITS
model_root="$root/GPT_SoVITS/pretrained_models"
base='https://www.modelscope.cn/models/XXXXRT/GPT-SoVITS-Pretrained/resolve/master/pretrained_models'

fetch() {
  relative="$1"
  target="$model_root/$relative"
  if [ ! -s "$target" ]; then
    mkdir -p "$(dirname "$target")"
    curl --fail --location --retry 8 --retry-delay 3 --output "$target.part" "$base/$relative"
    mv "$target.part" "$target"
  fi
}

fetch chinese-hubert-base/config.json
fetch chinese-hubert-base/preprocessor_config.json
fetch chinese-hubert-base/pytorch_model.bin
fetch chinese-roberta-wwm-ext-large/config.json
fetch chinese-roberta-wwm-ext-large/tokenizer.json
fetch chinese-roberta-wwm-ext-large/pytorch_model.bin
fetch fast_langdetect/lid.176.bin
fetch gsv-v2final-pretrained/s1bert25hz-5kh-longer-epoch=12-step=369668.ckpt
fetch gsv-v2final-pretrained/s2G2333k.pth

mkdir -p /models/references
if [ ! -s /models/references/default.wav ]; then
  curl --fail --location --retry 8 --output /models/references/default.wav \
    https://raw.githubusercontent.com/FunAudioLLM/CosyVoice/main/asset/zero_shot_prompt.wav
fi

exec python api_v2.py -a 0.0.0.0 -p 9880
