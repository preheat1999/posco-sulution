# 프론트엔드 연동 자료 — 같은 Wi-Fi 팀원 전달용

> 백엔드(RAG 챗봇)는 이미 완성돼 이 노트북에서 돌고 있습니다. 프론트엔드 팀원은
> 아래 정보로 연결만 하면 됩니다. **이 파일 전체를 그대로 전달**하세요.

---

## 0. 연결 정보 (지금 바로 필요한 것)

| 항목 | 값 |
|---|---|
| 서버 주소 | `http://10.1.14.205:8000` |
| 접근 토큰 | 별도로 전달받은 값 (`X-API-Token` 헤더에 넣는다) |
| 조건 | **같은 Wi-Fi에 접속돼 있어야 한다.** 노트북이 켜져 있고 서버가 떠 있어야 한다 |

먼저 브라우저 주소창에 아래를 쳐서 살아있는지 확인하세요:
```
http://10.1.14.205:8000/api/health
```
`"status":"ok"` 가 보이면 정상입니다. 안 보이면 3절 "연결이 안 될 때"를 보세요.

---

## 1. [여기부터 복사] — 팀원이 자기 Claude Code에 붙여넣을 프롬프트

```
내 프론트엔드 화면에 사내 RAG 챗봇을 붙이려고 해. 백엔드는 이미 만들어져 있고
나는 화면(디자인)만 구현하면 되는 구조야.

## 연결 정보
- 챗봇 서버 주소: http://10.1.14.205:8000
- 접근 토큰: (전달받은 값을 여기에 채워서 사용, X-API-Token 헤더)

## 먼저 연결 확인해줘
1. http://10.1.14.205:8000/api/health 를 fetch 로 호출해봐줘.
   - status: "ok", models_loaded: true 가 나오면 정상이야.
   - auth_required 는 내 브라우저(외부) 기준으로 true 로 나올 거야 — 그건 정상이고,
     /api/chat 호출할 때 X-API-Token 헤더만 잊지 않으면 돼.
2. 연결이 안 되면 (CORS 에러거나 fetch 자체가 실패하면) 아래 "문제 해결" 섹션을 보고
   원인을 알려줘. 임의로 우회하지 말고 나한테 먼저 물어봐줘.

## API 명세

GET /api/health   (인증 불필요)
  {"status":"ok","models_loaded":true,"n_chunks":6901,
   "retrieval":"hybrid(qdrant_dense+local_bm25)",
   "llm":{"provider":"openrouter","model":"google/gemini-3.1-flash-lite"},
   "auth_required":true}   ← 외부(우리 기준)에서는 true, 토큰 필요하다는 뜻

POST /api/chat    (X-API-Token 헤더 필요)
  요청  {"question":"자재 입하 검수 절차를 알려주세요","category":null,"history":[]}
  응답  {
    "question": "...",
    "rewritten_question": null,   // 후속 질문을 재해석했으면 여기 재작성된 질문이 온다
    "answer": "1. 기자재반입센터에서 납품서류 접수 확인 [1].\n2. ...",  // 마크다운 + [n] 인용
    "no_answer": false,        // true 면 "문서에서 근거를 못 찾음" — 반드시 다르게 표시
    "citations": [
      { "index": 1, "chunk_id": "...", "file_name": "...",
        "source": "자재입하 및 저장관리 지침(V45).pptx > 슬라이드 6 (5.1.2 업무 내용)",
        "date": "2026-06-30", "snippet": "원문 일부", "score": 4.82 }
    ],
    "metrics": {"total_ms":9455,"retrieve_ms":1466,"rerank_ms":1600,"generate_ms":4800,
                "citation_coverage":0.8,"input_tokens":2800,"output_tokens":195},
    "route": "rag",            // "rag" | "sql" | "hybrid" — sql/hybrid 는 표(마크다운 테이블)가 섞여 온다
    "trace": ["route","embed","retrieve","rerank","generate"]
  }

POST /api/chat/stream  (있으면 이걸 쓰는 게 좋다 — 진행 표시가 되어 체감이 훨씬 낫다)
  같은 요청 형식. 응답은 NDJSON(줄 단위 JSON) 스트림이야. 한 줄 = 이벤트 1건.
    {"type":"stage","name":"질의 분석","index":0,"ms":200}
    {"type":"stage","name":"사내 문서 검색","index":1,"ms":700,"candidates":20}
    {"type":"stage","name":"근거 정밀 선별","index":2,"ms":3400,"sources":5}
    {"type":"delta","text":"자재 입하 "}      ← 답변 토큰이 도착하는 대로 반복해서 온다
    {"type":"delta","text":"및 검수 절차는..."}
    {"type":"stage","name":"답변 작성","index":3,"ms":3400}
    {"type":"result", ...}                    ← /api/chat 과 완전히 같은 필드의 최종 객체
  route 가 sql/hybrid 면 맨 앞에 {"type":"route",...} 이벤트가 하나 더 온다.
  스트림은 fetch 의 response.body.getReader() 로 받아서, 줄바꿈 기준으로 잘라 JSON.parse 하면 돼.

## 하고 싶은 것
채팅 UI 를 내 디자인 시스템(내가 이미 만든 버튼/카드/색상)에 맞춰 만들어줘.
컴포넌트는 [여기에 컴포넌트/페이지 이름을 적어줘, 예: ChatPanel.tsx] 안에 넣어줘.

## 반드시 지켜야 할 것 (중요)
- 답변 하나에 6~11초가 걸려(정형 질문은 2~4초). 사내 문서를 검색하고 정밀하게
  재정렬하는 단계 때문에 느린 거고 정상 동작이야. 스트리밍 엔드포인트를 써서 진행
  단계를 반드시 화면에 표시해줘. 스피너만 돌리면 사용자가 멈춘 줄 알아.
- citations 배열이 답변의 출처야. answer 안의 [1] [2] 같은 인용 번호와
  citations[].index 가 1:1 로 매칭돼. 이 연결을 반드시 살려줘 — 인용 번호를 클릭하면
  해당 출처가 보이게. 출처 없는 답변처럼 보이면 안 돼.
- no_answer 가 true 면 "문서에서 근거를 못 찾음"이라는 뜻이야. 일반 답변과 시각적으로
  구분해줘 (다른 배경색, 아이콘, 경고 톤).
- 마크다운 렌더링(표, 목록, 굵게)이 필요해. 이미 쓰는 마크다운 라이브러리가 있으면
  그걸 쓰고, 없으면 marked 같은 가벼운 걸 추가해줘.
  순서: 마크다운 렌더링 → 그 다음에 [n] 인용을 클릭 요소로 변환.
- 전송 버튼은 응답 오는 동안 비활성화해줘. 서버가 한 번에 한 질문씩 처리해서,
  연속으로 보내면 앞 질문이 끝날 때까지 대기열에 쌓여.
- route 가 "sql" 또는 "hybrid" 인 답변에는 마크다운 표가 들어있어. 표 스타일을 꼭 잡아줘.
- rewritten_question 이 null 이 아니면 "앞 대화를 반영해 ○○○ 로 이해하고 검색했습니다"
  처럼 한 줄 안내를 보여주면 좋아 (필수는 아님).

## 문제 해결 (CORS 에러가 나면)
브라우저 콘솔에 "blocked by CORS policy" 가 뜨면, 내 dev 서버 포트가 서버 쪽에
허용 안 돼 있는 거야. localhost:5173(Vite 기본)과 localhost:3000(Next/CRA 기본)은
이미 허용돼 있으니 그 포트로 뜨면 바로 될 거야. 다른 포트를 쓰고 있다면 몇 번인지
알려줘 — 백엔드 담당자한테 config 의 api.allowed_origins 에 추가해달라고 요청할게.

## 진행 방식
먼저 /api/health 로 연결을 확인하고, 내 기존 컴포넌트 구조에 맞춘 통합 계획을
짧게 설명해주고 진행해줘.
```

