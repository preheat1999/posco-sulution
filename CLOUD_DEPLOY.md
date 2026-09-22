# 클라우드 상시 배포 (DigitalOcean)

로컬 PC를 꺼도 챗봇이 계속 동작하도록 DigitalOcean Droplet에 배포한 기록입니다.
현재 운영 중인 서버: `https://146-190-103-77.sslip.io` (sslip.io는 IP를 그대로 도메인으로
쓰게 해주는 무료 서비스라 별도 도메인 구매 없이 HTTPS를 붙일 수 있다)

## 서버 사양

- DigitalOcean Droplet, Ubuntu 22.04, 2GB RAM / 1 vCPU / 50GB Disk ($12/mo)
- BGE-M3 임베딩 모델 로딩 시 메모리가 순간적으로 2GB를 넘어서, **스왑 5GB를 추가하지 않으면
  OOM(메모리 부족)으로 죽는다.** 4GB RAM 이상 인스턴스라면 스왑 없이도 될 가능성이 높다.
- 2GB RAM에서는 스왑을 쓰기 때문에 응답이 조금 느려질 수 있다(테스트 시 약 16초, 정상 범위
  안쪽이지만 여유는 없는 편).

## 구성 요소

1. **앱 코드**: 이 저장소(`feat/rag` 브랜치)를 그대로 clone
2. **비밀값(.env)**: 저장소가 공개라서 `.env`는 git에 없다. 배포할 서버에 직접
   `.env.example`을 참고해서 새로 만들어야 한다. 필요한 키:
   - `OPENROUTER_API_KEY`, `QDRANT_URL`, `QDRANT_API_KEY`, `RAG_API_TOKEN`
   - `HF_TOKEN` — 아래 "대외비 데이터" 절 때문에 추가로 필요 (기존 `.env.example`에는 없음)
3. **대외비 데이터(`data/`)**: `.gitignore`로 커밋이 막혀 있다(사내 문서라 공개 저장소에
   올리면 안 됨). 대신 **비공개 Hugging Face Dataset**(`HyejungKim/posco-rag-data`)에
   올려두고, 서버가 시작할 때 `HF_TOKEN`으로 내려받는다. 아래 "데이터 내려받기" 참고.
   같은 이유로 이 방식을 쓰지 않는 배포 플랫폼(Render 등 파일 업로드 수단이 없는 곳)은
   이 프로젝트에 못 쓴다 — SSH나 이에 준하는 파일 전달 수단이 있는 곳이어야 한다.
4. **모델**: `HF_HUB_CACHE=/app/models` 로 지정해두면 최초 실행 시 공개 모델(BGE-M3,
   리랭커)이 자동으로 캐시된다. 별도 준비 불필요.
5. **HTTPS**: Caddy가 sslip.io 도메인으로 Let's Encrypt 인증서를 자동 발급한다.
6. **상시 실행**: systemd 서비스(`posco-rag.service`)로 등록 — 크래시하거나 서버가
   재부팅돼도 자동으로 다시 뜬다.

## 처음부터 다시 설치할 때 (요약)

```bash
# 1) 스왑 (2GB RAM 인스턴스라면 필수)
fallocate -l 5G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# 2) 패키지
apt-get update && apt-get install -y python3.11 python3.11-venv git build-essential libgomp1 ufw

# 3) 코드
git clone --branch feat/rag --single-branch https://github.com/preheat1999/posco-sulution.git /app
cd /app
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 4) .env 직접 작성 (.env.example + HF_TOKEN 참고)
#    vi /app/.env

# 5) 대외비 데이터 내려받기
.venv/bin/python -c "
from huggingface_hub import snapshot_download
import os
snapshot_download(repo_id='HyejungKim/posco-rag-data', repo_type='dataset',
                   local_dir='/app', token=os.environ['HF_TOKEN'])
"

# 6) systemd 서비스 등록 (아래 유닛 파일을 /etc/systemd/system/posco-rag.service 에 저장)
systemctl daemon-reload && systemctl enable --now posco-rag

# 7) Caddy로 HTTPS (아래 Caddyfile을 /etc/caddy/Caddyfile 에 저장 후)
systemctl restart caddy

# 8) 방화벽
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
```

### systemd 유닛 (`/etc/systemd/system/posco-rag.service`)

```ini
[Unit]
Description=POSCO RAG Chatbot API
After=network.target

[Service]
Type=simple
WorkingDirectory=/app
Environment=HF_HUB_CACHE=/app/models
ExecStart=/app/.venv/bin/python scripts/run_server.py 0.0.0.0
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### Caddyfile (`/etc/caddy/Caddyfile`)

```
<서버 Public IP를 하이픈으로 바꾼 값>.sslip.io {
    reverse_proxy localhost:8000
}
```

예: IP가 `146.190.103.77`이면 `146-190-103-77.sslip.io`

## 서버를 옮기거나(IP가 바뀌거나) 사양을 올릴 때

- IP가 바뀌면 sslip.io 도메인도 같이 바뀐다 (`Caddyfile` 다시 쓰고 `systemctl restart caddy`).
- 응답이 계속 느리면 Droplet을 4GB RAM으로 리사이즈하는 걸 권장 (DigitalOcean 대시보드에서
  Droplet 끄고 Resize → 재기동, 몇 분이면 된다). 4GB면 스왑 없이도 안정적일 가능성이 높다.
- 프론트엔드(`assets/config.js`)의 `CHAT_API` 값도 새 주소로 바꿔야 한다.
