# -*- coding: utf-8 -*-
"""把文档里的旧根名 雨证·Rainproof 统一成 雨证（跳过 _历史 / node_modules / site-dist）。"""
import os, io

ROOT = r"C:\Users\lenovo\Desktop\汉客松\雨证"
SKIP_DIRS = {"node_modules", ".git", "_历史", "site-dist", "__pycache__"}
changed = []
for dp, dns, fns in os.walk(ROOT):
    dns[:] = [d for d in dns if d not in SKIP_DIRS]
    for fn in fns:
        if not fn.endswith(".md"):
            continue
        p = os.path.join(dp, fn)
        try:
            s = io.open(p, encoding="utf-8").read()
        except UnicodeDecodeError:
            continue
        o = s
        s = s.replace("../雨证·Rainproof/", "../")
        s = s.replace("雨证·Rainproof/", "")
        s = s.replace("雨证·Rainproof", "雨证")
        if s != o:
            io.open(p, "w", encoding="utf-8", newline="").write(s)
            changed.append(os.path.relpath(p, ROOT))

for c in changed:
    print("改", c)
print("共", len(changed), "份")
