# -*- coding: utf-8 -*-
"""
적정재고 산출 엔진 (자기완결 통합본).
================================================================
이 한 파일에 데이터 로드 → 수요통계 → 중요도등급 → 리드타임창 분포 →
속성별(계획품/보험품) 적정재고 산출 → 정체/공용화 판정까지 모두 담았다.
외부 패키지 불필요(표준 라이브러리만). CSV 입력만 있으면 어디서든 재현된다.

입력(data/ 폴더):
  master.csv         자재 마스터 (아래 필수 컬럼 참조)
    classification_result.csv
                                         1단계 속성분류 결과(Qcode+DeptCode+Type). 있으면 일치 행에만 Type 적용
  txn_history.csv    불출/입고 이력 (Item,TXN_DATE,SUBINV,QTY_IN,QTY_OUT)
  equipment_map.csv  자재↔연결설비, 핵심예비품 보유기준(설치수) 등
  maintenance.csv    정비계획 (설비별 정지일·휴지구분·정지시간·인력)

명세: 01_알고리즘_명세.md, 02_데이터_명세.md 참조.
"""
import os
import csv
import math
import random
from bisect import bisect_left
from collections import defaultdict, Counter
from datetime import datetime, date, timedelta

# ==================== 설정 (재현 고정값) ====================
ASOF = date(2026, 9, 3)                 # 기준일
DEPT_WAREHOUSES = {'QFC01', 'QHB24', 'QHB25', 'QHB27', 'QVC03', 'QVC07'}
TRAIN_RATIO = 0.70                      # 학습/검증 분할 비율
SIGMA_LT_FLOOR_CV = 0.25
SL_GRID = (0.90, 0.95, 0.98, 0.995)
STALE_DAYS = 548                        # 1.5년 = 정체 임계
SEED = 42

FACTORS = ('F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7')
# ★채택 가중치 (train/test 백테스트 최적화 결과: F5 공용성·F1 핵심설비 지배)
W_BEST = {'F1': 0.35, 'F2': 0.01, 'F3': 0.05, 'F4': 0.04,
          'F5': 0.50, 'F6': 0.03, 'F7': 0.02}
DOWNTIME_MEDIAN_KRW = 847_940           # 정지1일당 정비비 중위값(F2 대체용)

CFG = {
    'sl_by_grade': {'S': 0.995, 'A': 0.98, 'B': 0.95, 'C': 0.90},
    'manual_price': 50_000_000,         # 초고가 기준(비핵심 소요無 → 0)
    'recency_half_life': 4.0,
    'planned_dead_years': 3.0,
    'planned_lt_gate': 60,
    'planned_active_lambda': 1.0,       # 계획품 소요활발 기준(연빈도)
    'planned_safety_cap': 1,            # 핵심설비 활발계획품 소량 상한
}
_Z_BY_SL = {0.90: 1.28, 0.95: 1.65, 0.98: 2.05, 0.995: 2.58}

# ==================== 경로 ====================
BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, 'data')
if not os.path.isdir(DATA):
    DATA = BASE
OUT = os.path.join(BASE, 'output')
os.makedirs(OUT, exist_ok=True)
FILTER_KEYS = None


# ==================== 유틸 ====================
def _f(v, d=None):
    if v is None or v == '':
        return d
    try:
        return float(str(v).replace(',', ''))
    except ValueError:
        return d


def median(xs):
    s = sorted(x for x in xs if x is not None)
    if not s:
        return None
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


def stdev(xs):
    n = len(xs)
    if n < 2:
        return 0.0
    m = sum(xs) / n
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (n - 1))


def ceil_pos(x):
    return max(0, int(math.ceil(x - 1e-9)))


def pdate(s):
    s = (s or '').strip()
    for fmt in ('%Y-%m-%d', '%Y/%m/%d', '%Y-%m-%d %H:%M', '%Y-%m-%d %H:%M:%S'):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None


