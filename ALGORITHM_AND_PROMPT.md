# MRO 자재 속성분류·적정재고 통합 알고리즘 및 실행 프롬프트

> 1단계(속성분류) → 2단계(적정재고 산출) → 통합 실행(connect_both.py) 순서로 정리한 문서.
> 머신러닝 없이, 설명 가능한 규칙과 시계열 점수만으로 판정한다.

---

## 0.0 ★먼저 읽을 것★ 이 패키지에는 파이썬 코드가 없다

본선 규칙상 **코드는 반출할 수 없다.** 따라서 아래 3개 파이썬 파일은 이 패키지에 **없으며,
이 문서를 규격으로 삼아 새로 작성해야 한다.** 문서 곳곳(그리고 함께 온 `00_작업서.md`,
`01_알고리즘_명세.md`, `02_데이터_명세.md`, `03_연동_인터페이스.md`,
`CONNECT_BOTH_PROMPT.md`)에 나오는 `python -B run_all.py` 같은 문장은
"이미 있는 코드를 실행하라"가 아니라 **"이런 이름·구조로 새로 만들고 그렇게 실행되게 하라"**
로 읽어야 한다.

### 만들어야 하는 파일 3개와 그 규격이 적힌 위치

| 새로 만들 파일 | 책임 | 규격이 적힌 곳 |
|---|---|---|
| `connect_both.py` | 1단계 속성분류 + 두 단계 연결/실행 | **부록 O 전체**, 본문 「1단계」, 「두 알고리즘의 연결 방식」 |
| `engine.py` | 2단계 계산 엔진(수요통계·부트스트랩·등급·목표재고·정체/공용화) | 부록 A~K, **부록 P-1~P-4·P-7·P-8** |
| `run_all.py` | 2단계 산출물 4종 파일 출력(발주 신호등 포함) | 부록 L·M, **부록 P-5·P-6** |

### 작성 후 실행 순서

```powershell
$env:PYTHONHASHSEED = "0"        # 필수 (0.5장 1번)
python -B connect_both.py        # 1단계 → classification_result.csv → 2단계까지 연쇄 실행
```

- 입력 파일 배치와 컬럼 규격은 0.5장 「입력 파일 스키마」를 그대로 따른다.
- `connect_both.py`는 1단계 결과를 작업 디렉터리에 쓰고, `txn_history.csv`·
  `equipment_map.csv`·`maintenance.csv`를 그 디렉터리로 복사한 뒤 `engine.py`/`run_all.py`를
  모듈로 불러 `DATA`·`OUT` 경로만 바꿔 실행한다(본문 「연결 방식」 참고).
- 1단계 Type 주입은 `engine.py`가 `classification_result.csv`를 읽어 메모리에서만
  수행한다(부록 P-8). `master.csv` 파일 자체를 고쳐 쓰지 않는다.

### 작성 직후 반드시 확인할 것 (이 숫자가 안 나오면 어딘가 틀렸다)

부록 O-8 의 기대값 — `classification_result.csv` 743행, 판정 분포
**보험품 285 · 계획품 294 · 회색지대 31 · 배제-소모품 111 · 배제-순환품 22**,
si 관측 최대 **85.7**. 함께 받은 DB 반출본의 `05_속성판정_파생.csv`·
`06_적정재고_파생.csv`가 바로 이 값으로 만들어진 정답지이므로, 그 파일과 직접 대조하면 된다.

### 함께 온 다른 문서의 낡은 수치 주의

`00_작업서.md`와 `01_알고리즘_명세.md`에 적힌 **"보험품 441 / 계획품 302"**, **"원본 약 60억"**
은 1단계 판정을 주입하지 **않고** master.csv 의 원본 Type 만으로 2단계를 돌렸을 때의 옛
기준선이다. 1단계를 주입하는 것이 이 시스템의 목적이므로, 주입 후 숫자가 여기서 벗어나는 것이
정상이다(본문 「연결 방식」 5번). 위의 285/294 쪽이 현재 정답이다.

---

## 0. 전체 흐름

```
[DOG Type]                         [appropriate_quantity]
 Outbound/Inbound/Stock TSV         master.csv, txn_history.csv,
 + Core Spare Parts 목록            equipment_map.csv, maintenance.csv
        │                                   │
        ▼                                   ▼
  ┌─────────────┐                    ┌──────────────┐
  │  1단계 분류   │──classification──▶│  2단계 적정재고 │
  │ (보험품/계획품│   _result.csv     │  (engine.py,  │
  │ /회색지대/배제)│   → TypeSource    │   run_all.py) │
  └─────────────┘                    └──────────────┘
        └───────────── connect_both.py 가 통합 실행 ─────────────┘
```

- **1단계**: `Qcode+DeptCode` 단위로 보험품/계획품/회색지대/배제를 규칙 + 점수로 판정.
- **2단계**: 1단계에서 확정된 Type(보험품·계획품)에 따라 완전히 다른 공식으로 적정재고·발주 신호등·공용화 후보를 산출.
- **연결**: `connect_both.py`가 1단계 결과를 2단계 입력(`master.csv`)에 주입하고, 회색지대·배제 결과는 2단계 Type을 덮어쓰지 않는다.

---

## 0.5 재현성(Reproducibility) 필수 준수사항

> 동료가 유사한 형식의 다른 더미 데이터로 이 알고리즘을 재현하거나, Claude Code로
> 다른 서비스에 결합할 때 **동일 입력 → 동일 출력**이 보장되도록 아래를 반드시 지킨다.
> 규칙·상수를 "개선"하거나 임의로 바꾸면 재현성이 깨지므로, 값을 바꿔야 한다면
> 반드시 이 문서와 원본 코드(`connect_both.py`, `engine.py`)를 함께 수정하고 그 사실을 명시한다.

### ⚠️ 실행 전 반드시 고정해야 하는 것

1. **`PYTHONHASHSEED=0` 환경변수 설정 필수.**
   `engine.py`의 리드타임 부트스트랩은 `seed=abs(hash(품번)) % 99991`을 쓰는데,
   파이썬 문자열 `hash()`는 기본적으로 **프로세스마다 무작위 솔트**가 적용된다.
   이 환경변수를 고정하지 않으면 같은 데이터를 넣어도 실행할 때마다
   `obs_max`, `raw`(보험품 목표), 신호등 결과가 달라질 수 있다.
   ```powershell
   $env:PYTHONHASHSEED = "0"
   python -B connect_both.py
   ```
   ```bash
   PYTHONHASHSEED=0 python -B connect_both.py
   ```
2. **기준일(ASOF)을 두 스크립트에서 반드시 동일하게 맞춘다.**
   현재 코드에는 서로 다른 하드코딩된 기준일이 존재한다 — 재현 시 반드시 확인/통일할 것.
   - `Connect Both/connect_both.py` 17행: `ASOF = date(2026, 9, 7)`
   - `appropriate_quantity/engine.py` 28행: `ASOF = date(2026, 9, 3)`
   - 다른 데이터셋으로 재현할 때는 두 값을 **같은 날짜**로 맞추거나, 실행 시점의
     오늘 날짜를 두 스크립트에 동일하게 주입하도록 코드를 고쳐야 한다.
     (그렇지 않으면 1단계 판정과 2단계 적정재고가 서로 다른 시점 기준으로 계산된다.)
   - **구현 후 자가검증(필수)**: 1단계 모듈과 2단계 모듈이 참조하는 기준일 값을
     실행 시작 시점에 서로 비교하는 코드를 넣고, 다르면 계산을 진행하지 말고
     즉시 에러로 중단시킨다. "같겠지"라고 가정하지 말고 코드로 강제할 것.
3. **표준 라이브러리만 사용한다.** `pip install`이 필요한 외부 패키지를 추가하면
   버전에 따라 결과가 달라질 수 있으므로 추가하지 않는다(`connect_both.py` 주석 참고).
4. **임계값·가중치·공식은 원본 값 그대로 사용한다.** 예: 보험품/계획품 점수 구간표
   (**→ 부록 O에 전체 표가 있다. 반드시 그 값을 쓸 것**), `si≥55 & 차이≥15` 판정 기준,
   F1~F7 가중치(F5 0.50 / F1 0.35 / …), 서비스수준
   Z값(S=2.58/A=2.05/B=1.65/C=1.28), 정체 판정 548일(1.5년) 등. 새 데이터의 분포가
   달라 보여도 임계값을 임의로 조정하면 원본과 다른 알고리즘이 된다.
5. **문자열 정규화 규칙을 그대로 유지한다.** 공백 트림(`clean()`), 콤마 제거 후
   숫자 변환(`number()`), 날짜 포맷 3종(`%Y-%m-%d`, `%Y/%m/%d`, `%Y-%m-%d %H:%M:%S`)
   순서대로 파싱하는 로직을 그대로 따른다. 다른 날짜 포맷이 섞인 새 데이터라면
   포맷 목록에 항목을 "추가"하되 기존 항목 순서는 바꾸지 않는다.