## [복사 끝]

---

## 2. curl로 먼저 손으로 확인해보고 싶다면

```bash
# 1) 헬스체크 (토큰 불필요)
curl http://10.1.14.205:8000/api/health

# 2) 채팅 (토큰 필요, <TOKEN> 자리에 전달받은 값)
curl -X POST http://10.1.14.205:8000/api/chat \
  -H "Content-Type: application/json" \
  -H "X-API-Token: <TOKEN>" \
  -d '{"question": "hello", "history": []}'
```
⚠️ 한글 질문을 터미널(curl)로 직접 보내면 인코딩이 깨질 수 있습니다. 브라우저 fetch/axios로는 문제없습니다.

---

## 3. 연결이 안 될 때 — 원인별 확인 순서

| 증상 | 원인 | 확인/조치 |
|---|---|---|
| `/api/health` 자체가 안 열림 (타임아웃) | 다른 Wi-Fi에 있거나, 서버가 꺼져 있음 | 같은 Wi-Fi인지 확인. 백엔드 담당자에게 서버 켜져 있는지 문의 |
| 브라우저 콘솔 "blocked by CORS policy" | dev 서버 포트가 허용 목록에 없음 | 아래 CORS 표 참고. 포트 번호를 백엔드 담당자에게 전달 |
| `/api/chat` 이 401 | 토큰 누락/오타 | `X-API-Token` 헤더 값 재확인. `/api/health` 는 토큰 없이도 200이 정상 |
| 응답이 5~15초 걸림 | **정상 동작** | 사내 문서 검색+재정렬 때문. 스트리밍으로 진행 표시할 것 |
| 한 번에 여러 질문을 보내면 이상해짐 | 서버가 순차 처리 | 전송 버튼을 응답 오는 동안 비활성화 |