def _z_for(sl):
    return _Z_BY_SL[min(_Z_BY_SL, key=lambda s: abs(s - sl))]


# ==================== 1. 데이터 로드 ====================
def load_classification():
    """1단계 결과를 (Qcode, DeptCode)별 Type override로 읽는다."""
    path = os.path.join(DATA, 'classification_result.csv')
    overrides = {}
    if not os.path.exists(path):
        return overrides
    with open(path, encoding='utf-8-sig') as f:
        for row_no, r in enumerate(csv.DictReader(f), start=2):
            code = (r.get('Qcode') or r.get('Item') or '').strip()
            dept = (r.get('DeptCode') or r.get('부서코드') or '').strip()
            typ = (r.get('Type') or r.get('판정') or '').strip()
            if not code or not dept:
                raise ValueError(
                    f'classification_result.csv {row_no}행: '
                    'Qcode와 DeptCode가 필요합니다.'
                )
            if typ not in ('보험품', '계획품'):
                continue
            key = (code, dept)
            previous = overrides.get(key)
            if previous and previous != typ:
                raise ValueError(
                    f'classification_result.csv 중복 충돌: '
                    f'{code}/{dept}에 {previous}와 {typ}이 함께 있습니다.'
                )
            overrides[key] = typ
    return overrides


def load_master():
    """master.csv → dict[(Item, DeptCode)] = 속성."""
    path = os.path.join(DATA, 'master.csv')
    type_overrides = load_classification()
    items = {}
    with open(path, encoding='utf-8-sig') as f:
        for r in csv.DictReader(f):
            code = (r['Item'] or '').strip()
            if not code:
                continue
            dept = (r.get('DeptCode') or '').strip()
            key = (code, dept)
            if FILTER_KEYS is not None and key not in FILTER_KEYS:
                continue
            original_type = (r.get('Type') or '').strip()
            items[key] = {
                'item': code,
                'dept_code': dept,
                'type': type_overrides.get(key, original_type),
                'type_original': original_type,
                'type_source': ('classification_result.csv'
                                if key in type_overrides else 'master.csv'),
                'csp': (r.get('CriticalSparePart') or '').strip(),
                'ceq': (r.get('CriticalEquipment') or '').strip(),
                'wh': (r.get('Warehouse') or '').strip(),
                'sg': (r.get('SourcingGroup') or '').strip(),
                'stock_dept': _f(r.get('StockDept'), 0.0),
                'stock_all': _f(r.get('StockAll'), 0.0),
                'sup_item': _f(r.get('SupplierCount'), 1.0),
                'unit_cost': _f(r.get('UnitCost'), 0.0),
                'lt_mean_raw': _f(r.get('LeadTimeMean')),
                'lt_std_raw': _f(r.get('LeadTimeStd')),
                'cycles': _f(r.get('CompletedCycles'), 0.0),
                'sourcing': (r.get('ProcurementType') or '').strip(),
                'recv_date': pdate(r.get('ReceivingDate')),
            }
    return items


def load_txn(items):
    """txn_history.csv → 부서창고 불출 시계열."""
    path = os.path.join(DATA, 'txn_history.csv')
    demand = defaultdict(lambda: defaultdict(float))
    dates = []
    with open(path, encoding='utf-8-sig') as f:
        for r in csv.DictReader(f):
            code = (r['Item'] or '').strip()
            dept = (r.get('DeptCode') or '').strip()
            key = (code, dept)
            if key not in items:
                continue
            if (r.get('SUBINV') or '').strip() not in DEPT_WAREHOUSES:
                continue
            q = _f(r.get('QTY_OUT'), 0.0)
            if q <= 0:
                continue
            d = pdate(r.get('TXN_DATE'))
            if not d:
                continue
            demand[key][d] += q
            dates.append(d)
    return demand, ((min(dates), max(dates)) if dates else (None, None))


