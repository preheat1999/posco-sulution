/* 차트 프리미티브 — 인라인 SVG 직접 렌더. 외부 라이브러리 0 (오프라인 안전).
 *
 * 설계 규칙 (dataviz)
 *  - 크기 비교는 단일 색조(sequential). 계열이 '주제'일 때만 categorical.
 *  - 이중 축 금지. 파레토는 누적 곡선(단일 축)으로 그린다.
 *  - 얇은 마크, 데이터 끝 4px 라운드, 선 2px, 마커 8px+, 채움 사이 2px 간격.
 *  - 계열 2개 이상이면 범례 필수. 4개 이하면 직접 라벨도 붙인다.
 *  - 대비 경고가 있는 색은 직접 라벨/표 보기로 보완한다(둘 다 제공).
 */
(function () {
const NS = 'http://www.w3.org/2000/svg';
const CAT = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)',
             'var(--series-5)', 'var(--series-6)'];
const SEQ = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7',
             '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];

const el = (n, a = {}, kids = []) => {
  const e = document.createElementNS(NS, n);
  for (const k in a) if (a[k] != null) e.setAttribute(k, a[k]);
  (Array.isArray(kids) ? kids : [kids]).forEach(k => k && e.appendChild(k));
  return e;
};
const txt = (s, a = {}) => { const t = el('text', a); t.textContent = s; return t; };
const fmt = n => {
  if (n == null) return '-';
  const a = Math.abs(n);
  if (a >= 1e8) return (n / 1e8).toFixed(a >= 1e9 ? 0 : 1) + '억';
  if (a >= 1e4) return (n / 1e4).toFixed(a >= 1e6 ? 0 : 1) + '만';
  return n.toLocaleString('ko-KR', { maximumFractionDigits: 1 });
};
const pct = n => (n * 100).toFixed(n < 0.1 ? 1 : 0) + '%';
const seq = (t) => SEQ[Math.max(0, Math.min(SEQ.length - 1, Math.round(3 + t * 9)))];

/* ---- 툴팁 (차트 = 상호작용. 기본으로 붙인다) ---- */
let TIP;
function tip(html, ev) {
  if (!TIP) { TIP = document.createElement('div'); TIP.className = 'viz-tip'; document.body.appendChild(TIP); }
  TIP.innerHTML = html;
  TIP.style.display = 'block';
  const pad = 12, w = TIP.offsetWidth, h = TIP.offsetHeight;
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if (x + w > innerWidth - 8) x = ev.clientX - w - pad;
  if (y + h > innerHeight - 8) y = ev.clientY - h - pad;
  TIP.style.left = x + 'px'; TIP.style.top = y + 'px';
}
const untip = () => { if (TIP) TIP.style.display = 'none'; };
function hoverable(node, html) {
  node.addEventListener('mousemove', e => tip(html, e));
  node.addEventListener('mouseleave', untip);
  node.setAttribute('tabindex', '0');
  node.addEventListener('focus', e => tip(html, node.getBoundingClientRect()
    && { clientX: node.getBoundingClientRect().left, clientY: node.getBoundingClientRect().top }));
  node.addEventListener('blur', untip);
}

/* ---- 가로 막대 (크기 비교의 기본형) ---- */
function hbar(data, o = {}) {
  const labelW = o.labelW || 150, barH = o.barH || 22, gap = 8, pad = 8;
  const w = o.width || 640, h = data.length * (barH + gap) + pad * 2;
  const max = Math.max(...data.map(d => d.value)) || 1;
  const plotW = w - labelW - 76;
  const s = el('svg', { viewBox: `0 0 ${w} ${h}`, class: 'chart', role: 'img' });
  data.forEach((d, i) => {
    const y = pad + i * (barH + gap);
    const bw = Math.max(2, d.value / max * plotW);
    s.appendChild(txt(d.label.length > 22 ? d.label.slice(0, 21) + '…' : d.label,
      { x: labelW - 8, y: y + barH * 0.72, 'text-anchor': 'end', class: 'lbl' }));
    const r = el('rect', {
      x: labelW, y, width: bw, height: barH, rx: 4,
      fill: o.color || seq(d.value / max), class: 'mark'
    });
    hoverable(r, `<b>${d.label}</b><br>${o.unit === 'pct' ? pct(d.value) : fmt(d.value)}${o.suffix || ''}`);
    s.appendChild(r);
    s.appendChild(txt(o.unit === 'pct' ? pct(d.value) : fmt(d.value),
      { x: labelW + bw + 7, y: y + barH * 0.72, class: 'val' }));
  });
  return s;
}

