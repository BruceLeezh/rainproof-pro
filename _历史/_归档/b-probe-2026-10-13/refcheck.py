# -*- coding: utf-8 -*-
"""只读坏引用扫描：从所有被跟踪的 md/txt 里抽出像路径的字符串，检查文件是否存在。"""
import os
import re
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8")
REPO = r"C:\Users\lenovo\Desktop\汉客松\rainproof"
EXT = r"(?:md|js|json|sol|html|png|jpg|jpeg|mp4|py|txt|pptx|docx|log|m4a|csv|yml|yaml|xlsx|pdf)"
PAT = re.compile(r"([0-9]{2}-[\u4e00-\u9fa5A-Za-z0-9_\-]+/[^\s`（）()\[\]<>\"'，。、；：]*?\.%s)" % EXT)
TOP_PAT = re.compile(r"\b((?:README|PRODUCT|DESIGN|AGENTS|LICENSE)[^\s`]*\.%s)" % EXT)

files = subprocess.run(["git", "-c", "core.quotepath=false", "ls-files"],
                       cwd=REPO, capture_output=True, text=True, encoding="utf-8").stdout.splitlines()
md = [f for f in files if f.lower().endswith((".md", ".txt"))]

missing = {}
for f in md:
    try:
        lines = open(os.path.join(REPO, f), encoding="utf-8", errors="ignore").read().splitlines()
    except OSError:
        continue
    for i, line in enumerate(lines, 1):
        for m in list(PAT.finditer(line)) + list(TOP_PAT.finditer(line)):
            p = m.group(1).strip().rstrip(".,;:）)")
            if "*" in p or "…" in p or "?" in p:
                continue
            full = os.path.join(REPO, p.replace("/", os.sep))
            if os.path.exists(full):
                continue
            missing.setdefault(p, []).append("%s:%d" % (f, i))

print("引用但仓库里不存在的路径：%d 个\n" % len(missing))
for p in sorted(missing, key=lambda x: (-len(missing[x]), x)):
    refs = missing[p]
    print("  ❌ %s" % p)
    for r in refs[:6]:
        print("       ← %s" % r)
    if len(refs) > 6:
        print("       ← …共 %d 处" % len(refs))