6. **입력 파일이 없을 때 "필수"와 "선택"을 명확히 구분해서 처리한다.** 원본
   `engine.py`는 `master.csv`/`txn_history.csv`가 없으면 즉시 에러를 내지만,
   `maintenance.csv`/`equipment_map.csv`/`classification_result.csv`가 없으면
   **에러 없이 조용히 빈 값으로 처리**한다(정비계획 연동 0건 → 발주신호등이
   전부 "상시"로만 나옴). 재구현 시 이 조용한 실패를 그대로 베끼지 말고, 파일이
   없을 때 콘솔/로그에 "maintenance.csv 없음 → 발주신호등 계산에서 정비계획
   미반영" 처럼 **어떤 파일이 빠져서 어떤 기능이 비활성화됐는지 명시적으로
   출력**해야 한다. 그래야 파일 전달 누락을 화면 결과만 보고도 바로 알아챌 수 있다.
7. **매칭 실패 시 반환 타입을 하나로 통일한다.** 원본 `classify_one()`은
   `(outbound or inbound or stock_rows or {}).get("Item Type")`처럼 "값이 있는
   것 하나를 골라 쓰는" 방식인데, `outbound`/`inbound`는 항상 `{"events": [...]}`
   형태의 딕셔너리로 감싸 넘기기 때문에 결과적으로 `stock_rows`(리스트)까지
   내려가는 경우가 없어서 우연히 문제가 안 생겼다. **이건 안전한 설계가 아니라
   우연히 안 터진 것**이므로, 재구현할 때는 "매칭 안 됨"을 표현하는 값을
   **항상 같은 타입(빈 딕셔너리 `{}`)**으로 통일하고, 리스트(`stock_rows`)와
   딕셔너리를 같은 `or`/fallback 체인에 섞어 쓰지 않는다.
   - **구현 후 자가검증(필수)**: `outbound`/`inbound`/`stock` 어디에도 매칭되는
     행이 없는 Qcode+DeptCode 조합을 하나 일부러 넣고 실행해서, 에러 없이
     `Item Type`/`Leaf Class`/`Category`가 빈 문자열로 처리되는지 확인한다.

### 입력 파일 스키마 (컬럼명·인코딩 고정)

새 더미 데이터를 만들 때도 아래 컬럼명·인코딩·구분자를 정확히 맞춰야 코드 수정 없이 동작한다.

| 파일 | 형식 | 구분자 | 필수 컬럼 |
|---|---|---|---|
| `DOG Type/Dummy Data/Outbound_Dummy.tsv` | TSV, UTF-8 BOM | 탭 | `Outbound Date, Qcode, 수량, Dept Code, Item Type, 부서명, 섹션명, Leaf Class, Category` |
| `DOG Type/Dummy Data/Inbound_Dummy.tsv` | TSV, UTF-8 BOM | 탭 | `INbound Date, Qcode, 수량, Dept Code, Item Type, 부서명, 섹션명, Leaf Class, Category` |
| `DOG Type/Dummy Data/Stock_Dummy.tsv` | TSV, UTF-8 BOM | 탭 | `Qcode, 수량, Dept Code, Item Type, 부서명, 섹션명, Leaf Class, Category` |
| `DOG Type/Core Spare Parts/core_spare_parts.csv` | CSV, UTF-8 BOM | 콤마 | `Qcode, DeptCode, 부서명, 섹션명, CriticalSparePart, Source` |
| `appropriate_quantity/master.csv` | CSV, UTF-8 BOM | 콤마 | `Item, Type, CriticalSparePart, CriticalEquipment, Warehouse, SourcingGroup, StockDept, StockAll, SupplierCount, UnitCost, LeadTimeMean, LeadTimeStd, CompletedCycles, ProcurementType, ReceivingDate, LinkedEquipment, SparePartHoldingStd, DeptCode` |
| `appropriate_quantity/txn_history.csv` ★ | CSV, UTF-8 BOM | 콤마 | `Item, ITEM_ID, TXN_DATE, SUBINV, ORG_ID, QTY_IN, QTY_OUT, TXN_CNT, DeptCode` (22,625행, 2단계 수요원 — **DOG Type TSV로 대체·재생성 금지**, 원본 그대로 사용) |
| `appropriate_quantity/equipment_map.csv` | CSV, UTF-8 BOM | 콤마 | `Item, LinkedEquipment, SparePartHoldingStd, DeptCode` |
| `appropriate_quantity/maintenance.csv` | CSV, UTF-8 BOM | 콤마 | `Equipment, MaintKind, StopStart, ReStart, StopHours, Manpower, Factory, Line, DeptCode` |

- 1단계 분석키는 TSV의 `Qcode` + `Dept Code`, 2단계는 `master.csv`의 `Item`(=Qcode) + `DeptCode`다.
  **컬럼명 표기가 파일마다 다르다**(`Dept Code` vs `DeptCode`, `Item` vs `Qcode`) — 새 데이터를 만들
  때도 이 표기 차이를 그대로 유지해야 `key_from()`이 정상 매칭한다.
- 날짜는 `YYYY-MM-DD`(권장) 또는 `YYYY/MM/DD`, 수량은 콤마 없는 숫자(콤마 섞여도 파싱은 되지만
  기준 통화는 원 단위로 통일).

### 재현성 검증 체크리스트

새 데이터로 실행하기 전/후에 다음을 확인한다.

1. `PYTHONHASHSEED=0`을 설정한 상태로 **동일 입력을 2회 연속 실행**해 `classification_result.csv`,
   `restock.csv`, `order_signals.csv`, `pooling.csv`가 바이트 단위로 동일한지 비교한다(예: `Compare-Object`,
   `diff`). 다르면 위 1~4번 중 하나가 지켜지지 않은 것이다.
2. 1단계 판정값이 `보험품/계획품/회색지대/배제-소모품/배제-순환품` 5종 밖으로 나가지 않는지 확인한다.
3. `restock.csv`의 `TypeSource`로 1단계 결과가 실제 반영됐는지 확인한다(회색지대·배제 행은 원본 master
   Type이 그대로 유지되어야 한다).
4. 새 데이터의 `Qcode+DeptCode`가 `master.csv`에 없는 경우 해당 행은 2단계에서 계산되지 않는 것이
   정상 동작임을 인지한다(에러가 아니라 데이터 계약에 의한 누락).
5. `maintenance.csv`를 일부러 빼고 실행해서, 에러가 안 나더라도 "정비계획 미반영" 같은 경고가
   로그/콘솔에 뜨는지, 그리고 그 사실이 화면 어딘가(예: 발주신호등이 전부 "상시"로 바뀜)에서
   확인 가능한지 점검한다. 아무 표시 없이 조용히 다른 값이 나온다면 6번 규칙이 안 지켜진 것이다.
6. `outbound`/`inbound`/`stock` 어디에도 실적이 없는 Qcode+DeptCode를 하나 넣고 실행해서
   에러 없이 처리되는지 확인한다(7번 규칙 검증).

---

## 1단계 — 속성분류 알고리즘 (보험품/계획품/회색지대)

### 목적
설비 예비품을 실적(불출·입고·재고) 기반 규칙과 점수로 `보험품`(항상 재고 보유) / `계획품`(원칙 재고 0, 수리일정 발주) / `회색지대` / `배제`로 자동 분류한다.

### 처리 순서
1. `Outbound_Dummy.tsv`, `Inbound_Dummy.tsv`, `Stock_Dummy.tsv`를 읽는다.
2. `DOG Type/Core Spare Parts/core_spare_parts.csv`(핵심 예비품 목록)를 읽는다. 이 목록은 2단계 `master.csv`의 `CriticalSparePart=O` 행에서 생성된 1단계 입력이다.
3. 모든 데이터의 분석키를 `Qcode + DeptCode`로 만든다. 다른 부서의 실적을 합산하지 않는다.
4. **사전 배제 규칙**을 먼저 적용한다.
   - `Qcode`가 `F`로 시작하거나 `Item Type`이 `Consignment`, `일일공급품`, `자가재` → `배제-소모품`.
   - `Leaf Class`가 Roll/Roller 계열 → `배제-순환품`.
   - `Qcode`가 `QS`로 시작 → `보험품 확정`.
   - `Category` 또는 `Item Type`에 Spare Part가 포함 → `보험품 확정`.
5. 확정 규칙이 아닌 분석키는 시계열 점수로 판정한다.
   - **보험품 점수(insurance_score)**: 불출발생월비율(희소성), 재고회전(turnover), 1.5년 이상 보유(hold_years) 가점 + 핵심 예비품 목록 일치 시 +20점.
   - **계획품 점수(planned_score)**: 재고 0 비율, 입고 후 소비 패턴(불출월 ≤3 & 입고월 ≤4), VMI 신호(+10점).
   - 두 점수를 각각 0~100으로 정규화(si, sp)하고 `difference = si - sp`를 계산.
   - `si ≥ 55 and difference ≥ 15` → `보험품`
   - `sp ≥ 55 and difference ≤ -15` → `계획품`
   - 그 외 → `회색지대`
   - 신뢰도: `|difference| ≥ 25` → HIGH, `≥ 15` → MEDIUM, 그 외 LOW.
6. 결과를 `classification_result.csv`로 저장. 유효 판정값: `보험품`, `계획품`, `회색지대`, `배제-소모품`, `배제-순환품`.

