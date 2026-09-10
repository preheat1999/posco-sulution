# -*- coding: utf-8 -*-
"""시연용 정적 서버.

두 가지 때문에 python -m http.server 를 쓰지 않는다 ·
  1) no-store 를 안 보내서 고친 js 가 브라우저 캐시에 붙어 옛 값으로 뜬다
  2) 127.0.0.1 로만 열려서 폰이 못 붙는다 (같은 Wi-Fi 에서 QR 을 찍어 볼 수 없다)

사용법 ·
    python -B serve.py                 0.0.0.0:8130 · 폰에서 붙을 수 있다
    python -B serve.py --port 9000
    python -B serve.py --host 127.0.0.1 이 컴퓨터에서만

띄우면 폰으로 열 주소와 QR 만드는 명령을 같이 적어 준다.

또 하나 · /rag/... 로 오는 요청을 RAG 서버로 넘긴다 (같은 출처로 부르게 만들어 CORS 를 없앤다).
폰은 http://10.1.14.204:8130 으로 들어오는데 그 주소는 RAG 서버 허용 목록에 없다 ·
브라우저가 막는 것이고 서버는 정상이다. 화면이 /rag/api/chat/stream 을 부르면
이 서버가 .env 의 토큰을 붙여 10.1.14.205:8000 으로 대신 물어보고 답을 그대로 흘려 준다.

또 하나 · /llm/route 로 오는 질문을 LLM 라우터에 넘긴다.
질문 문장과 도구 목록(assets/tools.json)만 보내고 「어느 도구를 어떤 값으로 부를지」를
받는다 · 자재 행 · 금액 · 부서 값은 LLM 으로 가지 않고, 답은 브라우저가 우리 데이터로 만든다.
키(LLM_API_KEY)는 .env 에 두고 브라우저로 내려보내지 않는다.

또 하나 · .env 를 읽어 assets/config.local.js 를 만든다.
화면은 정적 파일(빌드 없음)이라 브라우저가 .env 를 직접 읽을 수 없다 · 그 다리를 여기서 놓는다.
.env 와 config.local.js 는 둘 다 .gitignore 다 (저장소가 공개라 토큰을 올리면 안 된다).
"""
import argparse
import functools
import http.server
import io
import json
import os
import re
import socket
import socketserver
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))


RAG = {'api': '', 'token': ''}      # .env 에서 읽는다 (main 이 채운다)
LLM = {'key': '', 'model': '', 'url': 'https://api.anthropic.com/v1/messages'}
# 음성 → 글자. OpenAI 음성 인식(whisper) · 키는 .env 의 OPENAI_API_KEY · 브라우저로 내려가지 않는다.
# 키가 없으면 화면은 브라우저 내장 음성 인식(Web Speech)으로 대신한다 (config.local.js 의 STT 가 비어 있다)
STT = {'key': '', 'model': 'whisper-1', 'url': 'https://api.openai.com/v1/audio/transcriptions'}
PREFIX = '/rag/'
LLM_PATH = '/llm/route'
STT_PATH = '/stt'
TOOLS_CACHE = {'mtime': 0, 'data': None}


def load_tools():
    """assets/tools.json 을 읽는다. 파일이 바뀌면 다시 읽는다 (서버를 다시 안 띄워도 된다)."""
    path = os.path.join(ROOT, 'assets', 'tools.json')
    if not os.path.exists(path):
        return None
    m = os.path.getmtime(path)
    if TOOLS_CACHE['data'] is None or m != TOOLS_CACHE['mtime']:
        TOOLS_CACHE['data'] = json.load(io.open(path, encoding='utf-8'))
        TOOLS_CACHE['mtime'] = m
    return TOOLS_CACHE['data']


