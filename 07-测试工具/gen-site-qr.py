# -*- coding: utf-8 -*-
"""生成演示站点二维码（答辩签到/材料用）。
用法: python 07-测试工具/gen-site-qr.py [url]
需要: pip install segno pillow
"""
import os
import sys

import segno
from PIL import Image, ImageDraw, ImageFont

URL = sys.argv[1] if len(sys.argv) > 1 else "https://bruceleezh.github.io/rainproof-pro/"
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "01-参赛材料", "交付物")
W = 1080


def font(size):
    for p in (r"C:\Windows\Fonts\msyhbd.ttc", r"C:\Windows\Fonts\msyh.ttc"):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    qr_png = os.path.join(OUT_DIR, "_qr_raw.png")
    segno.make(URL, error="m").save(qr_png, scale=12, border=2, dark="#0B1220", light="#FFFFFF")

    qr = Image.open(qr_png).convert("RGB")
    qr = qr.resize((W - 200, W - 200), Image.NEAREST)
    H = W + 250
    img = Image.new("RGB", (W, H), "#0B1220")
    img.paste(qr, (100, 60))

    d = ImageDraw.Draw(img)
    d.text((W / 2, W - 40), "扫码进入雨证演示站点", font=font(46), fill="#FFFFFF", anchor="mm")
    d.text((W / 2, W + 30), "RainProof · 链上保单 / 判定回放 / 核验台", font=font(28), fill="#7DD3FC", anchor="mm")
    d.text((W / 2, W + 90), URL.replace("https://", ""), font=font(26), fill="#94A3B8", anchor="mm")
    d.text((W / 2, W + 150), "手机浏览器可直接打开；投保需 MetaMask 类钱包，只读页无需钱包", font=font(22), fill="#64748B", anchor="mm")

    out = os.path.join(OUT_DIR, "演示站点二维码.png")
    img.save(out, optimize=True)
    os.remove(qr_png)
    print("url:", URL)
    print("out:", os.path.abspath(out), os.path.getsize(out), "bytes", img.size)


if __name__ == "__main__":
    main()
