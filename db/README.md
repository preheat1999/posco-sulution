# 공통 DB · 알고리즘 담당이 먼저 읽는 문서

POSCO 해커톤 본선 「스스로 수량을 자제하는 AI 자재 솔루션」.
**화면과 알고리즘이 같은 DB 를 본다.** 이 폴더가 그 DB 다.

```
기준일   2026-09-03        이 값 하나만 쓴다
PK       Qcode | DeptCode  743개 조합이 전체 모집단이다
```

> 왜 이 폴더가 있는가 · 지난번에 화면과 알고리즘이 각자 CSV 를 읽었다.
> 그래서 자재 검색 화면만 보험품 441종을 보고 나머지 화면은 302종을 봤다.
> 같은 코드가 화면마다 다른 자재였다. **읽는 입구를 하나로 만들어서 막는다.**

---

## 1. 무엇이 들어 있나

```
db/
├ README.md            지금 읽는 것. 규칙이 여기 있다
├ mtrl_db.py           파이썬 조회 API. 화면의 assets/db.js 와 같은 구조다
├ posco_mtrl.sqlite    SQL · pandas 진입점. 표 11개 + 3층 빈 표 4개
├ schema.json          컬럼별 타입 · PK · 읽는 법
├ spec.json            산식 상수 (Z · 7요인 · 선행일수)
├ summary.json         요약 숫자
├ master.json          1층 정본 (부서 · 자재 743 · 설비 14 · 정비계획 156)
├ derived.json         2층 파생 (판정 743 · 적정재고 743 · 정체 262)
├ biz.json             업무 거래 상태 (반납 10 · 구매 6 · QR 2 · 연관 3)
├ plan.json            정비계획 화면 데이터 (WO 156 · 마감일 계산 완료)
├ csv/                 위와 같은 데이터의 CSV (UTF-8 BOM · 타입 복원본)
└ BUILD_REPORT.txt     생성 · 검산 기록. 무엇을 확인했는지 여기 있다
```

**전부 `build_master_db.py` 하나가 만든다.** 생성기를 새로 만들지 않는다.
여러 개가 되면 한 파일만 옛 값으로 남아서 화면마다 다른 답을 한다.

---

## 2. 읽는 법 네 가지 · 아무거나 편한 것

### 2-1. 파이썬 API (권장) · 화면과 **똑같은** 구조

```python
import sys; sys.path.insert(0, 'db')
from mtrl_db import DB

db = DB()
row = db.item('Q4039953')          # 한 건. 1층+2층+3층이 겹쳐진 값
row['name'], row['target'], row['type'], row['typeSrc']

db.list(type='보험품')              # 382종
db.list(action='발주')              # 120종
db.list(grade=['S', 'A'])          # 배열도 된다
db.list(price=lambda v: v > 1e8)   # 함수도 된다

db.summary()['action']             # 행에서 다시 센 값
db.spec()['z']['S']                # 2.58
db.meta()['asof']                  # 2026-09-03
```

화면 쪽 `assets/db.js` 의 `DB.item` `DB.list` `DB.summary` `DB.meta` 와
**함수 이름 · 필드 이름 · 층을 겹치는 순서가 같다.** 한쪽에서 확인한 값이
다른 쪽에서 그대로 나와야 한다.

### 2-2. pandas

```python
df = db.frame()                    # 743행 DataFrame
df.groupby('type')['amount'].sum()
```

### 2-3. SQL

```python
db.sql("select q, name, target, action from stock "
       "join materials using (q, dept) where action = '발주'")
```

또는 `sqlite3 db/posco_mtrl.sqlite` 로 직접.
표 이름만 영문이다 (`materials` `attr` `stock` `pool` `equipment`
`maintenance` `returns_tx` `purchase_tx` `qr_tags` `related` `depts`).
**컬럼 이름은 CSV 와 완전히 같다.**

