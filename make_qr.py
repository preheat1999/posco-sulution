# -*- coding: utf-8 -*-
"""자재식별표에 붙일 QR 을 만든다.

QR 에 담는 값 · <배포 주소>/mobile-return.html?code=Q0000000
스캔하면 브라우저가 모바일 반납 화면을 열고, code 파라미터를 읽어 1단계(QR 스캔)를
건너뛰고 2단계(자재정보 초안 확인)부터 시작한다.

사용법 ·
    python -B make_qr.py                                  기본값으로 만든다
    python -B make_qr.py --code Q4046777                  자재 하나
    python -B make_qr.py --base http://192.168.0.10:8130  사내망 · 노트북 주소
    python -B make_qr.py --page material-view.html        자재 확인 화면으로 보내기
    python -B make_qr.py --all                             qr-items.js 에 등록된 전부

내는 것 (qr/ 폴더) ·
    <코드>_qr.png       QR 만 · 인쇄 · 화면 어디에 넣어도 되는 크기
    <코드>_label.png    자재식별표 모양 · QR + 자재 정보 + 주소
    <코드>_qr.svg       벡터 · 크게 인쇄할 때

만든 뒤 스스로 검사한다 ·
    1) 오류복정 수준 · 버전 · 담긴 값이 우리가 준 값과 같은가
    2) PNG 픽셀이 QR 행렬과 한 칸도 다르지 않은가 (배율 · 여백 계산 실수를 잡는다)
    3) 찾기 무늬 세 개와 여백(quiet zone 4칸)이 규격대로 있는가
"""
import argparse
import io
import json
import os
import re
import sys

import segno
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, 'qr')

# 배포된 사이트 주소. 코드 안에 도메인을 박지 않으려고 인자로 받고, 기본값만 여기 둔다
DEFAULT_BASE = 'https://main.dl62ond6b4cv9.amplifyapp.com'
# QR 이 여는 화면 · 모바일 반납으로 바로 보낸다 (code 가 있으면 2단계부터 시작한다).
# 자재 확인 화면을 거치게 하려면 --page material-view.html 로 만든다
DEFAULT_PAGE = 'mobile-return.html'

# 인쇄용 · 현장에서 장갑 끼고 폰으로 찍는다. 한 칸을 두껍게 두어야 잘 읽힌다
SCALE = 16          # QR 한 칸 = 16px
BORDER = 4          # 여백 4칸 (규격 최소값)
ERROR = 'm'         # 오류복정 M · 15% 까지 훼손돼도 읽힌다 (식별표는 기름 · 긁힘이 있다)

FONT_DIRS = ['C:/Windows/Fonts/malgun.ttf', 'C:/Windows/Fonts/malgunsl.ttf',
             '/System/Library/Fonts/AppleSDGothicNeo.ttc']


def load_items():
    """assets/qr-items.js 의 등록 자재를 읽는다. 자재코드가 PK 다."""
    path = os.path.join(ROOT, 'assets', 'qr-items.js')
    src = io.open(path, encoding='utf-8').read()
    i = src.find('window.QR_ITEMS = ')
    j = src.find('\n};', i)
    body = src[i + len('window.QR_ITEMS = '):j + 2]
    # JS 객체 → JSON · 키에 따옴표를 붙이고 마지막 쉼표를 없앤다
    body = re.sub(r'/\*.*?\*/', '', body, flags=re.S)
    body = re.sub(r'(^|[{,\s])([A-Za-z_][A-Za-z0-9_]*)\s*:', r'\1"\2":', body)
    body = body.replace("'", '"')
    body = re.sub(r',(\s*[}\]])', r'\1', body)
    return json.loads(body)


def font(size, bold=False):
    for p in FONT_DIRS:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size, index=1 if (bold and p.endswith('.ttc')) else 0)
            except Exception:
                pass
    return ImageFont.load_default()


def payload(base, code, page):
    return base.rstrip('/') + '/' + page + '?code=' + code


