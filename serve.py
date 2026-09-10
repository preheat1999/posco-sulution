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
"""
import argparse
import functools
import http.server
import os
import socket
import socketserver

ROOT = os.path.dirname(os.path.abspath(__file__))


class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *a):
        # 폰에서 붙었는지 봐야 하니 요청 줄만 짧게 남긴다
        print('  %s %s' % (self.address_string(), fmt % a))


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