/* ---- 세로 막대 / 히스토그램 ---- */
function vbar(data, o = {}) {
  const w = o.width || 640, h = o.height || 210, L = 44, B = 34, T = 12, R = 10;
  const max = Math.max(...data.map(d => d.value)) || 1;
  const plotW = w - L - R, plotH = h - T - B;
  const bw = plotW / data.length;
  const s = el('svg', { viewBox: `0 0 ${w} ${h}`, class: 'chart', role: 'img' });
  [0, .5, 1].forEach(t => {
    const y = T + plotH * (1 - t);
    s.appendChild(el('line', { x1: L, x2: w - R, y1: y, y2: y, class: 'grid' }));
    s.appendChild(txt(fmt(max * t), { x: L - 7, y: y + 4, 'text-anchor': 'end', class: 'ax' }));
  });
  data.forEach((d, i) => {
    const bh = Math.max(1, d.value / max * plotH);
    const r = el('rect', {
      x: L + i * bw + 2, y: T + plotH - bh, width: Math.max(2, bw - 4), height: bh,
      rx: 4, fill: o.color || seq(d.value / max), class: 'mark'
    });
    hoverable(r, `<b>${d.label}</b><br>${o.unit === 'pct' ? pct(d.value) : fmt(d.value)}${o.suffix || ''}`);
    s.appendChild(r);
    if (data.length <= 8 && d.value)
      s.appendChild(txt(o.unit === 'pct' ? pct(d.value) : fmt(d.value), {
        x: L + i * bw + bw / 2, y: T + plotH - bh - 5, 'text-anchor': 'middle', class: 'val'
      }));
    if (data.length <= 14 || i % Math.ceil(data.length / 12) === 0)
      s.appendChild(txt(d.label, {
        x: L + i * bw + bw / 2, y: h - 12, 'text-anchor': 'middle', class: 'ax'
      }));
  });
  return s;
}

/* ---- 그룹 막대 (2계열) ---- */
function gbar(labels, series, o = {}) {
  const w = o.width || 640, h = o.height || 220, L = 46, B = 40, T = 12, R = 10;
  const max = Math.max(...series.flatMap(s => s.values)) || 1;
  const plotW = w - L - R, plotH = h - T - B, gw = plotW / labels.length;
  const bw = (gw - 8) / series.length;
  const s = el('svg', { viewBox: `0 0 ${w} ${h}`, class: 'chart', role: 'img' });
  [0, .5, 1].forEach(t => {
    const y = T + plotH * (1 - t);
    s.appendChild(el('line', { x1: L, x2: w - R, y1: y, y2: y, class: 'grid' }));
    s.appendChild(txt(fmt(max * t), { x: L - 7, y: y + 4, 'text-anchor': 'end', class: 'ax' }));
  });
  labels.forEach((lb, i) => {
    series.forEach((se, j) => {
      const v = se.values[i], bh = Math.max(1, v / max * plotH);
      const r = el('rect', {
        x: L + i * gw + 4 + j * bw, y: T + plotH - bh, width: bw - 2, height: bh, rx: 4,
        fill: CAT[j], class: 'mark'
      });
      hoverable(r, `<b>${lb}</b><br>${se.label}: ${fmt(v)}`);
      s.appendChild(r);
    });
    s.appendChild(txt(lb, { x: L + i * gw + gw / 2, y: h - 14, 'text-anchor': 'middle', class: 'ax' }));
  });
  return s;
}

/* ---- 가로 누적 막대 (부분-전체. 원그래프보다 정확하다) ---- */
function stackbar(data, o = {}) {
  const w = o.width || 640, h = 40, tot = data.reduce((a, d) => a + d.value, 0) || 1;
  const s = el('svg', { viewBox: `0 0 ${w} ${h}`, class: 'chart', role: 'img' });
  let x = 0;
  data.forEach((d, i) => {
    const bw = d.value / tot * w;
    const r = el('rect', {
      x, y: 6, width: Math.max(1, bw - 2), height: 22, rx: 4, fill: CAT[i % CAT.length], class: 'mark'
    });
    hoverable(r, `<b>${d.label}</b><br>${fmt(d.value)} · ${pct(d.value / tot)}`);
    s.appendChild(r);
    if (bw > 62) {
      s.appendChild(txt(pct(d.value / tot), { x: x + bw / 2 - 1, y: 21, 'text-anchor': 'middle', class: 'inbar' }));
    }
    x += bw;
  });
  return s;
}