def load_equipment_map():
    """equipment_map.csv → Q코드별 연결설비, 설치수기준(핵심예비품 보유기준)."""
    path = os.path.join(DATA, 'equipment_map.csv')
    q2eq = defaultdict(list)
    hold_std = {}
    if os.path.exists(path):
        with open(path, encoding='utf-8-sig') as f:
            for r in csv.DictReader(f):
                q = (r['Item'] or '').strip()
                dept = (r.get('DeptCode') or '').strip()
                eq = (r.get('LinkedEquipment') or '').strip()
                if eq:
                    q2eq[(q, dept)].append(eq)
                h = _f(r.get('SparePartHoldingStd'))
                if h:
                    hold_std[(q, dept)] = int(h)
    return q2eq, hold_std


def load_maintenance():
    """maintenance.csv → 설비별 (미래정지일, 휴지구분) / 과거정지일."""
    path = os.path.join(DATA, 'maintenance.csv')
    future, past = defaultdict(list), defaultdict(list)
    sev_rows = defaultdict(lambda: {'cumdur': 0.0, 'ppl': [], 'big': 0, 'n': 0})
    if not os.path.exists(path):
        return future, past, {}
    with open(path, encoding='utf-8-sig') as f:
        for r in csv.DictReader(f):
            eq = (r.get('Equipment') or '').strip()
            dept = (r.get('DeptCode') or '').strip()
            d = pdate(r.get('StopStart'))
            kind = (r.get('MaintKind') or '').strip()
            if not eq or not d:
                continue
            eq_key = (dept, eq)
            (future if d >= ASOF else past)[eq_key].append((d, kind))
            s = sev_rows[eq_key]
            s['n'] += 1
            dur = _f(r.get('StopHours'), 0.0)
            s['cumdur'] += dur or 0
            p = _f(r.get('Manpower'))
            if p:
                s['ppl'].append(p)
            if kind in ('대수리', '합리화'):
                s['big'] += 1
    # severity 등급
    sev = _severity(sev_rows)
    return future, past, sev


def _severity(rows):
    if not rows:
        return {}
    mx_cum = max((v['cumdur'] for v in rows.values()), default=1) or 1
    mx_ppl = max((sum(v['ppl']) / len(v['ppl']) if v['ppl'] else 0
                  for v in rows.values()), default=1) or 1
    mx_big = max((v['big'] for v in rows.values()), default=1) or 1
    scored = []
    for eq, v in rows.items():
        appl = sum(v['ppl']) / len(v['ppl']) if v['ppl'] else 0
        s = (0.55 * math.log1p(v['cumdur']) / math.log1p(mx_cum)
             + 0.25 * appl / mx_ppl + 0.20 * v['big'] / mx_big)
        scored.append((eq, s))
    scored.sort(key=lambda x: -x[1])
    n = len(scored)
    out = {}
    for i, (eq, s) in enumerate(scored):
        q = i / n if n else 1
        out[eq] = 'High' if q < 0.25 else 'Mid' if q < 0.60 else 'Low'
    return out


# ==================== 2. 수요 통계 ====================
def demand_stats(series, start, end):
    days = max(1, (end - start).days + 1)
    total = sum(series.values())
    n_evt = len(series)
    years = days / 365.25
    bucket = defaultdict(float)
    for d, q in series.items():
        bucket[(d.year, d.month)] += q
    months = max(1, round(days / 30.44))
    vals = list(bucket.values()) + [0.0] * max(0, months - len(bucket))
    m_mean = sum(vals) / len(vals) if vals else 0.0
    m_std = stdev(vals)
    cv = m_std / m_mean if m_mean > 0 else 0.0
    adi = months / len(bucket) if bucket else 0.0
    sizes = sorted(series.values())
    last = max(series) if series else None
    if adi == 0:
        pattern = 'No-Demand'
    elif adi < 1.32 and cv ** 2 < 0.49:
        pattern = 'Smooth'
    elif adi < 1.32:
        pattern = 'Erratic'
    elif cv ** 2 < 0.49:
        pattern = 'Intermittent'
    else:
        pattern = 'Lumpy'
    return {
        'total': total, 'events': n_evt, 'days': days,
        'annual': total / years if years > 0 else 0.0,
        'events_yr': n_evt / years if years > 0 else 0.0,
        'd_mean': total / days, 'd_std': m_std / math.sqrt(30.44),
        'cv': cv, 'adi': adi, 'pattern': pattern,
        'size_mean': (sum(sizes) / len(sizes)) if sizes else 0.0,
        'last': last, 'idle_days': (end - last).days if last else None,
    }


