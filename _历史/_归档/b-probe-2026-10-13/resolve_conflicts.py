import io, os, subprocess, sys

repo = r"C:\Users\lenovo\Desktop\汉客松\rainproof"
os.chdir(repo)

# 默认取 ours（B 侧，已把过时的门禁计数改成不写死数字的表述）；
# 仅 DESIGN.md 的第 2 处冲突取 theirs（A 侧多出「2026-10-12 晚 第二轮」整段与 ⚠️ 注记）。
FORCE_THEIRS = {("DESIGN.md", 2)}

out = subprocess.run(["git", "-c", "core.quotepath=false", "diff", "--name-only", "--diff-filter=U"],
                     capture_output=True)
files = [l for l in out.stdout.decode("utf-8", "replace").split("\n") if l.strip()]
report = []
for f in files:
    p = os.path.join(repo, f)
    src = io.open(p, encoding="utf-8", newline="").read()
    lines = src.split("\n")
    res = []
    i = 0
    n = 0
    while i < len(lines):
        if lines[i].startswith("<<<<<<<"):
            n += 1
            j = i + 1
            ours, theirs, k = [], [], None
            while j < len(lines) and not lines[j].startswith(">>>>>>>"):
                if lines[j].startswith("=======") and k is None:
                    k = j
                elif k is None:
                    ours.append(lines[j])
                else:
                    theirs.append(lines[j])
                j += 1
            pick = "theirs" if (f, n) in FORCE_THEIRS else "ours"
            chosen = theirs if pick == "theirs" else ours
            report.append("%s  #%d -> %s (%d lines vs %d)" % (f, n, pick, len(ours), len(theirs)))
            res.extend(chosen)
            i = j + 1
        else:
            res.append(lines[i])
            i += 1
    io.open(p, "w", encoding="utf-8", newline="").write("\n".join(res))
    left = sum(1 for x in res if x.startswith("<<<<<<<") or x.startswith(">>>>>>>") or x.startswith("======="))
    report.append("   wrote %s ; leftover markers %d" % (f, left))

io.open(r"C:\Users\lenovo\Desktop\汉客松\_b_probe\resolve_report.txt", "w", encoding="utf-8").write("\n".join(report))
print("resolved", len(files), "files")
