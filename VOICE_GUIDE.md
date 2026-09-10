# 음성 · 명령 Agent 사용 안내

챗봇 서랍(✦ AI 자재 질의)의 🎤 버튼으로 말하면 글자가 되고, 그 뒤는 글로 친 것과 같은 길을 간다.
음성 전용 Agent 는 없다 · 기존 라우터가 **등록된 action** 만 고르고, 브라우저가 실행한다.

```
마이크 ─► voice.js ─► 글자 ─► chat.js ask()
                                 ├ 규칙 매치 (0초)        「적정재고 탭으로 가줘」 · 「Q1000108 목표재고」
                                 ├ /llm/route (1~2초)    질문 + 화면 문맥 {route, selectedCode, stage} + 도구 스키마
                                 │     └ picks: [{tool, input}, …]   (multi_step 이면 서버가 펼친다)
                                 ├ ASK 도구 → 우리 데이터로 답         actions.js → navigate / query / mutation
                                 └ ask_documents → 사내 RAG (6~11초)   mutation 은 UI.confirm 뒤에만
```

## 갈래

| 갈래 | 바로 실행 | action |
|---|---|---|
| 화면 이동 | ○ | `navigate` · `openMaterialDetail` · `openPurchaseRequest` · `openReturnPage` |
| 조회 | ○ | `searchMaterial` · `getInventoryStatus` · `runStockAnalysis` · `runAttrAlgorithm` + 기존 ASK 도구 13개 |
| DB 변경 | **확인 창** | `submitPurchaseRequest` · `returnMaterial` · `judgeMaterial` · `commitAttr` · `convertToPool` |

- 화면은 `actions.js` 의 `SCREENS` 표 키로만 간다 · LLM 이 만든 주소 · 코드는 어디서도 실행되지 않는다.
- 「이 자재」 「이거」 는 화면 문맥이다 · 주소의 `#q=코드` / `?code=` → 마지막으로 누른 자재(`[data-q]`) → 마지막으로 말한 코드 순.
- 화면을 옮겨야 하는 단계가 끼면 남은 단계를 `sessionStorage` 에 실어 새 화면에서 이어 한다 (서랍이 다시 열리며 앞 단계 결과가 남아 있다).

## 음성 명령 예시 10

| # | 말 | 일어나는 일 |
|---|---|---|
| 1 | **적정재고 탭으로 가줘** | 규칙 매치 → `stock.html` (0초) |
| 2 | **감축 대상 칸으로 이동해** | `navigate(stock, cut)` → `stock.html#cut` |
| 3 | **Q1201564 자재 찾아줘** | `searchMaterial` → 한 줄 답 · 그 자재가 「이 자재」 가 된다 |
| 4 | **Q1201564 찾아서 적정재고 화면에서 보여줘** | `searchMaterial` + `openMaterialDetail` → `stock.html#q=Q1201564` (그 자재만 찍힌 표) |
| 5 | **이 자재 재고 어때** | `getInventoryStatus` → 보유 · 목표 · 조치 · 산식 표 (화면 이동 없음) |
| 6 | **이 자재가 왜 보험품인지 알려줘** | `getInventoryStatus` + `ask_documents` → 우리 데이터 답 뒤에 사내 문서 답 |
| 7 | **이 자재 구매신청 화면 열어줘** | `openPurchaseRequest` → `purchase.html#q=코드` (자재가 골라진 초안 화면) |
| 8 | **이 자재 10개 구매 신청해줘** | `submitPurchaseRequest` → **확인 창** (자재 · 수량 · 금액) → 저장 → `pr_drafts` 한 줄 |
| 9 | **이거 2개 반납해줘** | `returnMaterial` → **확인 창** → `qr_returns` 한 줄 · 정본 자재면 보유 +2 · 상태는 비움 |
| 10 | **알고리즘 실행해** (속성값 판단 밖에서) | `attr.html` 로 먼저 가서 `runAttrAlgorithm` → `#all` 칸 |

덧 · 「이 자재 계획품으로 판단해」 → `judgeMaterial`(확인) · 「확정해」 → `commitAttr`(확인) · 「이 자재 공용 전환해」 → `convertToPool`(확인) ·
「오늘 할 일 뭐야」 「감축 금액 큰 자재 5개」 「stale 이 뭐야」 는 그대로 조회 갈래로 답한다 · 「회식 장소」 는 문서에도 없다고 답한다.

## 음성 인식 두 길

| | 서버 STT | 브라우저 내장 |
|---|---|---|
| 조건 | `.env` 에 `OPENAI_API_KEY` (OpenAI 키 · `sk-proj-…`) | Chrome · 키 없음 |
| 길 | `MediaRecorder` → `POST /stt` (serve.py) → OpenAI `whisper-1` | Web Speech API (`ko-KR`) |
| 키 위치 | 서버만 · 브라우저로 내려가지 않는다 (`config.local.js` 엔 `STT='/stt'` 표시만) | 없음 |
| 상태 표시 | idle → recording(빨간 테두리 · 15초 자동 끝) → transcribing(회전) → executing | 같음 + 중간 인식 문장이 안내 줄에 뜬다 |

> `.env` 의 `LLM_API_KEY` 는 **Anthropic 키**(`sk-ant-…`)라 라우터에만 쓰이고 STT 에는 쓸 수 없다.
> OpenAI 키를 받으면 `.env` 의 `OPENAI_API_KEY=` 에 넣고 서버를 다시 띄우면 그 순간 서버 STT 로 바뀐다.

**마이크는 https 또는 localhost 에서만 열린다.** `http://10.1.14.204:8130` (폰 · 다른 PC) 에서는 브라우저가 마이크를 막고 버튼이 그 이유를 말한다 · 글로 치는 명령은 어디서나 된다.

## 테스트 방법

1. 서버 · `python -B serve.py --port 3000` → 시작 로그에 `질의 라우터 · claude-haiku-4-5 · 도구 13개 · 키 있음` 과 `음성 인식 · 브라우저 내장 …` 또는 `/stt → OpenAI whisper-1` 이 찍힌다.
2. Chrome 에서 `http://localhost:3000/main.html` → ✦ AI 자재 질의 → 🎤 → 처음 한 번 마이크 허용 → 위 표의 문장을 말한다 → 인식된 문장이 🎤 표시로 채팅에 올라오고 단계 카드가 붙는다.
3. 8 · 9 번은 확인 창이 떠야 한다 · 「취소」 를 누르면 「취소했습니다 · 실행하지 않았습니다」 카드가 남고 DB 는 그대로다.
4. 마이크 없이 검사하려면 개발자 도구 콘솔에서 `CHAT.ask('이 자재 10개 구매 신청해줘', {voice:true})` 를 친다 · 음성 길과 같은 코드가 돈다.
5. 검사기 · `node test_actions.js` (레지스트리 · 값 검사 · 확인 창 · 3층 기록 · 문맥 · 안전) · `node test_ask.js` · `node test_chat.js`.
6. 라우터만 보려면 · `python tools_probe_chat.py` 대신 아래 한 줄 (질문 · 문맥만 간다):
   ```bash
   curl -s -X POST http://localhost:3000/llm/route -H "content-type: application/json" --data-binary "{\"question\":\"이 자재 10개 구매 신청해줘\",\"context\":{\"route\":\"stock\",\"selectedCode\":\"Q1201564\"}}"
   ```
