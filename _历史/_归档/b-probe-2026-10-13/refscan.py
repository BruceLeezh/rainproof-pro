# -*- coding: utf-8 -*-
"""只读引用扫描：对每个被跟踪文件，统计其它被跟踪文本文件里提到它 basename 的次数。
0 次 = 孤儿候选（需人工复核：可能由代码按通配符/目录读取）。"""
import os
import re
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8")
REPO = r"C:\Users\lenovo\Desktop\汉客松\rainproof"
TEXT_EXT = {".md", ".js", ".json", ".sol", ".html", ".txt", ".yml", ".yaml",
            ".css", ".ts", ".mjs", ".cjs", ".py", ".sh", ".ps1", ""}
SKIP_DIRS = ("node_modules/", ".git/", "10-金融与定价/cache/")

files = subprocess.run(["git", "-c", "core.quotepath=false", "ls-files"],
                       cwd=REPO, capture_output=True, text=True,
                       encoding="utf-8").stdout.splitlines()
files = [f for f in files if f.strip()]

corpus = {}
for f in files:
    if f in SKIP_DIRS or any(f.startswith(d) for d in SKIP_DIRS):
        continue
    ext = os.path.splitext(f)[1].lower()
    if ext not in TEXT_EXT:
        continue
    try:
        corpus[f] = open(os.path.join(REPO, f), encoding="utf-8", errors="ignore").read()
    except OSError:
        pass

print("被跟踪文件 %d 个，其中可读文本 %d 个" % (len(files), len(corpus)))

orphans = []
for f in files:
    base = os.path.basename(f)
    if base in (".gitignore", "LICENSE") or f.endswith(".png") and False:
        pass
    hits = []
    for g, txt in corpus.items():
        if g == f:
            continue
        n = txt.count(base)
        if n:
            hits.append("%s×%d" % (g, n))
    # 目录整体被引用的（如 01-赛事资料/）也算：查父目录名
    if not hits:
        orphans.append((f, []))

print("\n=== 零引用（basename 未被任何其它文本文件提到）===")
for f, _ in sorted(orphans):
    print("  " + f)

print("\n=== 只被自身目录/同名派生引用（1 处且来自同目录）===")
for f in sorted(files):
    base = os.path.basename(f)
    refs = [(g, corpus[g].count(base)) for g in corpus if g != f and base in corpus[g]]
    if refs and len(refs) <= 2:
        print("  %-58s ← %s" % (f, ", ".join("%s×%d" % r for r in refs)))
