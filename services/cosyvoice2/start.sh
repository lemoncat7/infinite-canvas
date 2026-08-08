#!/bin/sh
set -eu

if [ ! -f "$MODEL_DIR/cosyvoice2.yaml" ]; then
  python -c "from modelscope import snapshot_download; snapshot_download('iic/CosyVoice2-0.5B', local_dir='$MODEL_DIR')"
fi

exec python /opt/CosyVoice/cosyvoice_cpu_server.py --model-dir "$MODEL_DIR" --port 50000