# ==================== 3. 리드타임창 부트스트랩 ====================
def lt_window_dist(series, start, end, window_days, n_samples=400, seed=7):
    w = max(1, int(round(window_days)))
    total_days = (end - start).days + 1
    if total_days <= 0 or not series:
        return {'samples': []}
    off = defaultdict(float)
    for d, q in series.items():
        off[(d - start).days] += q
    keys = sorted(off)
    rng = random.Random(seed)
    span = max(1, total_days - w)
    sums = []
    for _ in range(n_samples):
        s0 = rng.randint(0, span)
        lo, hi = bisect_left(keys, s0), bisect_left(keys, s0 + w)
        sums.append(sum(off[keys[i]] for i in range(lo, hi)))
    sums.sort()
    return {'samples': sums}


def _sl_quantile(samples, sl):
    s = sorted(x for x in samples if x > 0)
    if not s:
        return 0.0
    i = min(len(s) - 1, int(math.ceil(sl * len(s))) - 1)
    return s[max(0, i)]


# ==================== 4. LT 보정 ====================
def impute_lt(items):
    ok = [it for it in items.values()
          if it['lt_mean_raw'] and (it['cycles'] or 0) >= 2]
    sg_lt, ty_lt = defaultdict(list), defaultdict(list)
    for it in ok:
        sg_lt[it['sg']].append(it['lt_mean_raw'])
        ty_lt[it['type']].append(it['lt_mean_raw'])
    g_lt = median([it['lt_mean_raw'] for it in ok]) or 60.0
    g_sd = median([it['lt_std_raw'] for it in ok
                   if it['lt_std_raw']]) or 15.0
    for it in items.values():
        lt = it['lt_mean_raw']
        if not lt or lt <= 0:
            lt = (median(sg_lt.get(it['sg'], [])) or
                  median(ty_lt.get(it['type'], [])) or g_lt)
        it['lt_mean'] = max(1.0, lt)
        sd = it['lt_std_raw']
        if not sd or sd <= 0:
            sd = max(g_sd, it['lt_mean'] * SIGMA_LT_FLOOR_CV)
        it['lt_std'] = max(0.5, sd)


# ==================== 5. 중요도 등급 ====================
def pct_rank(values):
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        avg = (i + j) / 2 / max(1, len(values) - 1)
        for k in range(i, j + 1):
            ranks[order[k]] = avg
        i = j + 1
    return ranks