/* ---- 선 (추이) + 크로스헤어 ---- */
function line(data, o = {}) {
  const w = o.width || 640, h = o.height || 210, L = 48, B = 32, T = 14, R = 12;
  const max = Math.max(...data.map(d => d.value)) || 1;
  const plotW = w - L - R, plotH = h - T - B;
  const X = i => L + (data.length === 1 ? plotW / 2 : i / (data.length - 1) * plotW);
  const Y = v => T + plotH * (1 - v / max);
  const s = el('svg', { viewBox: `0 0 ${w} ${h}`, class: 'chart', role: 'img' });
  [0, .5, 1].forEach(t => {
    const y = T + plotH * (1 - t);
    s.appendChild(el('line', { x1: L, x2: w - R, y1: y, y2: y, class: 'grid' }));
    s.appendChild(txt(fmt(max * t), { x: L - 7, y: y + 4, 'text-anchor': 'end', class: 'ax' }));
  });
  const d = data.map((p, i) => `${i ? 'L' : 'M'}${X(i)},${Y(p.value)}`).join(' ');
  if (o.area) s.appendChild(el('path', {
    d: d + ` L${X(data.length - 1)},${T + plotH} L${X(0)},${T + plotH} Z`, class: 'areafill'
  }));
  s.appendChild(el('path', { d, class: 'lineMark' }));
  data.forEach((p, i) => {
    if (data.length <= 20 || i % Math.ceil(data.length / 14) === 0)
      s.appendChild(txt(p.label, { x: X(i), y: h - 10, 'text-anchor': 'middle', class: 'ax' }));
    const c = el('circle', { cx: X(i), cy: Y(p.value), r: 4.5, class: 'dot' });
    hoverable(c, `<b>${p.label}</b><br>${fmt(p.value)}${o.suffix || ''}`);
    s.appendChild(c);
  });
  return s;
}