class H(http.server.SimpleHTTPRequestHandler):
    """정적 파일 + /rag/ 프록시."""

    def do_POST(self):
        if self.path.startswith(PREFIX):
            self.proxy('POST')
            return
        if self.path.split('?')[0] == LLM_PATH:
            self.route_question()
            return
        if self.path.split('?')[0] == STT_PATH:
            self.transcribe()
            return
        self.send_error(405, 'Only /rag/, /llm/route and /stt accept POST')

    def transcribe(self):
        """녹음(webm/ogg/mp4) 바이트 → 한국어 문장. 소리 파일은 저장하지 않고 그대로 넘긴다."""
        n = int(self.headers.get('Content-Length') or 0)
        if not STT['key']:
            self.json_out(503, {'detail': '.env 에 OPENAI_API_KEY 가 없습니다 · 브라우저 음성 인식을 씁니다'})
            return
        if n <= 0 or n > 25 * 1024 * 1024:
            self.json_out(400, {'detail': '녹음이 비었거나 25MB 를 넘습니다'})
            return
        audio = self.rfile.read(n)
        ctype = self.headers.get('Content-Type') or 'audio/webm'
        ext = 'webm'
        for k, v in (('ogg', 'ogg'), ('mp4', 'mp4'), ('mpeg', 'mp3'), ('wav', 'wav'), ('webm', 'webm')):
            if k in ctype:
                ext = v
                break
        boundary = '----mtrlvoice%d' % int(time.time() * 1000)
        parts = []

        def field(name, value):
            parts.append(('--%s\r\nContent-Disposition: form-data; name="%s"\r\n\r\n%s\r\n'
                          % (boundary, name, value)).encode('utf-8'))
        field('model', STT['model'])
        field('language', 'ko')
        field('response_format', 'json')
        parts.append(('--%s\r\nContent-Disposition: form-data; name="file"; filename="voice.%s"\r\n'
                      'Content-Type: %s\r\n\r\n' % (boundary, ext, ctype.split(';')[0])).encode('utf-8'))
        parts.append(audio)
        parts.append(('\r\n--%s--\r\n' % boundary).encode('utf-8'))
        body = b''.join(parts)
        r = urllib.request.Request(
            STT['url'], data=body,
            headers={'Authorization': 'Bearer ' + STT['key'],
                     'Content-Type': 'multipart/form-data; boundary=' + boundary})
        t0 = time.time()
        try:
            with urllib.request.urlopen(r, timeout=60) as up:
                out = json.loads(up.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            self.json_out(e.code, {'detail': 'STT 오류 · ' + e.read().decode('utf-8', 'replace')[:300]})
            return
        except Exception as e:
            self.json_out(502, {'detail': 'STT 서버에 닿지 못했습니다 · ' + str(e)})
            return
        self.json_out(200, {'text': str(out.get('text') or '').strip(),
                            'ms': int((time.time() - t0) * 1000), 'model': STT['model']})

    def json_out(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except Exception:
            pass

    def route_question(self):
        """질문 → 도구 하나 + 값. 답을 만들지는 않는다 (그건 브라우저가 우리 데이터로 한다).

        보내는 것 · 질문 문장 · 최근 대화 두 턴의 질문 문장 · 도구 스키마.
        보내지 않는 것 · 자재 행 · 금액 · 부서 · 담당자 이름. 규칙이다.
        """
        n = int(self.headers.get('Content-Length') or 0)
        try:
            req = json.loads(self.rfile.read(n).decode('utf-8')) if n else {}
        except Exception:
            self.json_out(400, {'detail': '요청이 JSON 이 아닙니다'})
            return
        q = str(req.get('question') or '').strip()
        if not q:
            self.json_out(400, {'detail': '질문이 비어 있습니다'})
            return
        if len(q) > 500:
            q = q[:500]

        spec = load_tools()
        if not spec:
            self.json_out(503, {'detail': 'assets/tools.json 이 없습니다'})
            return
        if not LLM['key']:
            self.json_out(503, {'detail': '.env 에 LLM_API_KEY 가 없습니다'})
            return

        msgs = []
        # 앞 대화는 질문 문장만 싣는다 · 답(우리 데이터가 섞인 문장)은 보내지 않는다
        for h in (req.get('history') or [])[-2:]:
            hq = str((h or {}).get('question') or '').strip()
            if hq:
                msgs.append({'role': 'user', 'content': hq[:300]})
                msgs.append({'role': 'assistant', 'content': '(도구를 골라 답했습니다)'})
        msgs.append({'role': 'user', 'content': q})

        # 화면 문맥 · 어느 화면인지 · 「이 자재」 가 무엇인지. 코드 한 개와 화면 키만 보낸다
        ctx = req.get('context') or {}
        ctx_line = ''
        route = re.sub(r'[^a-z_-]', '', str(ctx.get('route') or '').lower())[:20]
        sel = str(ctx.get('selectedCode') or '').upper()
        sel = sel if re.match(r'^Q[0-9]{7}$', sel) else ''
        stage = re.sub(r'[^a-z]', '', str(ctx.get('stage') or '').lower())[:10]
        if route or sel:
            ctx_line = ('\n\n## 지금 화면 문맥\n- route: %s\n- selectedCode: %s\n- stage: %s'
                        % (route or '(모름)', sel or '(없음 · 「이 자재」 라고 하면 코드를 비워 둔다)',
                           stage or '(모름)'))

        tools = list(spec.get('tools') or []) + [
            {k: v for k, v in a.items() if k != 'kind'} for a in (spec.get('actions') or [])]
        body = {
            'model': LLM['model'],
            'max_tokens': 600,
            'system': (spec.get('system') or '') + ctx_line,
            'tools': tools,
            'tool_choice': {'type': 'any'},      # 반드시 도구를 고르게 한다
            'messages': msgs,
        }
        r = urllib.request.Request(
            LLM['url'], data=json.dumps(body, ensure_ascii=False).encode('utf-8'),
            headers={'x-api-key': LLM['key'], 'anthropic-version': '2023-06-01',
                     'content-type': 'application/json'})
        t0 = time.time()
        try:
            with urllib.request.urlopen(r, timeout=30) as up:
                out = json.loads(up.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            detail = e.read().decode('utf-8', 'replace')[:300]
            self.json_out(e.code, {'detail': 'LLM 오류 · ' + detail})
            return
        except Exception as e:
            self.json_out(502, {'detail': 'LLM 에 닿지 못했습니다 · ' + str(e)})
            return

        picks = [c for c in (out.get('content') or []) if c.get('type') == 'tool_use']
        if not picks:
            self.json_out(200, {'tool': None, 'input': {}, 'picks': [],
                                'ms': int((time.time() - t0) * 1000)})
            return
        # 한 문장에 일이 여럿이면 도구가 여러 개 온다 · 순서대로 준다 (같은 이름은 한 번만)
        known = set(t['name'] for t in tools)
        flat = []
        for c in picks:
            if c.get('name') == 'multi_step':
                # 순서 목록 · 안에 든 도구 이름도 아는 것만 · 다시 겹쳐 넣는 것은 버린다
                for st in ((c.get('input') or {}).get('steps') or [])[:4]:
                    if isinstance(st, dict) and st.get('tool') != 'multi_step':
                        flat.append({'name': st.get('tool'), 'input': st.get('input') or {}})
            else:
                flat.append({'name': c.get('name'), 'input': c.get('input') or {}})
        plist, seen = [], set()
        for c in flat:
            nm = c.get('name')
            sig = str(nm) + json.dumps(c.get('input') or {}, sort_keys=True, ensure_ascii=False)
            if nm in known and nm != 'multi_step' and sig not in seen:
                plist.append({'tool': nm, 'input': c.get('input') or {}})
                seen.add(sig)
        self.json_out(200, {
            'tool': plist[0]['tool'] if plist else None,
            'input': plist[0]['input'] if plist else {},
            'picks': plist[:4],
            'ms': int((time.time() - t0) * 1000),
            'model': out.get('model'),
            'usage': out.get('usage'),
        })

    def do_GET(self):
        if self.path.startswith(PREFIX):
            self.proxy('GET')
            return
        super().do_GET()

    def proxy(self, method):
        """/rag/api/... → <RAG 서버>/api/... 로 넘긴다.

        스트림(NDJSON)을 그대로 흘려야 진행 표시가 산다 · 다 받고 나서 한 번에 주면
        6~11초 동안 화면이 멈춘 것처럼 보인다. 그래서 청크 단위로 바로 내려보낸다.
        """
        if not RAG['api']:
            self.send_error(503, 'CHAT_API not set in .env')
            return
        url = RAG['api'].rstrip('/') + '/' + self.path[len(PREFIX):].lstrip('/')
        body = None
        if method == 'POST':
            n = int(self.headers.get('Content-Length') or 0)
            body = self.rfile.read(n) if n else b''
        req = urllib.request.Request(url, data=body, method=method)
        req.add_header('Content-Type', self.headers.get('Content-Type') or 'application/json')
        if RAG['token']:
            # 토큰은 서버에서 붙인다 · 브라우저로 내려보내지 않아도 된다
            req.add_header('X-API-Token', RAG['token'])
        try:
            with urllib.request.urlopen(req, timeout=180) as up:
                self.send_response(up.status)
                ctype = up.headers.get('Content-Type') or 'application/json'
                self.send_header('Content-Type', ctype)
                self.end_headers()
                while True:
                    chunk = up.read(1)          # 한 바이트씩 · 줄이 오는 대로 흘려 준다
                    if not chunk:
                        break
                    try:
                        self.wfile.write(chunk)
                        self.wfile.flush()
                    except (BrokenPipeError, ConnectionAbortedError):
                        return                  # 사용자가 서랍을 닫았다
        except urllib.error.HTTPError as e:
            msg = e.read()
            self.send_response(e.code)
            self.send_header('Content-Type', e.headers.get('Content-Type') or 'application/json')
            self.end_headers()
            try:
                self.wfile.write(msg)
            except Exception:
                pass
        except Exception as e:
            self.send_response(502)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            try:
                self.wfile.write(('{"detail":"RAG 서버에 닿지 못했습니다 · %s"}'
                                  % str(e).replace('"', "'")).encode('utf-8'))
            except Exception:
                pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *a):
        # 폰에서 붙었는지 봐야 하니 요청 줄만 짧게 남긴다
        print('  %s %s' % (self.address_string(), fmt % a))


def read_env():
    """.env 를 읽는다. 없으면 빈 사전이다 (연결값 없이도 화면은 떠야 한다)."""
    path = os.path.join(ROOT, '.env')
    out = {}
    if not os.path.exists(path):
        return out
    with io.open(path, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def write_local_config(env):
    """.env 값을 화면이 읽을 수 있는 js 로 내려 준다.

    CFG 를 덮지 않고 필요한 칸만 채운다 · assets/config.js 의 나머지 값은 그대로다.
    이 파일이 없어도 화면은 돈다 (그때는 서랍에서 토큰을 손으로 넣는다).
    """
    api = env.get('CHAT_API', '')
    token = env.get('CHAT_TOKEN', '')
    body = [
        '/* config.local.js · serve.py 가 .env 를 읽어 만든 파일이다.',
        ' *',
        ' * 손으로 고치지 않는다 · .env 를 고치고 서버를 다시 띄운다.',
        ' * 저장소에 올라가지 않는다 (.gitignore) · 토큰이 여기 있다.',
        ' */',
        '(function () {',
        "  'use strict';",
        '  var C = window.CFG = window.CFG || {};',
    ]
    if api:
        # 화면은 같은 출처의 /rag 를 부른다 · 이 서버가 RAG 서버로 넘긴다 (CORS 없음).
        # 토큰도 서버가 붙이므로 브라우저에 내려보내지 않는다
        body.append("  C.CHAT_API = '/rag';")
        body.append("  C.CHAT_API_UPSTREAM = '%s';" % api)
        body.append("  C.CHAT_PROXY = true;")
    if token:
        body.append("  C.CHAT_TOKEN_SRC = 'serve.py 프록시';")
    if env.get('LLM_API_KEY'):
        # 라우터가 켜졌다는 사실만 알린다 · 키는 내려보내지 않는다
        body.append("  C.ASK_ROUTE = '/llm/route';")
        body.append("  C.ASK_MODEL = '%s';" % (env.get('LLM_MODEL') or 'claude-haiku-4-5-20251001'))
    if env.get('OPENAI_API_KEY'):
        # 음성 인식 프록시가 켜졌다는 사실만 · 키는 서버에 있다. 없으면 브라우저 내장 인식으로 간다
        body.append("  C.STT = '/stt';")
        body.append("  C.STT_MODEL = '%s';" % (env.get('STT_MODEL') or 'whisper-1'))
    body.append('})();')
    body.append('')
    path = os.path.join(ROOT, 'assets', 'config.local.js')
    io.open(path, 'w', encoding='utf-8', newline='\n').write('\n'.join(body))
    return {'api': api, 'token': bool(token), 'path': path}


def lan_ip():
    """이 컴퓨터가 같은 Wi-Fi 에서 보이는 주소. 폰이 붙을 주소다."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        return s.getsockname()[0]
    except Exception:
        return '127.0.0.1'
    finally:
        s.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--host', default='0.0.0.0')
    ap.add_argument('--port', type=int, default=8130)
    a = ap.parse_args()

    env = read_env()
    local = write_local_config(env)
    RAG['api'] = env.get('CHAT_API', '')
    RAG['token'] = env.get('CHAT_TOKEN', '')
    LLM['key'] = env.get('LLM_API_KEY', '')
    LLM['model'] = env.get('LLM_MODEL', '') or 'claude-haiku-4-5-20251001'
    STT['key'] = env.get('OPENAI_API_KEY', '')
    STT['model'] = env.get('STT_MODEL', '') or 'whisper-1'
    ip = lan_ip()
    base = 'http://%s:%d' % (ip, a.port)
    print('서버 · %s:%d (no-store)' % (a.host, a.port))
    print('  이 컴퓨터 · http://127.0.0.1:%d/main.html' % a.port)
    print('  폰 · 같은 Wi-Fi · %s/main.html' % base)
    print('  폰 · QR 진입 · %s/mobile-return.html?code=Q4046777' % base)
    print()
    print('이 주소로 QR 만들기 ·')
    print('  python -B make_qr.py --base %s --all' % base)
    print()
    print('RAG · %s' % (local['api'] or '주소 없음'))
    if local['api']:
        print('  화면은 같은 출처의 /rag 를 부르고 이 서버가 넘긴다 · CORS 가 생기지 않는다')
        print('  토큰 %s · 서버에서 붙인다 (브라우저로 내려보내지 않음)'
              % ('있음' if local['token'] else '없음 · .env 에 CHAT_TOKEN 을 넣어라'))
        print('  폰도 그대로 된다 · %s/main.html' % base)
    tools = load_tools()
    print('질의 라우터 · %s · 도구 %d개 · 키 %s (브라우저로 내려보내지 않음)'
          % (LLM['model'], len((tools or {}).get('tools') or []),
             '있음' if LLM['key'] else '없음 · .env 에 LLM_API_KEY 를 넣어라'))
    print('  질문 문장만 보낸다 · 자재 값은 브라우저 안에서 답을 만든다')
    print('음성 인식 · %s' % ('/stt → OpenAI ' + STT['model'] + ' (키는 서버에)' if STT['key']
                           else '브라우저 내장(Web Speech) · .env 에 OPENAI_API_KEY 를 넣으면 /stt 로 바뀐다'))
    print('  마이크는 https 또는 localhost 에서만 열린다 · 폰(IP 주소)에서는 브라우저가 막는다')
    print()
    print('폰이 안 붙으면 · 윈도 방화벽에서 이 포트를 한 번 허용해야 한다')
    print('  (관리자 명령창) netsh advfirewall firewall add rule '
          'name="mtrl demo %d" dir=in action=allow protocol=TCP localport=%d'
          % (a.port, a.port))
    print()

    os.chdir(ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer((a.host, a.port),
                                         functools.partial(H, directory=ROOT)) as srv:
        srv.serve_forever()


main()