### 산출 필드
`Qcode, DeptCode, 판정, 판정경로, 판단근거, 보험품점수, 계획품점수, 신뢰도, 핵심예비품점수, 재고데이터출처`

---

## 2단계 — 적정재고 산출 알고리즘

### 개요
- 대상: 설비 예비품(보험품/계획품). 기준일 ASOF = 2026-09-03(연동 실행 시 2026-09-07).
- 목표: ① 재고 감축 ② 설비 정지 방지 (동시 달성).
- **대원칙**: 자재는 1단계에서 확정된 `Type`(보험품/계획품)에 따라 **완전히 다른 공식**으로 적정재고를 산출한다.

```
[데이터] 마스터·불출이력·설비·정비계획
   ▼
[기초] 수요통계 → 리드타임창 부트스트랩 → 중요도등급 S/A/B/C → 안전계수 Z
   ▼
[분기] 계획품: 원칙 0 (+ 핵심설비·활발 예외 시 소량)
       보험품: 품목실적 기반 μ_LT + 안전재고(SS)
   ▼
[후처리] 정체(1.5년+ 무소요) → 공용화(strong/medium/review)
   ▼
[출력] 적정재고 + 발주 신호등(🔴🟡🟢⚪)
```

### 기초 지표
- **수요 통계**: 부서창고 6개(QFC01/QHB24/QHB25/QHB27/QVC03/QVC07)의 `QTY_OUT`만 수요로 인정.
  - `d_mean`(일평균 소요), `d_std`(일 표준편차 근사), `size_mean`(1회 소요 규모), `events_yr`(연 소요 건수)
  - 수요패턴(ADI·CV² 기준): Smooth / Erratic / Intermittent / Lumpy / No-Demand
- **리드타임창 부트스트랩**: 과거 불출을 LT 길이 창으로 400회 무작위 샘플링. seed = 품번 기반 고정. SL분위수, obs_max(관측상한) 산출.
- **리드타임 보정**: 완결사이클 2건 미만이면 소싱그룹 중위 → 유형 중위 → 전체 중위(60일)로 대체. σLT는 최소 LT평균×0.25 보장.
- **중요도 등급(S/A/B/C)**: 7요인(F1~F7) 가중합 백분위 → 상위 5/20/60%로 등급 부여. 핵심예비품(CriticalSparePart=O)은 무조건 S.
  - 채택 가중치: F5 공용성 0.50, F1 핵심설비 0.35, F3 리드타임 0.05, F4 대체성 0.04, F6 고장확률 0.03, F7 조달난이도 0.02, F2 고장영향 0.01
  - F5(공용성)를 1순위로 둔 이유: 백테스트 결과 "타 부서에서 못 빌리는 품목"의 품절이 가장 위험 → 공용성 가중치를 크게 둘 때 총 품절 최소.
- **서비스수준/안전계수**: S=0.995/Z2.58, A=0.98/Z2.05, B=0.95/Z1.65, C=0.90/Z1.28. 등급은 재고 상한이 아니라 안전계수로만 반영.

### C-A. 보험품 (engine.reserve_target)
```
소요 이력 없음:
   핵심(CSP/CEQ=O)            → max(설치수기준, 1)
   비핵심 & 초고가(단가>5천만) → 0 (돌발 시 구매)
   비핵심                     → 0
소요 이력 있음:
   μ_LT = d_mean × LT평균
   SS   = Z(등급) × d_std × √LT평균
   norm = ceil(μ_LT + SS), 단 최소 ceil(size_mean) 보장
   obs_max = 부트스트랩 LT창 소요 최대치
   raw  = min(norm, obs_max)        ← 관측 안 된 양은 안 쌓음
   핵심   → max(raw, 설치수기준, 1)
   비핵심 → raw
```
핵심 원리: 등급 캡을 쓰지 않는다. 각 품목의 실적(d_mean, d_std, size_mean, obs_max)이 목표를 정하고 등급은 Z로만 반영.

### C-B. 계획품 (engine.planned_target)
```
핵심설비 판정 = (CSP=O or CEQ=O) OR (연결설비 severity == High)
소요활발 판정 = (최근소요 idle ≤ 1.5년) AND (연빈도 λ ≥ 1.0)
             ※ λ = 반감기 4년 최근성 가중 연소요건수

if not 핵심설비:      목표 = 0   (수리일정 발주로만 대응)
elif 최근 3년 무소요:  목표 = 0
elif not 소요활발:     목표 = 0
else:                목표 = max(1, min(SL분위수, 상한 1))   ← 소량
```
계획품은 상시 재고 0이 원칙. 실제 구매는 수리일정 발주로 대응.

### C-C. 정체 & 공용화 (Type 무관 후처리)
```
최종입고 후 ≥ 548일(1.5년) AND 최근 무소요(idle>1.5년) AND 재고>0 → 정체
공용화 등급:
   전체재고 > 부서재고        → strong (즉시공용화, 위험 없음)
   비핵심/계획품 & 타처 없음    → medium (공용화 권장)
   핵심 보험품 & 타처 없음      → review (유지/재분류 검토)
```

### D. 발주 신호등 (run_all.py)
- **계획품(수리일정 연동)**: `발주기준일 = 정지시작일 − LT평균 − 선행일수 − 0.5×LT표준편차`. D=발주기준일-오늘. 현재고≥예상소요 → ⚪, D≤0 → 🔴, 0<D≤30 → 🟡, D>30 → 🟢.
- **보험품(재고포지션)**: 목표0 → ⚪재고불요, 현재고<목표×0.5 → 🔴즉시발주, 현재고<목표 → 🟡발주임박, 현재고≥목표 → ⚪충분/🟢여유.

### 재무효과
```
금융비용 절감 = (자동발주 감축액 + 공용화 회수액) × 기여율(0.20) × 이자율(0.046)
전사 확산: 재고감축목표 2,016억 × 20% × 4.6% = 연 18.5억원
```

---

## 두 알고리즘의 연결 방식 (connect_both.py)

1단계 분류 결과와 2단계 적정재고 엔진을 하나의 실행기로 묶는다.

1. `master.csv`, `Outbound/Inbound/Stock_Dummy.tsv`, `core_spare_parts.csv`를 읽는다.
2. 1단계 분류(`stage_one`)를 실행해 `Qcode+DeptCode`별 `판정`을 계산하고 `classification_result.csv`로 저장한다.
3. `master.csv`를 2단계 작업 디렉터리(`engine_input/`)에 다시 쓰고, `txn_history.csv`·
   `equipment_map.csv`·`maintenance.csv`는 `appropriate_quantity`의 원본을 그대로 복사한다.
   **`txn_history.csv`는 DOG Type 더미 TSV에서 재생성하지 않는다.** TSV는 1단계
   속성분류(Item Type/Leaf Class/Category 기반 사전 배제·확정, 불출희소성·재고회전
   점수)에만 쓰는 데이터이고, 품목당 불출 건수가 희박해(중위 4건, 다수 1건) 그대로
   2단계 수요원으로 쓰면 리드타임창 부트스트랩의 관측상한(obs_max)이 대부분 0이
   되어 부록 H의 안전장치(`raw = min(norm, obs_max)`)가 무력화되고 보험품 목표재고가
   실제보다 몇 배 부풀어 오른다(검증: TSV로 대체 시 보험품 목표 534.5억, 원본
   `txn_history.csv`(22,625행) 사용 시 79.5억 — 후자가 맞는 값).
4. 기존 `appropriate_quantity/engine.py`, `run_all.py`를 모듈로 동적 로드(`load_module`)해 `DATA`/`OUT` 경로만 작업 디렉터리로 바꿔 실행한다(`stage_two`).
5. **적용 규칙**: `보험품` 또는 `계획품`으로 확정된 행만 2단계 입력의 Type을 대체한다. `회색지대`와 `배제-*` 결과는 2단계 Type을 덮어쓰지 않는다 — 즉 1단계가 애매하거나 배제한 품목은 기존 2단계 마스터의 Type을 그대로 유지한다. **이 주입은 반드시 수행한다** — `01_알고리즘_명세.md` A절(441/302)·G절(~60억) 수치는 주입 전(원본 master Type만 쓴) 기준선일 뿐이며, 주입 후 수치가 여기서 벗어나는 것은 정상이다(재분류가 이 시스템의 목적이므로).
6. 결과 `restock.csv`의 `TypeSource` 컬럼으로 1단계 결과가 실제 적용됐는지(`classification_result.csv`) 아니면 원래 마스터 Type을 썼는지 추적할 수 있다.
7. `--keys-file`로 특정 `Qcode,DeptCode` 목록만 선택 실행 가능(`output/selected/`에 별도 저장). 선택한 키가 `master.csv`에 없으면 실행을 중단하고, 다른 Qcode/부서 실적을 절대 합산하지 않는다.

### 데이터 계약
- `Qcode`/`DeptCode`는 모든 원천 파일에 존재해야 한다.
- 2단계 마스터에도 같은 `Qcode+DeptCode`가 있어야 해당 부서 결과가 계산된다. 마스터에 없는 부서코드 거래는 1단계 분석은 가능하나 2단계에는 매칭되지 않는다.
- 날짜는 `YYYY-MM-DD`, 수량은 숫자, 파일은 UTF-8 BOM 탭 구분(TSV)을 사용한다.
- `appropriate_quantity/txn_history.csv`(22,625행)는 2단계 수요원으로서 **필수 입력**이며, DOG Type 더미 TSV로 대체·재생성할 수 없다(재현성 0.5장 참고). TSV 3종은 1단계 속성분류 전용이다.

