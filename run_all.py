# -*- coding: utf-8 -*-
"""
전 과정 실행 진입점.
================================================================
engine.compute() 로 적정재고를 산출하고, 아래 산출물을 output/ 에 생성한다.
  1) restock.csv          품목별 적정재고·발주필요·근거
  2) order_signals.csv    계획품+보험품 발주 신호등(🔴🟡🟢⚪)
  3) pooling.csv          1.5년+ 정체 공용화 후보
  4) SUMMARY.txt          요약 리포트(재고감축·품절·재무효과)

사용법: python -B run_all.py
전제: data/ 에 master.csv, txn_history.csv, equipment_map.csv, maintenance.csv
"""
import os
import csv
from datetime import timedelta
from collections import Counter
import engine as E

OUT = E.OUT
INTEREST, CONTRIB = 0.046, 0.20          # 재무효과: 감축액×기여율×이자율
LEAD_BUFFER = {'합리화': 60, '대수리': 45, '중수리': 21,
               '정기수리': 14, '교체휴지': 10, '공정휴지': 7}


def won(x):
    return f'{x:,.0f}'


def signal_reserve(cur, tgt):
    if tgt <= 0:
        return 'gray', '재고불요'
    if cur <= 0 or cur < tgt * 0.5:
        return 'red', '즉시발주'
    if cur < tgt:
        return 'yellow', '발주임박'
    if cur > tgt:
        return 'gray', '충분'
    return 'green', '여유'


