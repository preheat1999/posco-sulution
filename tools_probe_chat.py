# -*- coding: utf-8 -*-
"""추천 질문이 실제로 사내 문서로 답되는지 확인한다.

왜 필요한가 ·
  추천 질문을 눌렀는데 「제공된 사내 문서에서 해당 내용을 찾을 수 없습니다」 가 나오면
  시연에서 그 자리가 빈다. 그래서 질문을 고칠 때마다 한 번 돌려 본다.
  실제로 30개 후보 중 8개가 근거 없음이었다 (핵심예비품 지정 기준 · 적정재고 산정 ·
  정비 자재 발주 시점 · 재고 실사 등).

질문 목록은 assets/chat.js 의 SUGGEST 에서 읽는다 · 두 곳에 같은 목록을 두면 어긋난다.

사용법 · serve.py 를 띄운 뒤
    python -B tools_probe_chat.py                       기본 http://127.0.0.1:8130/rag
    python -B tools_probe_chat.py --base http://localhost:3000/rag
    python -B tools_probe_chat.py --direct http://10.1.14.205:8000 --token <토큰>

결과는 db/CHAT_PROBE.txt 에 남는다. 서버가 한 번에 한 질문씩 처리하므로 순서대로 돈다
(한 질문에 6~12초 · 스무 개면 3분쯤 걸린다).
"""
import argparse
import io
import json
import os
import re
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, 'db', 'CHAT_PROBE.txt')


def load_suggest():
    """assets/chat.js 의 SUGGEST 를 읽어 [(탭, 질문)] 로 준다."""
    src = io.open(os.path.join(ROOT, 'assets', 'chat.js'), encoding='utf-8').read()
    i = src.find('var SUGGEST = {')
    body = src[i:]
    body = body[:body.find('\n  };')]
    out = []
    for m in re.finditer(r"(?:'([a-z]+)'|([a-z]+))\s*:\s*\[(.*?)\]", body, re.S):
        tab = m.group(1) or m.group(2)
        for q in re.findall(r"'([^']+)'", m.group(3)):
            out.append((tab, q))
    return out


def ask(base, token, q):
    req = urllib.request.Request(
        base.rstrip('/') + '/api/chat',
        data=json.dumps({'question': q, 'category': None, 'history': []}).encode('utf-8'),
        headers={'Content-Type': 'application/json'})
    if token:
        req.add_header('X-API-Token', token)
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=180) as r:
        j = json.loads(r.read().decode('utf-8'))
    return {
        'no_answer': bool(j.get('no_answer')),
        'cites': len(j.get('citations') or []),
        'route': j.get('route') or '',
        'sec': round(time.time() - t0, 1),
        'head': (j.get('answer') or '')[:60].replace('\n', ' '),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default='http://127.0.0.1:8130/rag',
                    help='serve.py 프록시 주소 (토큰 불필요)')
    ap.add_argument('--direct', default='', help='RAG 서버로 바로 · --token 이 필요하다')
    ap.add_argument('--token', default='')
    a = ap.parse_args()

    base = a.direct or a.base
    token = a.token
    if a.direct and not token:
        # .env 가 있으면 그걸 쓴다 · 명령줄에 토큰을 적어 남기지 않아도 된다
        env = os.path.join(ROOT, '.env')
        if os.path.exists(env):
            for line in io.open(env, encoding='utf-8'):
                if line.strip().startswith('CHAT_TOKEN='):
                    token = line.split('=', 1)[1].strip()

    cand = load_suggest()
    print('추천 질문 %d개 · %s' % (len(cand), base))
    print()

    lines, bad = [], 0
    for tab, q in cand:
        try:
            r = ask(base, token, q)
            mark = 'NO_ANSWER' if r['no_answer'] else 'ok'
            if r['no_answer']:
                bad += 1
            line = '%-9s %-9s cites=%-2d %-6s %5.1fs  %s | %s' % (
                tab, mark, r['cites'], r['route'], r['sec'], q, r['head'])
        except Exception as e:
            bad += 1
            line = '%-9s ERROR     %s | %s' % (tab, q, e)
        print(line)
        sys.stdout.flush()
        lines.append(line)

    head = ['추천 질문 검증 · %s' % time.strftime('%Y-%m-%d %H:%M:%S'),
            '대상 %s · 질문 %d개 · 근거 없음 %d개' % (base, len(cand), bad),
            '근거 없음이 있으면 그 질문을 바꾸고 다시 돌린다 (assets/chat.js 의 SUGGEST)',
            '']
    io.open(OUT, 'w', encoding='utf-8').write('\n'.join(head + lines) + '\n')
    print()
    print('근거 없음 %d개 · %s' % (bad, os.path.relpath(OUT, ROOT).replace('\\', '/')))
    sys.exit(1 if bad else 0)


main()