> `db.sql()` 은 1층 · 2층만 준다. 3층(사람이 승인 · 반납한 것)이 겹쳐지지 않는다.
> 승인 후의 값이 필요하면 `item()` `list()` 를 쓴다.

### 2-4. CSV

`db/csv/` 에 있다. UTF-8 BOM 이라 Excel 에서 바로 열린다.
**타입이 복원된 뒤 다시 쓴 것**이라 원본과 대조하기 좋다.

---

## 3. 유의할 규칙 열 개

어기면 화면이 조용히 틀린다. 오류가 안 나기 때문에 시연 직전에 발견된다.

| # | 규칙 | 어겼을 때 실제로 벌어진 일 |
| --- | --- | --- |
| 1 | **기준일은 `2026-09-03` 하나다** | `connect_both.py` 09-07 · `engine.py` 09-03 이라 마감일이 4일씩 어긋났다 |
| 2 | **PK 는 `q` + `dept` 두 칸이다** | 자재코드만으로는 부서별 재고를 구분할 수 없다 |
| 3 | **743행 전건을 낸다** | 빠지면 화면이 반쪽만 본다. 클릭하면 빈 화면이 뜬다 |
| 4 | **숫자를 문자열로 주지 않는다** | `holdStd` 가 `'1'` 로 남아 102행의 목표재고가 어긋났다 |
| 5 | **`PYTHONHASHSEED=0`** | 집합 순서가 달라져 같은 입력에 다른 결과가 나온다 |
| 6 | **UTF-8 BOM 으로 낸다** | Excel 에서 한글이 깨진다 |
| 7 | **요약을 손으로 적지 않는다** | 요약만 고치고 행은 안 고쳐서 숫자가 서로 안 맞았다 |
| 8 | **원본을 덮지 않는다** | 사람이 바꾼 것은 3층에 이력으로만 쌓는다. 되돌릴 수 없게 된다 |
| 9 | **현재고를 저장하지 않는다** | `stockDept + Σ 트랜잭션` 으로 계산한다. 두 번 반납하면 무엇이 맞는지 알 수 없다 |
| 10 | **`reason` 은 사람이 읽을 문장으로** | 이 문자열이 화면의 근거 패널에 **그대로** 나간다 |

### 알고리즘 규격에서 특히 어긋났던 것

```
1  안전계수 Z 는 등급별이다 · S 2.58 / A 2.05 / B 1.65 / C 1.28
   하나로 고정하면 안 된다

2  등급 캡(상한) 개념은 없다
   유일한 상한은 리드타임창 부트스트랩 400회의 관측상한이다

3  계획품은 Item Type 으로 정하지 않는다
   Consignment · 일일공급품 · 자가재는 1단계에서 배제-소모품으로 빠진다
   VMI 는 계획품 점수 +10 신호일 뿐, VMI = 계획품이 아니다

4  순환품(Roll/Roller 계열)은 포함이 아니라 배제다 (배제-순환품)

5  배제가 QS 확정보다 상위 조건이다
   QS 자재는 배제이거나 「보험품(QS 확정)」 이어야 한다

6  선행일수 6종
   합리화 60 · 대수리 45 · 중수리 21 · 정기수리 14 · 교체휴지 10 · 공정휴지 7
   지난번에 검사기 쪽만 옛값(교체휴지 14 · 공정휴지 없음)으로 남아 있었다

7  1단계 판정
   si >= 55 & 차이 >= 15 -> 보험품 / sp >= 55 & 차이 <= -15 -> 계획품 / 그 외 회색지대
   신뢰도 |차이| 25 이상 HIGH · 15 이상 MEDIUM · 그 외 LOW

8  7요인 가중치
   F5 공용성 0.50 · F1 핵심설비 0.35 · F3 리드타임 0.05 · F4 대체성 0.04
   F6 고장확률 0.03 · F7 조달난이도 0.02 · F2 고장영향 0.01
```

### 확정은 둘뿐이다