def criticality(items, dstats, weights=W_BEST):
    codes = list(items)

    def col(fn):
        return [fn(items[c], dstats.get(c, {})) for c in codes]
    F = {
        'F1': col(lambda it, s: (0.5 if it['csp'] == 'O' else 0)
                  + (0.5 if it['ceq'] == 'O' else 0)),
        'F2': pct_rank(col(lambda it, s: DOWNTIME_MEDIAN_KRW)),
        'F3': pct_rank(col(lambda it, s: it['lt_mean'] + it['lt_std'])),
        'F4': pct_rank(col(lambda it, s: 1.0 / max(1.0, it['sup_item'] or 1))),
        'F5': pct_rank(col(lambda it, s: (it['stock_dept'] / it['stock_all'])
                           if it['stock_all'] else 1.0)),
        'F6': pct_rank(col(lambda it, s: s.get('events_yr', 0.0))),
        'F7': pct_rank(col(lambda it, s: (0.5 if it['sourcing'] == '수입' else 0)
                           + (0.5 if (it['sup_item'] or 0) <= 1 else 0))),
    }
    wsum = sum(weights.get(k, 0) for k in FACTORS) or 1.0
    out = {}
    for k, c in enumerate(codes):
        sc = sum(weights.get(f, 0) * F[f][k] for f in FACTORS) / wsum * 100
        out[c] = {'score': sc}
    ranked = sorted(codes, key=lambda c: -out[c]['score'])
    for i, c in enumerate(ranked):
        p = i / max(1, len(ranked) - 1)
        out[c]['grade'] = ('S' if p <= 0.05 else 'A' if p <= 0.20
                           else 'B' if p <= 0.60 else 'C')
    for c in codes:                       # 도메인 규칙: 핵심예비품은 S
        if items[c]['csp'] == 'O':
            out[c]['grade'] = 'S'
    return out


# ==================== 6. 속성별 적정재고 ====================
def recency(events, asof, half_life=4.0):
    if not events:
        return 0.0, None
    wcnt = 0.0
    last = None
    for d, q in events:
        yrs = (asof - d).days / 365.25
        wcnt += 0.5 ** (yrs / half_life)
        if last is None or d > last:
            last = d
    span = max((asof - min(d for d, _ in events)).days / 365.25, 1e-9)
    idle = (asof - last).days / 365.25 if last else None
    return wcnt / span, idle


def reserve_target(item, lt_samples, events, crit, hold_std, stats):
    """보험품 = 품목별 실적 기반 안전재고 (μ_LT + SS)."""
    is_crit = (item['csp'] == 'O' or item['ceq'] == 'O')
    base = hold_std.get((item['item'], item['dept_code'])) or 1
    grade = crit['grade']
    sl = CFG['sl_by_grade'][grade]
    z = _z_for(sl)
    if not events:
        if is_crit:
            return max(base, 1), f'핵심보험[{grade}] 소요無→기준{max(base,1)}'
        if item['unit_cost'] > CFG['manual_price']:
            return 0, '비핵심 초고가+소요無→0'
        return 0, f'비핵심보험[{grade}] 소요無→0'
    lt = item.get('lt_mean', 30) or 30
    pos = sorted(x for x in lt_samples if x > 0)
    obs_max = ceil_pos(pos[-1]) if pos else 0
    if stats:
        mu_lt = stats.get('d_mean', 0) * lt
        ss = z * stats.get('d_std', 0) * math.sqrt(max(lt, 1))
        norm = ceil_pos(mu_lt + ss)
        norm = max(norm, ceil_pos(stats.get('size_mean', 0)))
    else:
        norm = ceil_pos(_sl_quantile(lt_samples, sl))
    raw = min(norm, obs_max) if obs_max > 0 else norm
    if is_crit:
        t = max(raw, base, 1)
        return t, f'핵심보험[{grade}] μ_LT+SS(Z{z})={norm},상한{obs_max},기준{base}→{t}'
    return raw, f'비핵심보험[{grade}] μ_LT+SS(Z{z})={norm},상한{obs_max}→{raw}'


def planned_target(item, lt_samples, events, crit, sev_grade):
    """계획품 = 원칙 0 + 핵심설비·소요활발 예외 소량."""
    lam_yr, idle = recency(events, ASOF, CFG['recency_half_life'])
    is_crit_flag = (item['csp'] == 'O' or item['ceq'] == 'O')
    is_crit_equip = is_crit_flag or (sev_grade == 'High')
    if not is_crit_equip:
        return 0, '계획품 원칙0(비핵심설비→수리일정발주)'
    if idle is None or idle > CFG['planned_dead_years']:
        return 0, f'핵심설비 계획품이나 {CFG["planned_dead_years"]:.0f}년무소요→0'
    recently = (idle is not None and idle <= 1.5)
    if not (recently and lam_yr >= CFG['planned_active_lambda']):
        return 0, f'핵심설비 계획품이나 소요비활발(λ{lam_yr:.1f})→0'
    sl = CFG['sl_by_grade'][crit['grade']]
    q = ceil_pos(_sl_quantile(lt_samples, sl))
    t = max(1, min(q, CFG['planned_safety_cap']))
    return t, f'핵심설비계획품 소요활발(λ{lam_yr:.1f})→소량{t}'