def make_one(code, item, base, page):
    url = payload(base, code, page)
    qr = segno.make(url, error=ERROR)

    # 기본(모바일 반납)은 그냥 <코드>_qr.png, 다른 화면으로 보내면 이름에 그 화면을 적는다.
    # 같은 이름으로 덮어쓰면 어느 QR 이 어디로 가는지 알 수 없게 된다
    tag = '' if page == DEFAULT_PAGE else '_' + page.replace('.html', '')
    png = os.path.join(OUT, code + tag + '_qr.png')
    svg = os.path.join(OUT, code + tag + '_qr.svg')
    qr.save(png, scale=SCALE, border=BORDER, dark='#000000', light='#FFFFFF')
    qr.save(svg, scale=SCALE, border=BORDER, dark='#000000', light='#FFFFFF')

    label = os.path.join(OUT, code + tag + '_label.png')
    draw_label(label, png, code, item, url)
    return {'url': url, 'qr': qr, 'png': png, 'svg': svg, 'label': label}


def wrap(draw, text, fnt, width, maxlines):
    """칸 폭 안에서 줄을 나눈다. 넘치면 마지막 줄을 … 로 자른다."""
    words = str(text).split(' ')
    lines, cur = [], ''
    for w in words:
        cand = (cur + ' ' + w).strip()
        if draw.textlength(cand, font=fnt) <= width or not cur:
            cur = cand
        else:
            lines.append(cur)
            cur = w
            if len(lines) == maxlines:
                break
    if cur and len(lines) < maxlines:
        lines.append(cur)
    if not lines:
        return ['']
    while draw.textlength(lines[-1], font=fnt) > width and len(lines[-1]) > 1:
        lines[-1] = lines[-1][:-2] + '…'
    return lines


def draw_label(path, qr_png, code, item, url):
    """자재식별표 모양. 종이에 붙이는 것이라 흰 바탕 · 검은 글씨다."""
    q = Image.open(qr_png).convert('RGB')
    side = 520
    q = q.resize((side, side), Image.NEAREST)     # NEAREST · 칸 경계가 흐려지면 안 읽힌다

    # 두 줄로 늘어나는 칸(부서 경로)이 있어 아래를 넉넉히 둔다 
    W, H = 1000, 700
    im = Image.new('RGB', (W, H), '#FFFFFF')
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W - 1, H - 1], outline='#000000', width=3)
    d.line([(0, 92), (W, 92)], fill='#000000', width=3)

    d.text((28, 30), '자재식별표', font=font(34), fill='#000000')
    d.text((250, 42), 'MATERIAL IDENTIFICATION TAG', font=font(18), fill='#555555')
    d.text((W - 320, 34), item.get('deptCode', ''), font=font(30), fill='#000000')

    im.paste(q, (W - side - 34, 110))

    x, y = 34, 118
    # 글자가 QR 을 침범하면 QR 이 안 읽힌다. 왼쪽 칸 폭을 정해 두고 그 안에서만 쓴다
    colw = W - side - 34 - 30 - x
    d.text((x, y), code, font=font(56), fill='#000000')
    y += 74
    rows = [
        ('품명 · 규격', ((item.get('name') or '') + ', ' + (item.get('spec') or '')).strip(', ')),
        ('단위 · 수량', str(item.get('unit', '')) + ' · ' + str(item.get('qty', ''))),
        ('단가', '{:,}원'.format(int(item.get('price') or 0))),
        ('창고', item.get('wh', '')),
        ('입고일자', item.get('recvDate', '')),
        ('재고부서', (item.get('deptCode') or '') + ' ' + (item.get('deptPath') or '')),
        ('재고담당', (item.get('owner') or '') + '  TEL ' + (item.get('tel') or '')),
    ]
    fk, fv = font(17), font(21)
    for k, v in rows:
        d.text((x, y), k, font=fk, fill='#666666')
        lines = wrap(d, str(v), fv, colw, 2)
        for i, line in enumerate(lines):
            d.text((x, y + 22 + i * 25), line, font=fv, fill='#000000')
        y += 58 + (25 if len(lines) > 1 else 0)

    fu = font(15)
    d.text((x, H - 44), wrap(d, 'QR 스캔 → ' + url, fu, W - 68, 1)[0], font=fu, fill='#555555')
    im.save(path)