```
보험품 · 계획품     확정
회색지대 · 배제      판단을 못 내린 것 -> 정본 Type 을 유지한다
```

**회색지대를 「일치」 로 세면 알고리즘이 실제보다 잘한 것처럼 보인다.**
승인할 수 있는 값도 보험품 · 계획품 둘뿐이다. 배제로 승인할 수는 없다.

---

## 4. 이 데이터에서 실제로 발견한 함정 세 개

내가 만들면서 걸린 것들이다. **같은 자리에서 막힐 것 같아 미리 적어 둔다.**

### 4-1. `04_정비계획.csv` 의 선언 PK 가 유일하지 않다

```
선언 PK   eq + kind + stopStart
실제      12건 중복 (전부 2026-11-27 합리화 · 설비 12기가 각각 두 줄)
```

**`GROUP BY` 없이 조인하면 행이 두 배로 불어난다.** 오류는 안 난다.
SQLite 에서는 이 표만 대리키(`rid`)로 받았고 선언 PK 에는 색인만 걸었다.
`BUILD_REPORT.txt` 의 `[9]` 항목에 기록돼 있다.

### 4-2. WO 번호는 원천에 없다

`plan.json` 의 `wo`(`M260906RM73` 같은 값)는 **내가 만든 표시용 식별자**다.
`M + yymmdd + 휴지코드 2자리 + 설비명 체크섬 2자리`.
원천에 WO 번호 컬럼이 없다. 알고리즘 쪽에서 WO 를 키로 쓰지 말고
`(eq, kind, stopStart)` 를 쓴다.

### 4-3. 마감일은 **내림**이다

```
발주 마감일 = 정지시작일 - floor(리드타임평균 + 선행일수 + 0.5 x 리드타임편차)
```

`round` 로 하면 하루씩 밀린다. 리허설 기록의 값
(QOC Servo 합리화 2026-09-06 -> 마감 2025-11-20 · 초과 287일)은
**내림에서만** 정확히 재현된다.

그리고 WO 하나의 마감일은 **발주 필요 자재 중 가장 이른 마감일**이다.
리드타임이 가장 긴 자재가 마감을 정한다. 평균으로 잡으면 늦게 시작한다.

---

## 5. 낼 것

| 파일 | 행 수 | 비고 |
| --- | --- | --- |
| `판정.csv` | **743** | `q` `dept` `verdict` `path` `why` `si` `sp` `conf` `cspScore` `stockSrc` |
| `적정재고.csv` | **743** | `q` `dept` `type` `typeSrc` `grade` `target` `need` `amount` `action` `reason` `signal` `status` `sigEq` `sigKind` `stopDate` `dueDate` `dDays` `expect` `issues` `trend` |
| `정체.csv` | 정체된 것만 | `q` `dept` `ageDays` `staleValue` `poolGrade` `action` |
| `명세상수.json` | · | `z` `sl` `insFormula` `plnFormula` `gradeRule` `factors` `signalIns` `signalPln` `stale` `pool` `finance` `asof` |
| `요약값.json` | · | `items` `insItems` `plnItems` `nowAmt` `tgtAmt` `cutAmt` `verdict{}` `action{}` `grade{}` `signal{}` `conf{}` `path{}` `zeroTarget` ... |

컬럼 이름과 허용값은 `schema.json` 이 정본이다. 값은 `db/csv/` 를 그대로 보면 된다.

`trend` 는 **세미콜론으로 24개** (`3;0;1;...`).
`need` 는 `max(0, target - stockDept)`.
`action` 은 `target > stockDept ? 발주 : (target == stockDept ? 유지 : 감축)`.

---

## 6. 내기 전에 스스로 검문한다

```
python validate_algorithm_csv.py <낸 폴더>
```