### 실행 방법
```powershell
cd "C:\Users\서동민\Desktop\hackerthon\Connect Both"
python -B connect_both.py
```
선택 실행:
```powershell
python -B connect_both.py --keys-file "C:\path\keys.csv"
```

### 산출물 (Connect Both/output/)
- `engine_input/classification_result.csv`: 1단계 결과
- `restock.csv`: 목표재고, 발주량, 발주금액, TypeSource
- `order_signals.csv`: 발주 신호등
- `pooling.csv`: 정체·공용화 후보
- `SUMMARY.txt`: 요약 리포트

---

## 실행 프롬프트 (Claude Code / LLM에게 그대로 지시할 때 사용)

```
당신은 MRO 자재의 Qcode+DeptCode 단위 속성분류 및 적정재고 산출 서비스 운영자다.
머신러닝을 사용하지 않고, 설명 가능한 규칙과 시계열 점수로 판정한다.

[재현성 — 다른 데이터/다른 서비스에 이식할 때 반드시 지킬 것]
0. 이 알고리즘을 새 더미 데이터나 실제 서비스에 결합할 때도, 아래 상수와 공식은
   "개선"하거나 임의로 바꾸지 말고 원본 그대로 이식한다. 값을 반드시 바꿔야 한다면
   무엇을, 왜 바꿨는지 별도로 기록한다.
   - 실행 전 환경변수 PYTHONHASHSEED=0을 반드시 설정한다(리드타임 부트스트랩의
     seed=abs(hash(품번))%99991이 파이썬 문자열 해시에 의존하므로, 고정하지 않으면
     같은 입력에도 실행마다 결과가 달라진다).
   - 기준일(ASOF)은 1단계·2단계 스크립트에서 반드시 동일한 값을 쓴다. 서비스에
     이식할 때는 "오늘 날짜"를 두 스크립트에 하나의 값으로만 주입하도록 만든다.
   - 사전 배제/확정 규칙의 접두어(F, QS), 점수 구간표, 판정 임계값(si≥55·sp≥55·
     차이≥15), 신뢰도 임계값(25/15), 등급 가중치(F1~F7), 서비스수준 Z값, 정체
     판정 548일 등은 고정 상수로 취급하고 코드에 그대로 옮긴다.
   - 표준 라이브러리만 사용한다(외부 패키지 설치로 인한 버전 차이 방지).
   - 입력 파일의 컬럼명(예: TSV의 "Dept Code" vs master.csv의 "DeptCode")과
     인코딩(UTF-8 BOM), 구분자(TSV=탭, master류=콤마)를 원본과 동일하게 맞춘다.
   - 이식 후에는 동일 입력을 2회 실행해 산출 CSV가 바이트 단위로 동일한지 검증한다.

[1단계: 속성분류]
1. Outbound_Dummy.tsv, Inbound_Dummy.tsv, Stock_Dummy.tsv를 읽는다.
2. DOG Type/Core Spare Parts/core_spare_parts.csv를 읽는다.
   이 목록은 2단계 master.csv의 CriticalSparePart=O 행에서 생성된 1단계 입력이다.
3. 모든 데이터의 분석키를 Qcode + DeptCode로 만든다. 다른 부서의 실적을 합산하지 않는다.
4. 사전 배제 규칙을 먼저 적용한다.
   - Qcode가 F로 시작하거나 Item Type이 Consignment/일일공급품/자가재면 배제-소모품.
   - Leaf Class가 Roll/Roller 계열이면 배제-순환품.
   - Qcode가 QS로 시작하면 보험품 확정.
   - Category 또는 Item Type에 Spare Part가 포함되면 보험품 확정.
5. 확정 규칙이 아닌 분석키에 대해 재고보유, 불출희소성, 재고회전, 장기보유,
   재고 0 비율, 입고 후 소비, 불출 집중도, VMI 신호를 계산해 보험품점수/계획품점수를 산출한다.
6. 핵심 예비품 목록에 Qcode+DeptCode가 있으면 보험품 점수에 20점을 추가한다.
7. 보험품 점수와 계획품 점수를 각각 0~100으로 정규화하고, 점수 차이와 신뢰도를 산출한다.
8. 결과를 classification_result.csv로 저장한다.
   유효한 판정값은 보험품, 계획품, 회색지대, 배제-소모품, 배제-순환품이다.

[연결 규칙]
9. 보험품 또는 계획품인 행만 2단계 입력으로 적용한다.
   회색지대와 배제 결과는 2단계 Type을 덮어쓰지 않는다(기존 마스터 Type 유지).
10. Qcode+DeptCode로 2단계 마스터와 매칭하고, 적정재고·발주·공용화 결과를 생성한다.

[2단계: 적정재고 산출]
11. 자재는 Type(계획품/보험품)에 따라 완전히 다른 공식으로 적정재고를 산출한다.
    - 보험품: μ_LT(=d_mean×LT평균) + 안전재고(Z(등급)×d_std×√LT평균)를 구하고,
      부트스트랩 관측상한(obs_max)으로 상한을 씌운다. 핵심설비는 설치수기준과
      비교해 더 큰 값을 취한다.
    - 계획품: 핵심설비가 아니거나 최근 3년 무소요면 목표 0. 핵심설비이면서
      최근 1.5년 이내 소요가 있고 연빈도(λ, 4년 반감기 가중)가 1.0 이상이면
      소량(SL분위수, 상한 1)만 보유. 원칙은 상시 재고 0, 구매는 수리일정 발주로.
12. Type 무관 후처리로 정체(1.5년+ 무소요) 품목을 찾고, 전체재고와 부서재고를
    비교해 공용화 등급(strong/medium/review)을 부여한다.
13. 계획품은 정비계획의 정지시작일 기준 발주기준일(정지시작일 − LT평균 −
    선행일수 − 0.5×LT표준편차)로 신호등을, 보험품은 현재고 대비 목표재고
    비율로 신호등을 산출한다(🔴즉시발주/🟡발주임박/🟢여유/⚪충분·불요).

[출력]
14. classification_result.csv, restock.csv(TypeSource로 1단계 반영 여부 표기),
    order_signals.csv, pooling.csv, SUMMARY.txt를 생성한다.
15. 선택 실행(--keys-file) 시 요청한 Qcode+DeptCode만 산출하고, master.csv에
    없는 키가 있으면 즉시 오류로 중단한다.
```

---

## 부록 — 코드 없이 이 md만으로 재구현하기 위한 정밀 공식

> 파이썬 코드 파일(`connect_both.py`, `engine.py`, `run_all.py`)을 가져갈 수 없는
> 환경(해커톤 등)에서, 이 문서와 더미 데이터만으로 Claude Code가 동일 로직을
> 새로 작성할 수 있도록 원본 코드의 정밀 공식을 그대로 옮겨 적는다. 위 본문의
> 서술형 설명보다 이 부록이 우선한다(계산식이 다르면 이 부록을 따른다).

### A. 백분위 순위 pct_rank(동점 평균 처리)
```
값 목록을 오름차순 정렬한 인덱스 순서를 만든다.
동점 구간 [i..j]는 모두 같은 순위값 = (i+j)/2 / max(1, n-1) 을 부여한다(0~1).
→ F1~F7 각 요인을 이 방식으로 0~1 정규화한 뒤 가중합한다.
```

### B. 리드타임창 부트스트랩(lt_window_dist)
```
입력: 품목의 과거 불출 시계열 series{날짜:수량}, 관측기간 start~end, 창길이 w=round(LT평균),
      표본수 n_samples=400, seed
w = max(1, w)
total_days = (end-start).days + 1  (0 이하이거나 series 비면 표본 없음)
series를 (날짜-start).days 오프셋별 합계 배열 off[] 로 만든다
span = max(1, total_days - w)
seed로 고정된 난수생성기(rng)를 만들고, n_samples회 반복:
  s0 = rng.randint(0, span)                # 창 시작 오프셋
  창 [s0, s0+w) 구간에 속하는 off 값들을 합산 → 표본 1개
표본 400개를 오름차순 정렬해서 반환한다.

★ seed 고정 규칙: seed = abs(hash(품번+부서? 아님, 코드 c=(Qcode,DeptCode) 튜플)) % 99991
  원본은 seed=abs(hash(c)) % 99991 (c는 (Item, DeptCode) 튜플 자체를 해시).
  PYTHONHASHSEED=0 미고정 시 이 seed 자체가 실행마다 달라져 재현 불가 — 0.5장 참고.
```

### C. 서비스수준 분위수 _sl_quantile
```
표본 중 0 초과 값만 취해 오름차순 정렬 → s[]
i = min(len(s)-1, ceil(sl * len(s)) - 1)
return s[max(0, i)]   (표본 없으면 0)
```