/* ---- 누적 집중 곡선 (파레토·로렌츠. 이중 축을 쓰지 않는 방법) ---- */
function curve(points, o = {}) {
  const w = o.width || 640, h = o.height || 230, L = 46, B = 34, T = 14, R = 12;
  const plotW = w - L - R, plotH = h - T - B;
  const X = x => L + x * plotW, Y = y => T + plotH * (1 - y);
  const s = el('svg', { viewBox: `0 0 ${w} ${h}`, class: 'chart', role: 'img' });
  [0, .25, .5, .75, 1].forEach(t => {
    const y = Y(t);
    s.appendChild(el('line', { x1: L, x2: w - R, y1: y, y2: y, class: 'grid' }));
    s.appendChild(txt(pct(t), { x: L - 7, y: y + 4, 'text-anchor': 'end', class: 'ax' }));
  });
  s.appendChild(el('line', { x1: X(0), y1: Y(0), x2: X(1), y2: Y(1), class: 'refline' }));
  s.appendChild(el('path', {
    d: points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x)},${Y(p.y)}`).join(' '), class: 'lineMark'
  }));
  // 마커 라벨은 위/아래를 번갈아 놓는다 (가까운 마커끼리 겹치는 것을 막는다)
  (o.marks || []).forEach((m, mi) => {
    const p = points.reduce((a, b) => Math.abs(b.x - m) < Math.abs(a.x - m) ? b : a);
    const c = el('circle', { cx: X(p.x), cy: Y(p.y), r: 5, class: 'dot' });
    hoverable(c, `상위 ${pct(m)} → ${pct(p.y)}`);
    s.appendChild(c);
    const up = mi % 2 === 0;
    s.appendChild(txt(`상위 ${pct(m)} = ${pct(p.y)}`, {
      x: X(p.x) + 9, y: Y(p.y) + (up ? -10 : 17), class: 'note'
    }));
  });
  s.appendChild(txt(o.xlabel || '', { x: L + plotW / 2, y: h - 8, 'text-anchor': 'middle', class: 'ax' }));
  const hit = el('rect', { x: L, y: T, width: plotW, height: plotH, fill: 'transparent' });
  hit.addEventListener('mousemove', e => {
    const bb = s.getBoundingClientRect();
    const rx = (e.clientX - bb.left) / bb.width * w;
    const x = Math.max(0, Math.min(1, (rx - L) / plotW));
    const p = points.reduce((a, b) => Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a);
    tip(`상위 ${pct(p.x)} → 누적 <b>${pct(p.y)}</b>`, e);
  });
  hit.addEventListener('mouseleave', untip);
  s.appendChild(hit);
  return s;
}

/* ---- 누적 영역 (구성 변화) ---- */
function stackarea(labels, series, o = {}) {
  const w = o.width || 640, h = o.height || 240, L = 46, B = 32, T = 14, R = 12;
  const plotW = w - L - R, plotH = h - T - B;
  const totals = labels.map((_, i) => series.reduce((a, s) => a + (s.values[i] || 0), 0));
  const max = Math.max(...totals) || 1;
  const X = i => L + (labels.length === 1 ? plotW / 2 : i / (labels.length - 1) * plotW);
  const Y = v => T + plotH * (1 - v / max);
  const s = el('svg', { viewBox: `0 0 ${w} ${h}`, class: 'chart', role: 'img' });
  [0, .5, 1].forEach(t => {
    const y = T + plotH * (1 - t);
    s.appendChild(el('line', { x1: L, x2: w - R, y1: y, y2: y, class: 'grid' }));
    s.appendChild(txt(fmt(max * t), { x: L - 7, y: y + 4, 'text-anchor': 'end', class: 'ax' }));
  });
  const base = labels.map(() => 0);
  series.forEach((se, j) => {
    const top = labels.map((_, i) => base[i] + (se.values[i] || 0));
    const d = top.map((v, i) => `${i ? 'L' : 'M'}${X(i)},${Y(v)}`).join(' ') + ' ' +
      base.map((v, i) => `L${X(labels.length - 1 - i)},${Y(base[labels.length - 1 - i])}`).join(' ') + ' Z';
    const p = el('path', { d, fill: CAT[j % CAT.length], class: 'areaseg' });
    hoverable(p, `<b>${se.label}</b><br>` + labels.map((lb, i) => `${lb}: ${fmt(se.values[i])}`).join('<br>'));
    s.appendChild(p);
    labels.forEach((_, i) => base[i] = top[i]);
  });
  labels.forEach((lb, i) => s.appendChild(txt(lb, {
    x: X(i), y: h - 10, 'text-anchor': 'middle', class: 'ax'
  })));
  return s;
}

/* ---- 히트맵 (격자 크기 비교 = sequential) ---- */
function heatmap(rowsL, colsL, values, o = {}) {
  const cw = o.cw || 54, ch = o.ch || 26, L = o.labelW || 76, T = 26;
  const w = L + colsL.length * cw + 10, h = T + rowsL.length * ch + 8;
  const max = Math.max(...values.flat()) || 1;
  const s = el('svg', { viewBox: `0 0 ${w} ${h}`, class: 'chart', role: 'img' });
  colsL.forEach((c, j) => s.appendChild(txt(c, {
    x: L + j * cw + cw / 2, y: 16, 'text-anchor': 'middle', class: 'ax'
  })));
  rowsL.forEach((r, i) => {
    s.appendChild(txt(r, { x: L - 8, y: T + i * ch + ch * 0.68, 'text-anchor': 'end', class: 'lbl' }));
    colsL.forEach((c, j) => {
      const v = values[i][j], t = v / max;
      const cell = el('rect', {
        x: L + j * cw + 1, y: T + i * ch + 1, width: cw - 3, height: ch - 3, rx: 3,
        fill: v ? seq(t) : 'var(--surface-2)', class: 'mark'
      });
      hoverable(cell, `<b>${r} · ${c}</b><br>${fmt(v)}건`);
      s.appendChild(cell);
      if (t > 0.12) s.appendChild(txt(fmt(v), {
        x: L + j * cw + cw / 2 - 1, y: T + i * ch + ch * 0.68, 'text-anchor': 'middle',
        class: t > 0.55 ? 'inbar' : 'incell'
      }));
    });
  });
  return s;
}

/* ---- 산점 (사분면). 색은 단일 색조 — 위치가 이미 분류를 인코딩한다 ---- */
function scatter(points, o = {}) {
  const w = o.width || 640, h = o.height || 300, L = 52, B = 40, T = 16, R = 16;
  const plotW = w - L - R, plotH = h - T - B;
  const lg = v => Math.log10(Math.max(v, o.floor || 0.1) + 1);
  const xs = points.map(p => o.log ? lg(p.x) : p.x), ys = points.map(p => o.log ? lg(p.y) : p.y);
  const xmax = Math.max(...xs) || 1, ymax = Math.max(...ys) || 1;
  const X = v => L + (o.log ? lg(v) : v) / xmax * plotW;
  const Y = v => T + plotH * (1 - (o.log ? lg(v) : v) / ymax);
  const s = el('svg', { viewBox: `0 0 ${w} ${h}`, class: 'chart', role: 'img' });
  s.appendChild(el('rect', { x: L, y: T, width: plotW, height: plotH, class: 'plotbg' }));
  (o.vline != null) && s.appendChild(el('line', {
    x1: X(o.vline), x2: X(o.vline), y1: T, y2: T + plotH, class: 'refline'
  }));
  (o.hline != null) && s.appendChild(el('line', {
    x1: L, x2: L + plotW, y1: Y(o.hline), y2: Y(o.hline), class: 'refline'
  }));
  (o.quads || []).forEach(q => s.appendChild(txt(q.label, {
    x: L + q.fx * plotW, y: T + q.fy * plotH, 'text-anchor': 'middle', class: 'quad'
  })));
  points.forEach(p => {
    const r = o.size ? Math.max(3, Math.min(13, Math.sqrt(p.v || 1) / (o.size || 1))) : 4.5;
    const c = el('circle', {
      cx: X(p.x), cy: Y(p.y), r,
      fill: p.hl ? 'var(--series-2)' : 'var(--series-1)',
      'fill-opacity': p.hl ? 0.85 : 0.5, class: 'pt'
    });
    hoverable(c, o.tipFn ? o.tipFn(p) : `<b>${p.item || ''}</b><br>${fmt(p.x)} / ${fmt(p.y)}`);
    s.appendChild(c);
  });
  s.appendChild(txt(o.xlabel || '', { x: L + plotW / 2, y: h - 8, 'text-anchor': 'middle', class: 'ax' }));
  s.appendChild(txt(o.ylabel || '', {
    x: 12, y: T + plotH / 2, class: 'ax',
    transform: `rotate(-90 12 ${T + plotH / 2})`, 'text-anchor': 'middle'
  }));
  return s;
}

/* ---- 롤리팝 (순위) ---- */
function lollipop(data, o = {}) {
  const labelW = o.labelW || 96, rowH = 24, pad = 8;
  const w = o.width || 640, h = data.length * rowH + pad * 2;
  const max = Math.max(...data.map(d => d.value)) || 1;
  const plotW = w - labelW - 70;
  const s = el('svg', { viewBox: `0 0 ${w} ${h}`, class: 'chart', role: 'img' });
  data.forEach((d, i) => {
    const y = pad + i * rowH + rowH / 2;
    const x = labelW + d.value / max * plotW;
    s.appendChild(txt(d.label, { x: labelW - 8, y: y + 4, 'text-anchor': 'end', class: 'lbl' }));
    s.appendChild(el('line', { x1: labelW, x2: x, y1: y, y2: y, class: 'stem' }));
    const c = el('circle', { cx: x, cy: y, r: 6, fill: seq(d.value / max), class: 'mark' });
    hoverable(c, d.tip || `<b>${d.label}</b><br>${fmt(d.value)}`);
    s.appendChild(c);
    s.appendChild(txt(fmt(d.value) + (o.suffix || ''), { x: x + 11, y: y + 4, class: 'val' }));
  });
  return s;
}

/* ---- 덤벨 (입고 ↔ 불출) ---- */
function dumbbell(data, o = {}) {
  const labelW = o.labelW || 96, rowH = 26, pad = 10;
  const w = o.width || 640, h = data.length * rowH + pad * 2 + 6;
  const max = Math.max(...data.flatMap(d => [d.a, d.b])) || 1;
  const plotW = w - labelW - 84;
  const s = el('svg', { viewBox: `0 0 ${w} ${h}`, class: 'chart', role: 'img' });
  data.forEach((d, i) => {
    const y = pad + i * rowH + rowH / 2;
    const xa = labelW + d.a / max * plotW, xb = labelW + d.b / max * plotW;
    s.appendChild(txt(d.label, { x: labelW - 8, y: y + 4, 'text-anchor': 'end', class: 'lbl' }));
    s.appendChild(el('line', { x1: xa, x2: xb, y1: y, y2: y, class: 'stem' }));
    [[xa, 'var(--series-1)', o.aLabel || 'A', d.a], [xb, 'var(--series-2)', o.bLabel || 'B', d.b]]
      .forEach(([x, col, nm, v]) => {
        const c = el('circle', { cx: x, cy: y, r: 6, fill: col, class: 'mark' });
        hoverable(c, `<b>${d.label}</b><br>${nm}: ${fmt(v)}`);
        s.appendChild(c);
      });
    s.appendChild(txt(fmt(Math.max(d.a, d.b)), {
      x: labelW + plotW + 10, y: y + 4, class: 'val'
    }));
  });
  return s;
}

/* ---- 미터 (단일 비율. 2조각 원그래프보다 정확하다) ---- */
function meter(ratio, o = {}) {
  const w = o.width || 320, h = 46;
  const s = el('svg', { viewBox: `0 0 ${w} ${h}`, class: 'chart', role: 'img' });
  s.appendChild(el('rect', { x: 0, y: 12, width: w, height: 18, rx: 5, fill: 'var(--surface-2)' }));
  const bw = Math.max(3, ratio * w);
  const r = el('rect', { x: 0, y: 12, width: bw, height: 18, rx: 5, fill: 'var(--series-1)', class: 'mark' });
  hoverable(r, `<b>${o.label || ''}</b><br>${pct(ratio)}`);
  s.appendChild(r);
  s.appendChild(txt(pct(ratio), {
    x: Math.min(bw + 8, w - 40), y: 26, class: bw > 46 ? 'val' : 'val'
  }));
  return s;
}

/* ---- 표 (대비 경고 보완 + 데이터 보기) ---- */
function table(cols, rows) {
  const t = document.createElement('table');
  t.className = 'dtable';
  t.innerHTML = '<thead><tr>' + cols.map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>'
    + rows.map(r => '<tr>' + r.map(v => `<td>${v}</td>`).join('') + '</tr>').join('') + '</tbody>';
  return t;
}

/* ---- 흐름도 (업무 프로세스). 마커 id 는 여러 흐름도가 한 페이지에 함께 떠도
 * 충돌하지 않도록 매번 새로 만든다 (챗봇 대화창에 여러 건이 쌓일 수 있어서). ---- */
let _flowSeq = 0;
function flowSvg(nodes, edges, w, h, notes) {
  const mid = 'ah' + (_flowSeq++);
  const s = el('svg', { viewBox: `0 0 ${w} ${h}`, class: 'chart flowchart', role: 'img' });
  const marker = el('marker', {
    id: mid, viewBox: '0 0 10 10', refX: 9, refY: 5,
    markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse'
  }, el('path', { d: 'M0,0 L10,5 L0,10 z', fill: 'var(--axis)' }));
  s.appendChild(el('defs', {}, marker));
  edges.forEach(e => {
    const p = el('path', { d: e.d, class: 'farrow', 'marker-end': `url(#${mid})` });
    if (e.dash) p.setAttribute('stroke-dasharray', '4 3');
    s.appendChild(p);
    if (e.label) s.appendChild(txt(e.label, { x: e.lx, y: e.ly, class: 'fnote', 'text-anchor': 'middle' }));
  });
  nodes.forEach(n => {
    const nw = n.w || 132, nh = n.h || 40;
    s.appendChild(el('rect', {
      x: n.x, y: n.y, width: nw, height: nh, rx: 8,
      class: 'fbox' + (n.k ? ' ' + n.k : '')
    }));
    n.t.split('\n').forEach((ln, i, arr) => {
      s.appendChild(txt(ln, {
        x: n.x + nw / 2, y: n.y + nh / 2 + 4 + (i - (arr.length - 1) / 2) * 13,
        'text-anchor': 'middle', class: 'ftext' + (n.k === 'accent' ? ' on' : '')
      }));
    });
  });
  (notes || []).forEach(n => s.appendChild(txt(n.t, { x: n.x, y: n.y, class: 'fnote' })));
  return s;
}

/* ---- 범례 (HTML, SVG 밖에 그린다) ---- */
function legend(items) {
  const d = document.createElement('div');
  d.className = 'viz-legend';
  d.innerHTML = items.map((t, i) =>
    `<span><i style="background:${CAT[i % CAT.length]}"></i>${t}</span>`).join('');
  return d;
}

window.VIZ = { hbar, vbar, gbar, stackbar, line, curve, stackarea, heatmap, scatter, lollipop, dumbbell, meter, table, flowSvg, legend, fmt, pct, CAT, el, txt, seq };
})();
