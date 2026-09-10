# RAG 백엔드 API — 메인 개발자 전달용

## 접속 정보

| 항목 | 값 |
|---|---|
| Base URL (같은 Wi-Fi) | `http://10.1.14.205:8000` |
| Base URL (Tailscale, VPN 밖에서도 접속 가능하면) | `http://100.89.97.39:8000` |
| 인증 헤더 | `X-API-Token: <토큰>` — 이 PC 안(127.0.0.1)에서는 생략 가능, **외부에서는 필수** |
| 토큰 값 | `.env` 의 `RAG_API_TOKEN` — 별도 채널로 전달 (이 문서/커밋에 넣지 않음) |

⚠️ 서버가 켜져 있는 동안만 접속됩니다. 이 노트북이 꺼지거나 Wi-Fi를 벗어나면 응답하지 않습니다.
⚠️ 같은 네트워크의 다른 기기도 이 IP로 접근할 수 있습니다(토큰 없이는 401).

---

## 1. GET /api/health — 인증 불필요

```bash
curl http://10.1.14.205:8000/api/health
```
```json
{
  "status": "ok",
  "models_loaded": true,
  "n_chunks": 6901,
  "local_chunks": 6928,
  "retrieval": "hybrid(qdrant_dense+local_bm25)",
  "vectorstore": {"collection": "material_rag", "points": 6901, "reachable": true},
  "llm": {"provider": "openrouter", "model": "google/gemini-3.1-flash-lite"},
  "auth_required": false,        // 이 요청자 기준 (로컬이면 false)
  "auth_required_remote": true   // 외부 요청자는 토큰 필요
}
```

## 2. POST /api/chat — 질문 1건 → 답변 1건 (비스트리밍)

```bash
curl -X POST http://10.1.14.205:8000/api/chat \
  -H "Content-Type: application/json" \
  -H "X-API-Token: <토큰>" \
  -d '{"question": "자재 입하 검수 절차를 알려주세요", "history": []}'
```

**요청**
```json
{
  "question": "string (필수)",
  "category": null,
  "history": [{"question": "이전 질문", "answer": "이전 답변"}]   // 최근 4턴만 사용, 생략 가능
}
```

**응답**
```json
{
  "question": "원본 질문",
  "rewritten_question": null,          // 후속질문 재작성이 일어났으면 재작성된 질문
  "answer": "마크다운 텍스트. 문장 끝에 [1][2] 형식 인용 번호",
  "no_answer": false,
  "citations": [
    {"index": 1, "chunk_id": "...", "file_name": "...",
     "source": "파일명 > 슬라이드 6 (제목)", "date": "2026-06-30",
     "snippet": "원문 일부", "score": 4.82}
  ],
  "metrics": {"total_ms": 7800, "embed_ms": 200, "retrieve_ms": 700,
              "rerank_ms": 3400, "generate_ms": 3400,
              "citation_coverage": 0.9, "input_tokens": 2800, "output_tokens": 300,
              "sql_ms": null, "sql_rows": null},
  "route": "rag",                       // "rag" | "sql" | "hybrid"
  "route_reason": {"route": "rag", "source": "rule", "confidence": 0.85, "reason": "..."},
  "trace": ["route", "embed", "retrieve", "rerank", "generate"]
}
```

응답시간: RAG 6~11초, 정형(SQL) 2~4초, hybrid 7~9초. 첫 요청(예열 전)은 최대 12초.

## 3. POST /api/chat/stream — NDJSON 스트리밍 (진행 표시 UI 용)

같은 요청 바디. 응답은 `application/x-ndjson`, 한 줄이 이벤트 1건.

```
{"type":"stage","name":"질의 분석","index":0,"ms":200}
{"type":"stage","name":"사내 문서 검색","index":1,"ms":700,"candidates":20}
{"type":"stage","name":"근거 정밀 선별","index":2,"ms":3400,"sources":5}
{"type":"delta","text":"자재 입하 "}          ← 답변 토큰이 도착하는 대로 반복
{"type":"delta","text":"및 검수 절차는..."}
{"type":"stage","name":"답변 작성","index":3,"ms":3400}
{"type":"result", ... }                       ← /api/chat 과 동일한 필드 전부
```
`route`(sql/hybrid)면 `{"type":"route",...}` 이벤트가 먼저 오고, SQL 단독이면 검색·선별 단계 없이 곧장 조회→답변으로 갑니다.

## 4. GET /dashboard — 데이터 분석 대시보드 (참고용, API 아님)

브라우저로 열면 됩니다. `/api/viz`, `/api/eval` 이 그 데이터를 제공합니다(집계 수치 JSON, 인증 불필요).

---

## 참고사항

- 한글 질문을 **터미널(curl)로 직접 보내면 인코딩이 깨질 수 있습니다.** 프론트엔드 코드(fetch/axios 등)로 보내면 문제없습니다.
- CORS: `null, http://localhost:8000, http://127.0.0.1:8000, http://localhost:5173, http://localhost:3000` 허용. 다른 origin에서 브라우저로 직접 호출하려면 `config/config.yaml` 의 `api.allowed_origins` 에 추가해야 합니다.
- 정형(SQL) 데이터는 연습용 샘플(자재 743종)입니다. 답변에 그 사실이 항상 한 줄 표기됩니다.
- 서버 재시작 시 첫 요청은 모델 로딩으로 10초 이상 걸릴 수 있습니다(예열 1회 권장).
