# -*- coding: utf-8 -*-
"""접속 QR · 시연장에서 폰으로 찍어 들어오는 주소를 QR 한 장으로 만든다.

    python -B make_open_qr.py                 # 지금 이 컴퓨터의 IP 로 만든다
    python -B make_open_qr.py --url https://10.1.14.204:8443/main.html

왜 필요한가 · 마이크를 쓰려면 https 로 들어와야 하는데
「https://10.1.14.204:8443/main.html」 을 폰 자판으로 치게 하면 시연이 그 자리에서 끝난다.
QR 한 장을 띄워 두면 찍고 들어온다.

인증서 경고는 한 번 넘겨야 한다 · 그 문장도 그림 안에 적어 둔다
(안 적으면 「안 열린다」 는 말이 먼저 나온다).
"""
import argparse
import os
import socket

import segno
from PIL import Image, ImageDraw

from make_qr import font, wrap

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, 'qr')

BG = (255, 255, 255)
INK = (17, 20, 27)
GREY = (110, 118, 135)
BLUE = (45, 91, 215)


def lan_ip():
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
    ap.add_argument('--url', default=None)
    ap.add_argument('--port', type=int, default=8443)
    a = ap.parse_args()
    url = a.url or ('https://%s:%d/main.html' % (lan_ip(), a.port))

    if not os.path.isdir(OUT):
        os.makedirs(OUT)

    qr_png = os.path.join(OUT, 'open_qr.png')
    q = segno.make(url, error='m')
    q.save(qr_png, scale=10, border=2)

    qr = Image.open(qr_png).convert('RGB')
    W = 720
    qr = qr.resize((420, 420), Image.NEAREST)

    card = Image.new('RGB', (W, 700), BG)
    d = ImageDraw.Draw(card)
    f_t = font(30, True)
    f_u = font(19, True)
    f_b = font(17)
    f_s = font(15)

    d.text((40, 38), 'AI 자재 솔루션 · 접속', font=f_t, fill=INK)
    d.text((40, 80), '같은 Wi-Fi 에서 폰으로 찍으세요', font=f_b, fill=GREY)
    card.paste(qr, ((W - 420) // 2, 118))

    y = 560
    d.text((40, y), url, font=f_u, fill=BLUE)
    y += 34
    for line in wrap(d, '처음 한 번 · 「연결이 비공개가 아닙니다」 가 뜨면 고급 → 계속을 누르세요 · '
                        '이 컴퓨터가 만든 인증서입니다.', f_s, W - 80, 3):
        d.text((40, y), line, font=f_s, fill=GREY)
        y += 24
    d.text((40, y + 4), 'https 로 들어와야 마이크(음성 질의)가 열립니다.', font=f_s, fill=INK)

    out = os.path.join(OUT, 'open_label.png')
    card.save(out)
    print('접속 QR · %s' % url)
    print('  %s' % qr_png)
    print('  %s' % out)


if __name__ == '__main__':
    main()