def main():
    d = E.compute()
    items, tg, rs = d['items'], d['targets'], d['reasons']
    crit, stale = d['crit'], d['stale']
    q2eq, future, past, demand = d['q2eq'], d['future'], d['past'], d['demand']
    hold_std = d['hold_std']

    # ---------- 1) restock.csv ----------
    with open(os.path.join(OUT, 'restock.csv'), 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(['Item', 'DeptCode', 'Type', 'TypeSource', 'Grade', 'CSP', 'CEQ', 'UnitCost',
                    'StockDept', 'StockAll', 'Target', 'OrderNeed',
                    'OrderAmount', 'Action', 'Reason'])
        for c, it in items.items():
            need = max(0, tg[c] - it['stock_dept'])
            act = '발주' if need > 0 else ('감축' if tg[c] < it['stock_dept'] else '유지')
            w.writerow([it['item'], it['dept_code'], it['type'], it['type_source'],
                        crit[c]['grade'],
                        it['csp'], it['ceq'],
                        f'{it["unit_cost"]:.0f}', f'{it["stock_dept"]:.0f}',
                        f'{it["stock_all"]:.0f}', tg[c], f'{need:.0f}',
                        f'{need * it["unit_cost"]:.0f}', act, rs[c]])

    # ---------- 2) order_signals.csv (계획품 수리일정 + 보험품 재고포지션) ----------
    # 계획품 발주기준일용: 과거 같은 휴지구분 시점 ±30일 불출 평균
    def exp_need(c, kind):
        evs = demand.get(c, {})
        vals = []
        for eqs in [q2eq.get(c, [])]:
            for eq in eqs:
                for (pd_, k) in past.get((c[1], eq), []):
                    if k != kind:
                        continue
                    s = sum(q for dd, q in evs.items() if abs((dd - pd_).days) <= 30)
                    if s > 0:
                        vals.append(s)
        if vals:
            return max(1, round(sum(vals) / len(vals)))
        return hold_std.get(c, 0) or 1

    rows = []
    for c, it in items.items():
        cur = it['stock_dept']
        if it['type'] == '계획품' and c in q2eq:
            cand = []
            for eq in q2eq[c]:
                for (dt, kind) in future.get((c[1], eq), []):
                    cand.append((dt, kind, eq))
            if cand:
                cand.sort()
                stop, kind, eq = cand[0]
                lt = it['lt_mean'] or 30
                buf = LEAD_BUFFER.get(kind, 14) + int(0.5 * (it['lt_std'] or 0))
                order_by = stop - timedelta(days=int(lt) + buf)
                D = (order_by - E.ASOF).days
                need = exp_need(c, kind)
                if cur >= need:
                    sig, txt = 'gray', '재고충분'
                elif D <= 0:
                    sig, txt = 'red', '즉시발주'
                elif D <= 30:
                    sig, txt = 'yellow', '발주임박'
                else:
                    sig, txt = 'green', '여유'
                rows.append([sig, txt, it['item'], it['dept_code'], it['type'],
                             eq, kind, str(stop),
                             str(order_by), D, need, f'{cur:.0f}',
                             f'{max(0, need - cur):.0f}',
                             f'{max(0, need - cur) * it["unit_cost"]:.0f}'])
                continue
        # 보험품 또는 수리일정 없는 계획품 → 재고포지션 신호
        sig, txt = signal_reserve(cur, tg[c])
        need = max(0, tg[c] - cur)
        rows.append([sig, txt, it['item'], it['dept_code'], it['type'],
                 ';'.join(q2eq.get(c, [])[:1]),
                     '상시', '', '', '', tg[c], f'{cur:.0f}', f'{need:.0f}',
                     f'{need * it["unit_cost"]:.0f}'])
    order = {'red': 0, 'yellow': 1, 'green': 2, 'gray': 3}
    rows.sort(key=lambda r: order[r[0]])
    with open(os.path.join(OUT, 'order_signals.csv'), 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(['Signal', 'Status', 'Item', 'DeptCode', 'Type',
                'Equipment', 'Kind',
                    'StopDate', 'OrderByDate', 'D_days', 'ExpectedNeed',
                    'CurrentStock', 'OrderNeed', 'OrderAmount'])
        w.writerows(rows)

    # ---------- 3) pooling.csv ----------
    with open(os.path.join(OUT, 'pooling.csv'), 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(['Item', 'DeptCode', 'Type', 'Grade', 'AgeDays', 'StockDept',
                    'StaleValue', 'PoolGrade', 'Action'])
        for s in sorted(stale, key=lambda x: -x['value']):
            w.writerow([s['item'], s['dept_code'], s['type'], s['grade'], s['age'],
                        f'{s["stock"]:.0f}', f'{s["value"]:.0f}',
                        s['pool_grade'], s['action']])

    # ---------- 4) SUMMARY.txt ----------
    cur_val = sum(i['stock_dept'] * i['unit_cost'] for i in items.values())
    tv = sum(tg[c] * items[c]['unit_cost'] for c in items)
    reduce_amt = sum(max(0, items[c]['stock_dept'] - tg[c]) * items[c]['unit_cost']
                     for c in items)
    pool_amt = sum(s['value'] for s in stale if s['pool_grade'] in ('strong', 'medium'))
    fin = (reduce_amt + pool_amt) * CONTRIB * INTEREST
    L = []
    L.append('=' * 60)
    L.append('적정재고 산출 요약 (SHARE_appropriate_quantity2 재현)')
    L.append('=' * 60)
    L.append(f'\n대상 자재 {len(items)}종  기준일 {E.ASOF}')
    for typ in ('보험품', '계획품'):
        sub = [c for c in items if items[c]['type'] == typ]
        cv = sum(items[c]['stock_dept'] * items[c]['unit_cost'] for c in sub)
        nv = sum(tg[c] * items[c]['unit_cost'] for c in sub)
        L.append(f'  [{typ}] {len(sub)}종  현행 {won(cv)} → 목표 {won(nv)}원 '
                 f'({(nv - cv) / cv * 100 if cv else 0:+.1f}%)')
    L.append(f'\n전체 현행재고  {won(cur_val)}원')
    L.append(f'v3 목표재고    {won(tv)}원 ({(tv - cur_val) / cur_val * 100:+.1f}%)')
    L.append(f'감축분         {won(reduce_amt)}원')
    L.append(f'공용화 회수    {won(pool_amt)}원 (정체 {len(stale)}종)')
    L.append(f'\n재무효과(부서) = (감축+공용화) × {CONTRIB} × {INTEREST}')
    L.append(f'             = {won(fin)}원/년')
    L.append(f'전사 확산: 재고감축목표 2,016억 × 20% × 4.6% = 18.5억원/년')
    sc = Counter(r[0] for r in rows)
    L.append(f'\n발주 신호등: 🔴{sc.get("red",0)} 🟡{sc.get("yellow",0)} '
             f'🟢{sc.get("green",0)} ⚪{sc.get("gray",0)}')
    L.append(f'중요도 등급: ' + str(dict(Counter(v["grade"] for v in crit.values()))))
    L.append(f'\n산출물: output/restock.csv, order_signals.csv, pooling.csv')
    with open(os.path.join(OUT, 'SUMMARY.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(L))
    print('\n'.join(L))


if __name__ == '__main__':
    main()