### D. 수요통계 demand_stats (품목별)
```
days = max(1, (end-start).days+1)
total = 기간 내 QTY_OUT 합계, n_evt = 이벤트(거래일) 수
years = days / 365.25
월별 합계 bucket{(연,월): 합계}를 만들고, months=max(1, round(days/30.44))
vals = bucket 값 목록 + (months - len(bucket))개의 0 채움
m_mean = mean(vals), m_std = stdev(vals)  (표본표준편차, n-1분모, n<2면 0)
cv = m_std/m_mean (m_mean>0일 때만, 아니면 0)
adi = months / len(bucket)  (bucket 비어있으면 0)
패턴: adi==0 → No-Demand
      adi<1.32 and cv²<0.49 → Smooth
      adi<1.32 → Erratic
      cv²<0.49 → Intermittent
      그 외 → Lumpy
d_mean = total/days
d_std  = m_std / sqrt(30.44)
size_mean = 이벤트별 수량의 평균
events_yr = n_evt/years
idle_days = end - 마지막 이벤트일 (없으면 None)
```

### E. 리드타임 보정 impute_lt
```
완결사이클(cycles) ≥ 2 이고 LT평균 원본값이 있는 품목만 "신뢰 가능(ok)"으로 취급.
g_lt = ok 품목들의 LT평균 중위값 (없으면 60.0)
g_sd = ok 품목들의 LT표준편차 중위값 (없으면 15.0)
품목별:
  lt_mean_raw 없거나 ≤0 → 소싱그룹(SourcingGroup) 중위 → 유형(Type) 중위 → g_lt 순으로 대체
  lt_mean = max(1.0, 위 값)
  lt_std_raw 없거나 ≤0 → max(g_sd, lt_mean × 0.25)
  lt_std = max(0.5, 위 값)
```

### F. 중요도 등급 criticality
```
F1 = (CSP='O'?0.5:0) + (CEQ='O'?0.5:0)                      ← 원값 그대로(정규화 없음)
F2 = pct_rank(정지1일당 정비비 = 상수 847,940원 전 품목 동일) ← 원본 ERP 정비비 없을 때 대체값
F3 = pct_rank(lt_mean + lt_std)
F4 = pct_rank(1 / max(1, SupplierCount or 1))
F5 = pct_rank(StockDept/StockAll, StockAll=0이면 1.0)
F6 = pct_rank(events_yr)
F7 = pct_rank((ProcurementType='수입'?0.5:0) + (SupplierCount≤1?0.5:0))
가중치 W = {F1:0.35, F2:0.01, F3:0.05, F4:0.04, F5:0.50, F6:0.03, F7:0.02}  (합 1.00)
score = Σ(W[f]×F[f]) / Σ(W) × 100
전체 품목을 score 내림차순 정렬 → 순위비율 p = i/max(1,n-1)
  p ≤ 0.05 → S, p ≤ 0.20 → A, p ≤ 0.60 → B, 그 외 → C
도메인 규칙(최종 덮어쓰기): CriticalSparePart='O'인 품목은 무조건 grade='S'.
```

### G. 최근성/연빈도 recency(반감기 가중)
```
half_life = 4.0(년)
wcnt = Σ 이벤트마다 0.5^((ASOF-이벤트일).days/365.25/half_life)
span = max((ASOF - 최초이벤트일).days/365.25, 1e-9)
lam_yr(연빈도) = wcnt / span
idle(유휴년수) = (ASOF - 최근이벤트일).days/365.25  (이벤트 없으면 None)
```

### H. 보험품 목표 reserve_target
```
is_crit = (CSP='O' or CEQ='O')
base = equipment_map의 SparePartHoldingStd (없으면 1)
grade = criticality 등급, sl=SL_BY_GRADE[grade], z=Z_BY_SL[sl]
  SL_BY_GRADE={S:0.995, A:0.98, B:0.95, C:0.90}, Z_BY_SL={0.995:2.58,0.98:2.05,0.95:1.65,0.90:1.28}

이력 없음(events 비어있음):
  is_crit         → max(base, 1)
  아니고 UnitCost > 50,000,000  → 0
  그 외            → 0

이력 있음:
  obs_max = ceil(부트스트랩 표본 중 최대 양수값)   (표본 없으면 0)
  mu_lt = d_mean × lt_mean
  ss    = z × d_std × sqrt(max(lt_mean, 1))
  norm  = ceil(mu_lt + ss);  norm = max(norm, ceil(size_mean))
  raw   = min(norm, obs_max)  (obs_max>0일 때만, 아니면 norm 그대로)
  is_crit → max(raw, base, 1)
  아니면  → raw
```
`ceil(x)`는 `max(0, ceil(x - 1e-9))`(부동소수 오차 보정 포함).

### I. 계획품 목표 planned_target
```
lam_yr, idle = recency(과거 이벤트, ASOF, half_life=4.0)
is_crit_flag  = (CSP='O' or CEQ='O')
is_crit_equip = is_crit_flag OR (연결설비 최고 severity == 'High')
if not is_crit_equip:                        목표=0
elif idle is None or idle > 3.0(년):          목표=0   ← 최근 3년 무소요
elif not(idle ≤ 1.5 and lam_yr ≥ 1.0):        목표=0   ← 소요활발 아님
else:
  q = ceil(_sl_quantile(부트스트랩 표본, sl))
  목표 = max(1, min(q, 1))                    ← 상한 1(planned_safety_cap)
```

### J. 설비 severity _severity
```
설비(부서,설비명)별: cumdur=StopHours 합계, ppl=Manpower 목록, big=(대수리|합리화) 건수, n=건수
mx_cum = 전체 설비 중 cumdur 최댓값(없으면 1), mx_ppl = 평균인력의 전체 최댓값(없으면 1),
mx_big = big의 전체 최댓값(없으면 1)
score = 0.55×log1p(cumdur)/log1p(mx_cum) + 0.25×(평균Manpower/mx_ppl) + 0.20×(big/mx_big)
score 내림차순 정렬 → 순위비율 q=i/n
  q<0.25 → High, q<0.60 → Mid, 그 외 Low
Q코드의 severity = 연결된 설비들 중 최고 등급(High>Mid>Low)
```

### K. 정체·공용화 판정
```
age = ASOF - ReceivingDate (없으면 정체 판정 대상 아님)
idle ≤ 1.5년(recency 기준)이면 "최근 활동" → 정체 아님
정체 조건: StockDept>0 AND age ≥ 548일(1.5년) AND NOT 최근활동
공용화 등급 pooling_grade(부서재고, 전사재고, is_crit, Type):
  전사재고 − 부서재고 > 0             → strong "즉시공용화(전사재고有)"
  is_crit AND Type='보험품'            → review "보류/전환(핵심보험)"
  그 외                                → medium "공용화권장(비핵심·계획품)"
```

### L. 발주 신호등 상세 (run_all.py)
```
보험품(및 수리일정 없는 계획품) — signal_reserve(현재고, 목표):
  목표 ≤ 0                     → gray "재고불요"
  현재고 ≤ 0 or 현재고 < 목표×0.5 → red  "즉시발주"
  현재고 < 목표                 → yellow "발주임박"
  현재고 > 목표                 → gray "충분"
  현재고 == 목표                → green "여유"

계획품(연결설비의 미래 정비계획이 있는 경우):
  LEAD_BUFFER = {합리화:60, 대수리:45, 중수리:21, 정기수리:14, 교체휴지:10, 공정휴지:7}
  연결설비의 미래 정지일정 중 가장 이른 것(stop, kind, 설비) 선택
  buf = LEAD_BUFFER[kind] + floor(0.5 × lt_std)
  order_by = stop − (lt_mean + buf)일
  D = (order_by − ASOF).days
  exp_need(예상소요) = 과거 같은 kind의 정지 시점 ±30일 이내 불출량 합의 평균(반올림, 최소1);
                        과거 이력이 없으면 SparePartHoldingStd(없으면 1)
  현재고 ≥ exp_need        → gray "재고충분"
  D ≤ 0                    → red  "즉시발주"
  0 < D ≤ 30               → yellow "발주임박"
  D > 30                   → green "여유"
정렬 우선순위: red > yellow > green > gray
```

### M. 산출 CSV 컬럼 (그대로 재현)
```
restock.csv:
  Item, DeptCode, Type, TypeSource, Grade, CSP, CEQ, UnitCost,
  StockDept, StockAll, Target, OrderNeed, OrderAmount, Action, Reason
  (Action: OrderNeed>0→"발주", Target<StockDept→"감축", 그 외 "유지")

order_signals.csv:
  Signal, Status, Item, DeptCode, Type, Equipment, Kind,
  StopDate, OrderByDate, D_days, ExpectedNeed, CurrentStock, OrderNeed, OrderAmount

pooling.csv (정체목록을 StaleValue 내림차순 정렬):
  Item, DeptCode, Type, Grade, AgeDays, StockDept, StaleValue, PoolGrade, Action

SUMMARY.txt 재무효과:
  감축분 reduce_amt = Σ max(0, StockDept-Target)×UnitCost  (품목 전체)
  공용화회수 pool_amt = Σ StaleValue  (PoolGrade가 strong 또는 medium인 것만)
  재무효과 = (reduce_amt + pool_amt) × CONTRIB(0.20) × INTEREST(0.046)
```