### CORS 허용 포트 (현재 서버 설정)

| 포트 | 프레임워크 | 상태 |
|---|---|---|
| `localhost:5173` | Vite (React/Vue 기본) | ✅ 허용됨 |
| `localhost:3000` | Next.js / CRA 기본 | ✅ 허용됨 |
| `localhost:8000` | — | ✅ 허용됨 |
| 그 외 포트 (4200 Angular 등) | | ❌ 추가 필요 — 포트 번호를 알려주면 백엔드에서 1분 안에 추가·재기동 가능 |

**팀원이 자기 브라우저에서 `localhost:PORT`로 접속해서 쓰는 한(자기 PC에서 자기 dev 서버를 여는 일반적인 경우) 이 표만으로 충분합니다.** 팀원이 IP 주소로 자기 dev 서버를 열 경우에만 별도 조정이 필요합니다 — 그런 경우면 알려주세요.

---

## 4. 참고 — 이 챗봇이 하는 일 (화면 설계에 참고)

- 사내 문서 30건(지침·매뉴얼·계약서·FAQ)을 근거로 답한다. 모든 사실 문장에 `[n]` 인용이 붙는다.
- 근거가 없으면 "제공된 사내 문서에서 해당 내용을 찾을 수 없습니다" 라고 답한다 (`no_answer: true`).
- 정형 데이터(자재 재고·리드타임 등) 질문은 `route: "sql"` 로 빠르게(2~4초) 표로 답한다. 연습용 샘플 데이터라는 문구가 답변에 항상 포함된다.
- 최근 4턴까지 대화 맥락을 이해한다(`history` 로 보내면 됨). 지시어(그건/그럼 등)가 섞인 후속 질문은 서버가 알아서 재해석한다.

---

## 5. 백엔드 쪽 참고 (자신에게 남기는 메모)

- 서버 기동: `.venv\Scripts\python.exe scripts\run_server.py 0.0.0.0`
- 종료: `scripts\stop_server.cmd` (Windows에서 `pkill -f` 안 먹으므로 이 스크립트로)
- 두 번 띄우면 먼저 뜬 프로세스가 포트를 잡아 새 코드가 반영 안 됨 — 항상 종료 후 재기동
- CORS 포트 추가 시: `config/config.yaml` 의 `api.allowed_origins` 에 한 줄 추가 → 서버 재기동
  (사내망 전체를 한 번에 열려면 `allowed_origin_regex: "^http://192\\.168\\.\\d+\\.\\d+:(3000|5173|8000)$"` 같은 정규식 사용 가능. 단, 지금 이 PC의 실제 대역은 `10.1.14.x` 이므로 그에 맞게 수정할 것)
- 더 상세한 스키마·인증정책은 `API_HANDOFF.md` 참고
