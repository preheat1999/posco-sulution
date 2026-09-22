#!/bin/sh
set -e

python -c "
from huggingface_hub import snapshot_download
import os
snapshot_download(
    repo_id='HyejungKim/posco-rag-data',
    repo_type='dataset',
    local_dir='/app',
    token=os.environ['HF_TOKEN'],
)
print('data downloaded')
"

exec uvicorn api:app --app-dir src --host 0.0.0.0 --port ${PORT:-10000}