### N. 고정 상수 전체 목록 (원본 값 그대로 사용)
```
ASOF(기준일, 두 스크립트 동일하게 통일할 것), DEPT_WAREHOUSES={QFC01,QHB24,QHB25,QHB27,QVC03,QVC07}
SIGMA_LT_FLOOR_CV=0.25, STALE_DAYS=548
SL_BY_GRADE={S:0.995,A:0.98,B:0.95,C:0.90}, Z_BY_SL={0.995:2.58,0.98:2.05,0.95:1.65,0.90:1.28}
W_BEST={F1:0.35,F2:0.01,F3:0.05,F4:0.04,F5:0.50,F6:0.03,F7:0.02}
DOWNTIME_MEDIAN_KRW=847940, manual_price(초고가 기준)=50,000,000
recency_half_life=4.0, planned_dead_years=3.0, planned_lt_gate=60(미사용 여지),
planned_active_lambda=1.0, planned_safety_cap=1
LEAD_BUFFER={합리화:60,대수리:45,중수리:21,정기수리:14,교체휴지:10,공정휴지:7}
INTEREST=0.046, CONTRIB=0.20
n_samples(부트스트랩)=400, seed=abs(hash(c))%99991 (PYTHONHASHSEED=0 필수)
```

### 부록 O — 1단계 시계열 점수 정밀 산식 ★필수★

> **이 부록은 본문 「1단계」 서술을 대체한다.** 본문에는 "점수 구간표"라고만 적혀 있고
> 실제 표가 없었다. 아래 표와 분모(70·32) 없이는 si/sp가 절대 재현되지 않는다.
> 파이썬 코드를 반출할 수 없으므로 이 부록이 1단계의 유일한 재현 규격이다.

**O-1. 사전 배제·확정 규칙 (이 순서대로, 먼저 걸리면 즉시 종료)**
```
① Qcode가 'F'로 시작(대문자 변환 후) OR item_type.lower() ∈ {consignment, 일일공급품, 자가재}
   → 판정=배제-소모품, 판정경로=사전 배제, 판단근거='소모품 규칙 적용'
② leaf_class.lower()에 'roll' 또는 'roller' 포함
   → 판정=배제-순환품, 판정경로=사전 배제, 판단근거='Roll 계열 Leaf Class 규칙 적용'
③ Qcode가 'QS'로 시작(대문자 변환 후)
   → 판정=보험품, 판정경로=QS 확정, 판단근거='Qcode QS 접두어 규칙 적용'
④ category.lower()에 'spare part' 포함 OR item_type.lower()에 'spare part' 포함
   → 판정=보험품, 판정경로=Spare Part 확정, 판단근거='Spare Part 계열 규칙 적용'
①~④에 걸린 행은 보험품점수·계획품점수 = 문자열 '해당 없음', 신뢰도 = 'HIGH',
핵심예비품점수 = 0 으로 기록한다. (배제가 QS 확정보다 상위 조건이다.)
```

**O-2. item_type / leaf_class / category 를 가져오는 위치**
```
분석키(Qcode+DeptCode)와 일치하는 첫 행을 outbound_rows → inbound_rows → stock_rows
순서로 이어붙인 목록에서 찾아(first match) 그 행의 'Item Type' / 'Leaf Class' /
'Category' 를 쓴다. 어디에도 일치 행이 없으면 세 값 모두 빈 문자열로 두고 계속 진행한다
(에러 아님).
```

**O-3. 점수 계산에 쓰는 기초량**
```
months            = max(1, (ASOF.year - 2016)*12 + ASOF.month - 9)
                    ← 관측 기준 시작점이 2016-09 로 하드코딩되어 있다.
                      ASOF=2026-09-07 이면 months = 120.
out_months        = 불출(outbound) 이벤트 중 수량>0 인 것들의 서로 다른 (연,월) 집합
in_months         = 입고(inbound)  이벤트 중 수량>0 인 것들의 서로 다른 (연,월) 집합
out_ratio         = len(out_months) / months
total_out         = 불출 이벤트 수량 전체 합
annual_out        = total_out / 10          ← 관측 10년으로 하드코딩
stock_values      = 그 분석키의 Stock TSV 행들의 '수량' 목록
avg_stock         = mean(stock_values)  (행이 없으면 0)
zero_stock_ratio  = (수량 ≤ 0 인 행 수) / max(1, len(stock_values))
turnover          = annual_out / avg_stock   (avg_stock > 0 일 때만, 아니면 None)
last_event        = 불출+입고 이벤트 날짜 중 최댓값 (없으면 None)
hold_years        = (ASOF - last_event).days / 365.25   (last_event 없으면 0)
```

**O-4. 구간표 (percentile_score: 값 ≤ 임계값이면 그 점수, 어디에도 안 걸리면 마지막 fallback)**
```
[보험품] out_ratio      ≤0.03→10 · ≤0.07→8 · ≤0.12→6 · ≤0.20→4 · ≤0.30→2 · 그 외→0
[보험품] turnover       ≤0.10→10 · ≤0.30→8 · ≤0.60→6 · ≤1.00→3 · ≤2.00→1 · 그 외→0
                        (turnover 가 None 이면 이 항목은 아예 더하지 않는다)
[계획품] zero_stock_ratio ≤0.10→0 · ≤0.25→4 · ≤0.40→7 · ≤0.60→10 · ≤0.80→12 · 그 외→12
```

**O-5. 점수 합산 → 정규화 → 판정**
```
core_score      = 20 if (Qcode,DeptCode) ∈ core_spare_parts 목록 else 0
insurance_score = core_score
                + 구간점수(out_ratio)
                + 구간점수(turnover)            (turnover 가 None 이면 생략)
                + (20 if hold_years ≥ 1.5 else 0)
planned_score   = 구간점수(zero_stock_ratio)
                + (in_months 와 out_months 가 모두 비어있지 않을 때:
                     10 if (len(out_months) ≤ 3 and len(in_months) ≤ 4) else 4)
                + (10 if item_type.lower() == 'vmi' else 0)

si   = min(100, insurance_score / 70 * 100)      ← 분모 70 (이론 최대 60 → si 최대 85.7)
sp   = min(100, planned_score  / 32 * 100)      ← 분모 32 (이론 최대 32 → sp 최대 100)
diff = si - sp
판정: si ≥ 55 and diff ≥ 15    → 보험품
      sp ≥ 55 and diff ≤ -15   → 계획품
      그 외                     → 회색지대
신뢰도: |diff| ≥ 25 → HIGH · |diff| ≥ 15 → MEDIUM · 그 외 → LOW
출력 시 si·sp 는 소수 첫째 자리로 포맷한다(f"{si:.1f}"). 파이썬은 round-half-even 이라
31.25 → "31.2", 68.75 → "68.8" 이 된다. 다른 언어로 옮길 때 반드시 같은 반올림을 쓸 것.
```

**O-6. 판단근거(판정경로='시계열 점수') 문자열 조립 순서**
```
['핵심 예비품 목록 일치 +20점'(core_score>0 일 때만)]
  + ['VMI'(item_type이 vmi 일 때만)]
  + [f'불출발생월비율={out_ratio:.3f}', f'재고0비율={zero_stock_ratio:.3f}']
을 '; ' 로 이어붙인다.
예) "핵심 예비품 목록 일치 +20점; 불출발생월비율=0.025; 재고0비율=0.889"
```

**O-7. 분류 대상 모집단**
```
분류하는 키는 master.csv 의 (Item, DeptCode) 조합 전체다(현재 더미: 743개).
TSV 에만 있고 master.csv 에 없는 키는 분류하지 않는다.
master.csv 의 컬럼값(Type 등)은 1단계 점수 계산에 일절 쓰지 않는다 — 모집단 정의에만 쓴다.
```

**O-8. 재현 검증 기대값 (현재 더미데이터 + ASOF 2026-09-07 기준)**
```
classification_result.csv = 743행
판정 분포: 보험품 285 · 계획품 294 · 회색지대 31 · 배제-소모품 111 · 배제-순환품 22
판정경로 분포: 시계열 점수 607 · 사전 배제 133 · QS 확정 2 · Spare Part 확정 1
신뢰도 분포: HIGH 709 · MEDIUM 3 · LOW 31
si 관측 최대 85.7 (=60/70×100). 이 숫자가 안 나오면 O-5 의 분모를 잘못 쓴 것이다.
```

### 부록 P — 원본 코드에만 있던 2단계 세부 동작 ★필수★

> 본문·부록 A~N 에 빠져 있어서 그대로 재구현하면 값이 달라지는 부분만 모았다.

**P-1. 관측기간(start, end)의 정의**
```
gmin, gmax = txn_history.csv 에서 "필터를 통과한 행들"의 TXN_DATE 최소·최대값.
필터 = (Item,DeptCode)가 master 모집단에 있음 AND SUBINV ∈ 부서창고 6종
       AND QTY_OUT > 0 AND TXN_DATE 파싱 성공.  (QTY_IN 은 전혀 쓰지 않는다)
부록 D 의 demand_stats(start,end) 에는 이 gmin·gmax 를 품목마다 같은 값으로 넣는다
(품목별 첫/마지막 거래일이 아니다 — 이걸 품목별로 바꾸면 d_mean·d_std 가 전부 달라진다).
★ 주의: 선택 실행(--keys-file)로 모집단을 줄이면 gmin·gmax 자체가 바뀌어
  전체 실행과 다른 d_mean 이 나온다. 원본의 동작이며 버그가 아니다.
```