def pooling_grade(stock_dept, stock_all, is_crit, typ):
    if stock_all - stock_dept > 0:
        return 'strong', '즉시공용화(전사재고有)'
    if is_crit and typ == '보험품':
        return 'review', '보류/전환(핵심보험)'
    return 'medium', '공용화권장(비핵심·계획품)'


# ==================== 7. 메인 산출 ====================
def compute():
    items = load_master()
    demand, (gmin, gmax) = load_txn(items)
    q2eq, hold_std = load_equipment_map()
    future, past, sev_by_eq = load_maintenance()
    impute_lt(items)

    # Q코드별 severity(연결설비 최고등급)
    order = {'High': 3, 'Mid': 2, 'Low': 1}
    q_sev = {}
    for q, eqs in q2eq.items():
        best = None
        for e in eqs:
            g = sev_by_eq.get((q[1], e))
            if g and (best is None or order[g] > order[best]):
                best = g
        if best:
            q_sev[q] = best

    st_all = {c: demand_stats(demand.get(c, {}), gmin, gmax) for c in items}
    crit = criticality(items, st_all, W_BEST)

    targets, reasons, stale = {}, {}, []
    for c, it in items.items():
        past_ev = [(d, q) for d, q in demand.get(c, {}).items() if d <= ASOF]
        series = {d: q for d, q in past_ev}
        dist = lt_window_dist(series, min(series) if series else gmin, ASOF,
                              it['lt_mean'], seed=abs(hash(c)) % 99991)
        samples = dist['samples']
        if it['type'] == '보험품':
            t, r = reserve_target(it, samples, past_ev, crit[c], hold_std, st_all[c])
        else:
            t, r = planned_target(it, samples, past_ev, crit[c], q_sev.get(c))
        targets[c], reasons[c] = t, r
        # 정체/공용화
        rd = it['recv_date']
        age = (ASOF - rd).days if rd else None
        _, idle = recency(past_ev, ASOF, CFG['recency_half_life'])
        recently = (idle is not None and idle <= 1.5)
        is_crit = (it['csp'] == 'O' or it['ceq'] == 'O')
        if (it['stock_dept'] > 0 and age is not None and age >= STALE_DAYS
                and not recently):
            pg, act = pooling_grade(it['stock_dept'], it['stock_all'], is_crit, it['type'])
            stale.append({'item': it['item'], 'dept_code': it['dept_code'],
                          'type': it['type'], 'grade': crit[c]['grade'],
                          'age': age, 'stock': it['stock_dept'],
                          'value': it['stock_dept'] * it['unit_cost'],
                          'pool_grade': pg, 'action': act})
    return {'items': items, 'crit': crit, 'targets': targets, 'reasons': reasons,
            'stale': stale, 'q2eq': q2eq, 'future': future, 'past': past,
            'demand': demand, 'hold_std': hold_std, 'period': (gmin, gmax)}


if __name__ == '__main__':
    d = compute()
    items, tg = d['items'], d['targets']
    cur = sum(i['stock_dept'] * i['unit_cost'] for i in items.values())
    tv = sum(tg[c] * items[c]['unit_cost'] for c in items)
    print(f"items={len(items)} 현행재고={cur:,.0f} v3목표={tv:,.0f} "
          f"정체={len(d['stale'])}")
    print("grades=", dict(Counter(v['grade'] for v in d['crit'].values())))