결과는 `db/VALIDATE_REPORT.txt` 로 나온다 (Windows 콘솔에서 한글이 깨진다).
10가지를 본다 · 행 수 · PK · 허용값 · 산식 재계산 · 요약 재계산 ·
숫자 타입 · BOM · 컬럼 · 기준일 · em-dash.

**이 검문소는 일부러 깨뜨려 확인했다.** 11군데를 틀리게 만들어 넣었더니
19건을 잡았다 (기준일 09-07 섞임 포함). 통과만 보고 넘어가면
검사가 아무것도 안 보고 있어도 알 수 없다.

통과했으면

```
1  낸 파일을 본선_반출 최종본/데이터/ 에 덮는다
2  PYTHONHASHSEED=0 PYTHONIOENCODING=utf-8 python -B build_master_db.py
3  db/BUILD_REPORT.txt 에서 「검산 통과」 를 확인한다
```

---

## 7. 주고받는 순서

```
지금        내가 이 폴더를 dev 브랜치에 올려 뒀다. git pull 하면 받는다
1시간 뒤    판정 CSV 만 먼저 준다 (적정재고보다 먼저 나온다)
           내가 743행 · PK 두 칸 · verdict 5종을 확인해 알려 준다
2~3시간 뒤  적정재고 CSV + 정체 CSV + 명세상수 + 요약값
           내가 요약을 행에서 다시 세어 대조하고 결과를 알려 준다
오후        갱신본이 있으면 한 번 더. 그 뒤로는 고정한다
시연 30분 전 데이터 동결. 이때부터 아무것도 바꾸지 않는다
```

**늦어도 괜찮다.** 지금 이 폴더의 값으로 화면이 이미 다 돌아간다.
나중에 갈아끼우면 된다. 서두르다 틀린 것을 넣는 게 제일 위험하다.

브랜치는 `feat/algo` 를 쓰고, DB 가 필요하면 `dev` 에서 `db/` 만 가져간다.
**`db/` 안의 파일을 직접 고치지 않는다.** 생성기가 다시 덮어쓴다.
바꿀 것이 있으면 CSV 를 새로 내주면 내가 생성기로 다시 만든다.

---

## 8. 3층 · 사람이 화면에서 한 일

화면에서 담당자가 승인 · 반납을 하면 `localStorage` 에 이력으로 쌓인다.
그 상태로 알고리즘을 다시 돌려 보고 싶으면 이렇게 한다.

```python
# 화면 콘솔에서 · copy(JSON.stringify(DB.changes()))
db = DB(changes=my_changes_dict)
db.item('Q1000108')['typeSrc']   # 'override'
db.summary()['action']           # 승인 · 반납이 반영된 값
```

표는 넷뿐이고 **선언한 컬럼만 통과한다.**

```
attribute_overrides  q dept newType approvedBy approvedAt priorVerdict reason
stock_transactions   q dept txnType qty txnAt processedBy note
pooling_overrides    q dept action by at note
pr_drafts            q dept data by at
```

`txnType` 은 `반납` `불출` `입고` `공용전환` 넷뿐이다.
`qty` 는 **언제나 양수**로 넣고 부호는 읽는 쪽이 종류를 보고 정한다
(`반납 +1 · 입고 +1 · 불출 -1 · 공용전환 -1`).

---

## 9. 막히면

| 증상 | 먼저 볼 것 |
| --- | --- |
| 숫자가 요약과 안 맞는다 | `db.summary()` 와 `db.summary_shipped()` 를 나란히 찍어 본다 |
| 조인했더니 행이 늘었다 | `04_정비계획` PK 중복 12건 (4-1) |
| 마감일이 하루씩 밀린다 | 내림(floor)인지 확인 (4-3) |
| 목표재고가 102행 어긋난다 | `holdStd` 가 문자열로 읽혔다 |
| 같은 입력에 다른 결과 | `PYTHONHASHSEED=0` 을 빼먹었다 |
| Excel 에서 한글이 깨진다 | UTF-8 BOM 으로 저장한다 |