**P-2. 부트스트랩 창의 start·end (부록 B 보완)**
```
lt_window_dist(series, start, end, window_days) 호출 시
  series = 그 품목의 ASOF 이하(d ≤ ASOF) 불출 이력만
  start  = series 의 최소 날짜(이력 없으면 gmin)   ← gmin 이 아니라 품목의 첫 소요일
  end    = ASOF                                   ← gmax 가 아니다
  window_days = 그 품목의 lt_mean
난수: rng.randint(0, span) 은 파이썬 기준 **양끝 포함**이다. 다른 언어의 [0,span) 과 다르다.
```

**P-3. 원본의 비일관성 (그대로 따라야 값이 같다)**
```
demand_stats 는 gmin~gmax 전체 이력을 쓰지만(ASOF 이후 거래가 있으면 그것도 포함),
부트스트랩·recency·정체판정은 d ≤ ASOF 만 쓴다. "일관성 있게 고치면" 원본과 달라진다.
```

**P-4. reason(판단근거) 문자열 정확한 포맷 — 화면이 이 문자열을 그대로 표시한다**
```
[보험품]
 소요無·핵심          → f'핵심보험[{grade}] 소요無→기준{max(base,1)}'
 소요無·비핵심·초고가 → '비핵심 초고가+소요無→0'          (단가 > 50,000,000)
 소요無·비핵심        → f'비핵심보험[{grade}] 소요無→0'
 소요有·핵심          → f'핵심보험[{grade}] μ_LT+SS(Z{z})={norm},상한{obs_max},기준{base}→{t}'
 소요有·비핵심        → f'비핵심보험[{grade}] μ_LT+SS(Z{z})={norm},상한{obs_max}→{raw}'
[계획품]
 비핵심설비           → '계획품 원칙0(비핵심설비→수리일정발주)'
 3년무소요            → '핵심설비 계획품이나 3년무소요→0'
 소요비활발           → f'핵심설비 계획품이나 소요비활발(λ{lam_yr:.1f})→0'
 활발                 → f'핵심설비계획품 소요활발(λ{lam_yr:.1f})→소량{t}'
z 는 2.58/2.05/1.65/1.28 이 그대로 문자열에 들어간다(예: "Z1.28").
```

**P-5. 발주 신호등(run_all) 세부 (부록 L 보완)**
```
계획품 분기는 "그 품목에 연결설비가 있고(q2eq에 존재) 그 설비의 미래 정비계획이 있을 때"만
탄다. 미래 일정이 여러 개면 (정지일, 휴지구분, 설비) 를 정렬해 가장 이른 것 하나를 쓴다.
  lt  = lt_mean or 30                       ← 0/None 이면 30
  buf = LEAD_BUFFER.get(kind, 14) + int(0.5 × lt_std)   ← 미등록 휴지구분은 기본 14
  order_by = 정지시작일 − (int(lt) + buf) 일  ← lt 를 **정수 절삭**한다
  D = (order_by − ASOF).days
exp_need = 과거 같은 휴지구분 정지일 ±30일 이내 불출 합들의 평균 → max(1, round(평균))
           과거 사례가 없으면 SparePartHoldingStd, 그것도 없으면 1
           (파이썬 round 는 round-half-even: round(2.5)=2)
보험품(및 미래일정 없는 계획품) 분기의 CSV 값:
  Equipment = 연결설비 중 **첫 1개만**, Kind = '상시',
  StopDate·OrderByDate·D_days = 빈 문자열, **ExpectedNeed = 그 품목의 목표재고(Target)**
정렬: red(0) → yellow(1) → green(2) → gray(3) 순.
```

**P-6. 숫자 서식**
```
restock.csv: UnitCost·StockDept·StockAll·OrderNeed·OrderAmount 는 소수점 없이(f'{x:.0f}'),
Target 은 정수 그대로. StockDept 는 원본에 소수가 있을 수 있으므로 계산은 실수로 하고
출력에서만 반올림한다(round-half-even).
```

**P-7. 정의됐지만 실제로 안 쓰이는 상수 (재구현 시 무시할 것)**
```
TRAIN_RATIO=0.70, SL_GRID=(0.90,0.95,0.98,0.995), SEED=42, planned_lt_gate=60
→ 원본 코드에 남아 있으나 계산에 관여하지 않는다. 이걸 "써야 하는 값"으로 오해하지 말 것.
```

**P-8. 입력 폴더·오류 동작**
```
engine 은 자기 위치의 data/ 폴더를 입력으로 보고, data/ 가 없으면 자기 폴더를 입력으로 쓴다.
출력 폴더는 없으면 자동 생성한다.
classification_result.csv 는 Qcode(또는 Item) + DeptCode(또는 부서코드) + Type(또는 판정)
컬럼을 읽고, 판정이 보험품/계획품이 아닌 행은 건너뛴다. 같은 키에 서로 다른 확정 Type 이
두 번 나오면 예외로 중단하고, Qcode/DeptCode 가 빈 행이 있으면 그 행 번호와 함께 예외를 낸다.
master.csv / txn_history.csv 가 없으면 즉시 오류, maintenance.csv / equipment_map.csv /
classification_result.csv 가 없으면 조용히 빈 값으로 진행한다(0.5장 6번 규칙에 따라
"어떤 파일이 없어서 어떤 기능이 꺼졌는지" 반드시 로그로 출력할 것).
```

**P-9. 정정 — 기존에 "버그"로 기록됐던 항목**
```
`(outbound or inbound or stock_rows or {}).get(...)` 가 "재고 행만 있을 때 터진다"고
적힌 메모가 있으나, 실제로는 outbound/inbound 에 항상 {'events': [...]} 가 병합돼
들어가 딕셔너리가 비지 않으므로 stock_rows(리스트)까지 내려가지 않고 예외도 나지 않는다.
다만 "우연히 안 터지는" 구조이므로, 재구현 시에는 O-2 처럼 매칭 실패를 항상 빈 문자열로
처리하도록 명시적으로 작성한다.
```

---

## 대시보드 연동 규칙 (attr.html · 적정재고 화면 이식용)

> 1단계 결과는 "속성값 판단" 화면(`attr.html`, `ATTR_DATA`)에, 2단계 결과는
> "적정재고 분석" 화면(`STOCK_DATA`)에 들어간다. 화면은 `Qcode+DeptCode`를
> 입력키로 받아 산출값을 표시하는 뷰어일 뿐이므로, **판정·수치 자체는 반드시
> 위 1단계·2단계 알고리즘이 그대로 계산한 값이어야 한다.** 화면 쪽에서 별도
> 규칙이나 상수를 새로 만들면 안 된다.

### 필드 매핑 (알고리즘 산출 → 화면 데이터)

**1단계 → `ATTR_DATA` 레코드**
| 화면 필드 | 값의 출처 (알고리즘) |
|---|---|
| `q` | Qcode |
| `dept` | DeptCode |
| `verdict` | 판정 (`보험품`/`계획품`/`회색지대`/`배제-소모품`/`배제-순환품`) |
| `ins` | si (보험품점수, 0~100) |
| `pln` | sp (계획품점수, 0~100) |
| `conf` | 신뢰도 (HIGH/MEDIUM/LOW) |
| `path` | 판정경로 (`사전 배제`/`QS 확정`/`Spare Part 확정`/`시계열 점수`) |
| `why` | 판단근거 문자열 |
| `was` | master.csv의 원본 Type (판정 전 값) — **화면이 자체 계산하면 안 되고 원본 master 값을 그대로 표시** |
| `trend` | 최근 24개월 월별 불출량 (txn_history 원천에서 집계, 알고리즘 판정에는 안 쓰는 표시용 보조지표) |

**2단계 → `STOCK_DATA` 레코드**
| 화면 필드 | 값의 출처 (알고리즘) |
|---|---|
| `q` | Qcode(Item) |
| `attr` | 1단계 최종 Type (보험품/계획품, `TypeSource`로 반영 여부 추적) |
| `grade` | 중요도 등급 S/A/B/C (criticality) |
| `target` | 적정재고 목표 (reserve_target 또는 planned_target 결과, **부록 H/I 공식 그대로**) |
| `onHand` | StockDept (부서 현재고) |
| `need` | max(0, target − onHand) |
| `signal` | 발주 신호등 (부록 L, red/yellow/green/gray) |
| `act` | 발주/유지/감축 (부록 M restock.csv Action 규칙) |
| `why` | reserve_target/planned_target의 판단근거 문자열 |

### 2차 버킷팅 — "속성값 변경 제안" 뷰 (classify_one과는 별개의 후처리)

> 웹 화면에서 "기존 속성값이 이거였는데, 알고리즘이 이렇게 바꾸자고 제안한다"를
> 보여주려면, 1단계 판정(`verdict`)이 끝난 **뒤에** master 원본 Type(`was`)과
> 비교하는 후처리 한 단계를 추가로 거친다. **이 버킷팅은 classify_one()의 판정
> 로직을 조금도 바꾸지 않는다** — 이미 계산된 `verdict`·`was` 두 값만 비교해서
> 화면 표시용 카테고리 하나를 더 얹는 것뿐이다.

