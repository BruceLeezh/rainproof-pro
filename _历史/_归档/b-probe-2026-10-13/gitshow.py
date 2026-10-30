# -*- coding: utf-8 -*-
"""从 git 里取出某个提交的文件原始字节（避免 PowerShell 重定向把中文写坏）。"""
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8")
repo = r"C:\Users\lenovo\Desktop\汉客松\rainproof"
rel = sys.argv[1]
rev = sys.argv[2] if len(sys.argv) > 2 else "HEAD"
out = sys.argv[3] if len(sys.argv) > 3 else None
data = subprocess.run(["git", "-C", repo, "show", rev + ":" + rel],
                      capture_output=True).stdout
if out:
    with open(out, "wb") as f:
        f.write(data)
    print("写出 %s（%d 字节，LF=%d CRLF=%d）" % (out, len(data),
          data.count(b"\n") - data.count(b"\r\n"), data.count(b"\r\n")))
else:
    sys.stdout.write(data.decode("utf-8", "replace"))