def check(code, made):
    """만든 파일을 스스로 검사한다. 통과하지 못하면 파일을 내지 않는다."""
    qr = made['qr']
    bad = []

    # 1 · 담긴 값 · 수준 · 버전
    if qr.error.lower() != ERROR:
        bad.append('오류복정 수준이 %s 다' % qr.error)
    # segno 는 담은 값을 그대로 돌려주지 않으므로 같은 값을 다시 인코딩해 행렬을 견준다
    again = segno.make(made['url'], error=ERROR)
    if list(again.matrix) != list(qr.matrix):
        bad.append('같은 값으로 다시 만든 행렬이 다르다')

    m = [list(row) for row in qr.matrix]
    n = len(m)
    if n != len(m[0]):
        bad.append('행렬이 정사각형이 아니다')

    # 2 · 찾기 무늬 세 개 · 7x7 겹 사각형
    def finder_ok(r0, c0):
        for r in range(7):
            for c in range(7):
                ring = (r in (0, 6) or c in (0, 6))
                inner = (2 <= r <= 4 and 2 <= c <= 4)
                want = 1 if (ring or inner) else 0
                if m[r0 + r][c0 + c] != want:
                    return False
        return True

    for (r0, c0, name) in [(0, 0, '왼쪽 위'), (0, n - 7, '오른쪽 위'), (n - 7, 0, '왼쪽 아래')]:
        if not finder_ok(r0, c0):
            bad.append('찾기 무늬가 어긋났다 · ' + name)

    # 3 · PNG 픽셀이 행렬과 한 칸도 다르지 않은가
    im = Image.open(made['png']).convert('L')
    w, h = im.size
    want = (n + BORDER * 2) * SCALE
    if (w, h) != (want, want):
        bad.append('PNG 크기가 %dx%d 다 (기대 %d)' % (w, h, want))
    else:
        px = im.load()
        diff = 0
        for r in range(n):
            for c in range(n):
                y = (BORDER + r) * SCALE + SCALE // 2
                x = (BORDER + c) * SCALE + SCALE // 2
                dark = px[x, y] < 128
                if dark != bool(m[r][c]):
                    diff += 1
        if diff:
            bad.append('PNG 픽셀이 행렬과 %d칸 다르다' % diff)
        # 여백 · 네 변이 모두 흰색이어야 스캐너가 경계를 찾는다
        edge = [px[1, 1], px[w - 2, 1], px[1, h - 2], px[w - 2, h - 2]]
        if any(v < 200 for v in edge):
            bad.append('여백(quiet zone)이 비어 있지 않다')

    return bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--code', default='Q4046777')
    ap.add_argument('--base', default=DEFAULT_BASE)
    ap.add_argument('--page', default=DEFAULT_PAGE)
    ap.add_argument('--all', action='store_true')
    a = ap.parse_args()

    if not os.path.isdir(OUT):
        os.makedirs(OUT)

    items = load_items()
    codes = sorted(items.keys()) if a.all else [a.code]

    fail = 0
    for code in codes:
        item = items.get(code)
        if not item:
            print('!! %s 는 assets/qr-items.js 에 없다 · 등록하고 다시 돌려라' % code)
            fail += 1
            continue
        made = make_one(code, item, a.base, a.page)
        bad = check(code, made)
        print('%s · %s' % (code, made['url']))
        print('   버전 %s · 오류복정 %s · 한 변 %d칸 · PNG %dpx'
              % (made['qr'].version, made['qr'].error.upper(),
                 len(list(made['qr'].matrix)),
                 (len(list(made['qr'].matrix)) + BORDER * 2) * SCALE))
        for b in bad:
            print('   FAIL ' + b)
        if not bad:
            print('   PASS 행렬 · PNG 픽셀 · 찾기 무늬 · 여백 검사 통과')
        else:
            fail += 1
        for k in ('png', 'svg', 'label'):
            print('   ' + os.path.relpath(made[k], ROOT).replace('\\', '/'))

    if fail:
        print('\n검사에 걸린 것이 %d건 있다' % fail)
        sys.exit(1)
    print('\nqr/ 에 냈다. 스캔해서 화면이 열리는지 확인하면 된다')


main()