```
web_bucket(was, verdict):
  if verdict in {보험품, 계획품} and verdict != was:
      was가 보험품이면 "보험품→계획품", was가 계획품이면 "계획품→보험품"
  elif verdict == 회색지대:
      "현행유지"
  elif verdict in {보험품, 계획품} and verdict == was:
      "판정일치"
  else:  # 배제-소모품, 배제-순환품
      "배제"
```

- 이 5개 버킷(보험품→계획품 / 계획품→보험품 / 현행유지 / 판정일치 / 배제)은
  서로 배타적이며 합치면 항상 master.csv 전체 품목 수(743)와 같다.
- "속성값 변경 필요" 목록(담당자 승인 대상)은 **보험품→계획품 + 계획품→보험품**
  두 버킷만 모은 것이다. 판정일치·현행유지·배제는 변경 제안이 아니다.
- 이 버킷팅 함수는 `classify_one()`과 물리적으로도 분리된 별도 함수/모듈로
  구현한다(예: `web_bucket.py` 또는 화면 어댑터 레이어). 1단계 알고리즘 코드를
  절대 이 목적으로 수정하지 않는다 — 판정 결과가 바뀌어야 한다면 그건 더미
  데이터(입고·불출·재고 패턴)를 바꿔서 유도하는 것이지, 판정 규칙 자체를
  바꾸는 게 아니다.

### 회색지대 표시 라벨 — "현행유지"

- **내부 판정값(`verdict`, `판정` 컬럼)은 그대로 `회색지대`를 쓴다.** 데이터 자체를 바꾸면 추적·재검토·2단계 연동 로직(회색지대는 2단계 Type을 덮어쓰지 않는다는 규칙)이 깨진다.
- **화면에 노출하는 표시 텍스트만** `회색지대` → **`현행유지`** 로 순화한다. 즉 `verdict === '회색지대'`인 행은 배지·라벨에 `현행유지`라고 쓰되, 내부 필드값·CSV·API 응답은 `회색지대`를 유지한다(표시 전용 매핑, 예: `LABEL_MAP = {회색지대: '현행유지'}`을 렌더링 단계에서만 적용).
- **"현행유지"는 "일치 확인"이 아니라 "판단 보류"라는 의미를 유지해야 한다.** 즉 알고리즘이 기존 값이 맞다고 확인했다는 뜻이 아니라, 점수가 애매해 기존 master Type을 그대로 둔다는 뜻이다. 그래서 `현행유지` 항목에는 반드시 `신뢰도(conf)`와 `판단근거(why)`를 함께 노출해, 담당자가 필요하면 검토·재승인할 수 있게 한다(담당자 승인 워크플로우에서 제외하지 않는다).
- "판정일치"(알고리즘이 보험품/계획품으로 새로 확정했는데 원본 Type과 결과가 같은 경우)와 "현행유지"(애초에 확정을 못 해 원본을 그대로 둔 경우)는 서로 다른 상태이므로 화면에서도 구분해서 표시한다.

### 화면 요약 카드의 정의 (임의로 재정의 금지)

- **"검토 대상"** = master.csv 전체 품목 수 (743).
- **"현행유지"(구 "회색지대")** = 1단계 판정이 정확히 `회색지대`인 품목 수. 사전 배제(`배제-소모품`/`배제-순환품`)나 확정(`QS 확정`/`Spare Part 확정`) 규칙에 걸린 품목은 여기에 포함하지 않는다.
- **"보험품→계획품" / "계획품→보험품"** = master.csv의 원본 `Type`(`was`)과 1단계 새 판정(`verdict`)이 서로 다르고, 새 판정이 `보험품` 또는 `계획품`(유효 Type)인 품목 수. 회색지대·배제 결과는 원본 Type을 덮어쓰지 않으므로 이 카드에 집계하지 않는다.
- **"무재고 비중"류 요약 수치**는 화면에 고정 텍스트로 박아두지 말고, 실제 2단계 계산 결과(target=0 품목 수 ÷ 전체)에서 매번 다시 산출한다.

### ⚠️ 반드시 지켜야 할 것 (원본 대시보드에서 확인된 이탈 사례)

실제 `attr.html`/`assets/analysis-data.js`를 확인해보니 아래처럼 **원본 알고리즘과 다르게 구현된 부분**이 있었다. 이식 시 반드시 원본 알고리즘 기준으로 고쳐야 한다.

1. **안전계수 Z를 고정값(1.28 또는 1.65 등)으로 쓰지 말 것.** 화면마다 "Z=1.28"
   또는 "Z=1.65"라고 다르게 적혀 있었는데, 원본은 등급별로 Z가 다르다
   (S=2.58/A=2.05/B=1.65/C=1.28). 하나의 숫자로 고정하면 S/A/B 등급 보험품의
   안전재고가 실제보다 훨씬 작게(또는 C등급이 크게) 나온다. **"등급별 상한(cap)"
   이라는 개념 자체가 원본에 없다** — 원본의 유일한 상한은 리드타임창 부트스트랩의
   관측상한(obs_max, 부록 H)이다.
   - **구현 후 자가검증(필수)**: S/A/B/C 등급 품목을 각각 하나씩 골라 목표재고
     계산 로그를 찍어보고, 실제로 Z=2.58/2.05/1.65/1.28 **네 가지 값**이
     구분되어 쓰였는지 확인한다. 등급과 무관하게 같은 숫자 하나만 반복해서
     나온다면 고정값을 쓰고 있다는 뜻이니 코드를 다시 확인한다. Z뿐 아니라
     "916,140행" 같은 데이터 건수·비율 문구도 실제 로드된 데이터 크기와 일치하는지
     대조한다(더미데이터가 743건이면 화면 어디에도 743과 무관한 큰 숫자가 고정
     텍스트로 남아있으면 안 된다).
2. **계획품을 "Item Type=Consignment/VMI/일일공급품"으로 정의하지 말 것.** 이 세 값 중 Consignment/일일공급품/자가재는 오히려 "배제-소모품"으로 완전히 제외되는 대상이다(1단계 사전 배제 규칙 ①). VMI는 계획품 점수에 +10점을 더하는 신호일 뿐, VMI=계획품이 아니다. 계획품은 시계열 점수(sp)와 2단계 planned_target 공식(부록 I)으로 결정된다.
3. **순환품(Roll/Roller 계열)은 포함이 아니라 배제.** "순환품 포함" 문구는 원본 사전 배제 규칙 ②(배제-순환품)와 반대다.
4. **요약 카드의 숫자(예: "무재고 비중 84%")를 하드코딩하지 말 것.** 실제 원본 더미데이터로 계산하면 계획품 중 목표재고 0인 비율은 98.7%, 전체 743종 기준으로는 46.4%다. 화면에 다른 고정 수치를 박아두면 데이터가 바뀔 때마다 틀린 값이 남는다.
5. **판정 3종 카드는 master 원본 Type과의 "차이"로 집계할 것**, 5개 판정값 자체의 분포(예: 회색지대 536건)를 그대로 카드에 쓰지 말 것 — 카드 정의와 판정값 집계를 혼동하면 화면의 "현행유지" 수가 실제(6~11건)보다 수십 배 부풀어 보인다.
6. **2단계 수요원(txn_history.csv)을 DOG Type 더미 TSV에서 새로 만들지 말 것.** `appropriate_quantity/txn_history.csv`(22,625행) 원본을 그대로 써야 한다. TSV로 대체하면 품목당 불출 건수가 희박해 리드타임창 부트스트랩의 관측상한이 대부분 0이 되어 부록 H의 안전장치가 무력화되고 보험품 목표재고가 몇 배(검증: 79.5억→534.5억) 부풀어 오른다.
7. **재무효과 숫자 2종을 구분 없이 화면에 쓰지 말 것.** `SUMMARY.txt`/부록 G에는 성격이 완전히 다른 두 값이 함께 나온다.
   - **부서 재무효과**(예: 3,600만원대/년) — 이번 743건 더미데이터를 실제로 계산해서 나온 값.
   - **전사 확산 추정치**(예: 18.5억원/년) — `2,016억`이라는 이 더미데이터와 무관한 별도 고정 상수에 20%·4.6%를 곱한 **가정 기반 참고 수치**일 뿐, 지금 데이터로 계산된 값이 아니다.
   두 값을 구분 없이 화면 카드 하나에 넣으면, 지금까지 지적해온 "데이터와 무관한 하드코딩 수치"(84%, 916,140행)와 동일한 성격의 오해를 만든다. 화면에 노출할 때는 **반드시 라벨로 구분**한다(예: "이번 분석 기준" vs "전사 확산 시 추정"). 전사 확산 값을 보여줄 경우, 그 옆에 "실제 데이터가 아닌 추정치" 문구를 함께 노출한다.

---

## 참고 원본 문서
- 1단계 로직 원본: `Connect Both/connect_both.py`, `Connect Both/CONNECT_BOTH_PROMPT.md`
- 2단계 로직 원본: `appropriate_quantity/engine.py`, `appropriate_quantity/run_all.py`, `appropriate_quantity/01_알고리즘_명세.md`
