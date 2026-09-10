# AI 자재 솔루션

POSCO 해커톤 본선 「스스로 수량을 자제하는 AI 자재 솔루션」.
정비용 자재의 **속성 판단(보험품 / 계획품)** 과 **적정재고 산출**을 자동화하는 사내 웹앱.

```
기준일   2026-09-03
PK       Qcode | DeptCode      743개 조합이 전체 모집단이다
기술     순수 HTML / CSS / JS · 빌드 도구 없음 · 의존성 0 · 차트와 QR 도 직접 그린다
저장소   서버가 없다. 브라우저의 localStorage 가 3층이다
```

---

## 지금 상태

| 층 | 무엇 | 상태 |
| --- | --- | --- |
| 데이터 | 생성기 · 1층 정본 · 2층 파생 · 배포용 공통 DB | 됐다 |
| 공통 DB | 알고리즘 담당용 `db/` · 파이썬 API · SQLite · 검문소 | 됐다 |
| 조회 API | `assets/db.js` · 3층 오버라이드 | 하는 중 |
| 화면 | 13개 | 하는 중 |

`db/BUILD_REPORT.txt` 에 무엇을 검산했는지 다 적혀 있다.

---

## 돌려 보기

파일을 그냥 열어도 돌아간다. 빌드가 없다.

```
index.html 을 브라우저로 열면 login.html 로 간다
```

QR 로 들어오는 화면(`material-view.html?code=Q4039953`)까지 보려면 주소가 필요하다.

```bash
python -m http.server 8000
```

---

## 다시 만들기 · 검사

```bash
# 데이터층을 다시 만든다 (생성기는 이것 하나뿐이다)
PYTHONHASHSEED=0 PYTHONIOENCODING=utf-8 python -B build_master_db.py

# 검사기가 정말 보고 있는지 확인한다 (일부러 깨뜨려 본다)
PYTHONHASHSEED=0 PYTHONIOENCODING=utf-8 python -B test_verify_negative.py

# 알고리즘 담당에게 받은 CSV 를 넣기 전에
python validate_algorithm_csv.py <받은폴더>
```

**결과는 콘솔이 아니라 파일로 나온다.** Windows 콘솔에서 한글이 깨진다.

```
db/BUILD_REPORT.txt      생성 · 검산
db/NEGATIVE_TEST.txt     역시험
db/VALIDATE_REPORT.txt   받은 CSV 검문
```

---

## 폴더

```
index.html · login.html · main.html · attr.html · stock.html ...   화면 13개
assets/
  config.js         기준일 BASE_DATE 와 도메인 상수 · 날짜는 여기에만 있다
  db-master.js      1층 정본        (생성)
  db-derived.js     2층 파생        (생성)
  db-biz.js         업무 거래 상태   (생성)
  plan-data.js      정비계획 데이터  (생성)
  db-changes.js     3층 오버라이드
  db.js             조회 · 쓰기 API · 화면이 쓰는 입구는 이것 하나뿐이다
  shell.css · nav.js · org.js · popover.js · wflow.js · chat.js · tour.js · qr.js
  analysis-data.js · return-data.js · evidence-data.js              화면 어댑터
build_master_db.py            생성기 · 하나뿐이다
validate_algorithm_csv.py     받은 CSV 검문소
test_verify_negative.py       검사기 역시험
db/                           배포용 공통 DB · 알고리즘 담당은 db/README.md 부터
본선_반출 최종본/               반입 자료 (읽기만 한다)
```

---

## 지켜야 하는 원칙 여섯 개

이게 이 프로젝트의 핵심이다. 한 번 크게 틀리고 나서 정한 것이다.

```
1  자재 하나의 정체는 한 곳에만 있다      화면 안에 자재를 적어 두지 않는다
2  PK 는 Qcode|DeptCode                743개 조합이 전체 모집단이다
3  원본을 절대 덮지 않는다               사람이 바꾼 것은 변경 이력으로만 쌓는다
4  현재고를 저장하지 않는다               스냅샷 + Σ 트랜잭션으로 매번 계산한다
5  요약 숫자를 화면에 적어 두지 않는다     산출 결과에서 매번 다시 센다
6  화면은 계산하지 않는다                산식과 상수는 명세에서 읽는다
```

글쓰기 규칙 · em-dash(U+2014) 와 en-dash(U+2013) 를 쓰지 않고 가운뎃점 `·` 을 쓴다.
순수 검정 `#000` 을 쓰지 않는다 (가장 진한 색은 `#1C1D22`).
화면 문구에서 「없음」 대신 **무엇을 하면 되는지**를 적는다.

---

## 팀

| 브랜치 | 담당 | 먼저 읽을 것 |
| --- | --- | --- |
| `dev` | 화면 · 데이터층 · 공통 DB | 이 문서 |
| `feat/algo` | 알고리즘 (판정 · 적정재고) | **`db/README.md`** |
| `feat/rag` | 챗봇 (사내 문서 RAG) | `본선_반출 최종본/프롬프트/C_챗봇_연동계약.md` |

`db/` 는 `dev` 에서 가져간다. **`db/` 안의 파일을 직접 고치지 않는다.**
생성기가 다시 덮어쓴다. 바꿀 것이 있으면 CSV 를 새로 주면 다시 만든다.

---

## 데이터

```
자재 743종 · 부서 1 · 설비 14 · 정비계획 156행
판정   보험품 285 · 계획품 294 · 회색지대 31 · 배제-소모품 111 · 배제-순환품 22
조치   발주 120 · 유지 142 · 감축 481
금액   현행재고 49.74억원 · 목표재고 57.89억원 · 감축가능 29.71억원
정체   262종 9.47억원
```

CSV 는 **더미 데이터**다. 사내 원장 원본이 아니다.
다만 테이블명과 컬럼명은 실제 사내 Oracle 과 같다.
접속 정보만 바꾸면 실데이터로 돌아간다는 것이 이 과제의 주장이고,
`evidence.html`(데이터 근거)이 그 근거를 SQL 로 보여 준다.
