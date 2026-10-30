import subprocess, sys, io, os

OUT = io.open(r"C:\Users\lenovo\Desktop\汉客松\_b_probe\conflicts.txt", "w", encoding="utf-8")
def print(*a):  # noqa
    OUT.write(" ".join(str(x) for x in a) + "\n")

repo = r"C:\Users\lenovo\Desktop\汉客松\rainproof"
os.chdir(repo)
out = subprocess.run(["git", "-c", "core.quotepath=false", "diff", "--name-only", "--diff-filter=U"],
                     capture_output=True)
files = [l for l in out.stdout.decode("utf-8", "replace").split("\n") if l.strip()]
print("UNMERGED:", len(files))
for f in files:
    p = os.path.join(repo, f)
    try:
        lines = io.open(p, encoding="utf-8").read().split("\n")
    except Exception as e:
        print("!!! cannot read", f, e); continue
    print("\n=== FILE:", f, "(", len(lines), "lines )")
    i = 0
    n = 0
    while i < len(lines):
        if lines[i].startswith("<<<<<<<"):
            n += 1
            j = i + 1; ours = []; theirs = []; k = None
            while j < len(lines) and not lines[j].startswith(">>>>>>>"):
                if lines[j].startswith("=======") and k is None:
                    k = j
                elif k is None:
                    ours.append(lines[j])
                else:
                    theirs.append(lines[j])
                j += 1
            print("--- conflict #%d  line %d" % (n, i + 1))
            print("  BEFORE: " + " | ".join(x.strip()[:70] for x in lines[max(0, i - 2):i]))
            print("  OURS  (%d):" % len(ours))
            for x in ours[:20]:
                print("    " + x[:150])
            if len(ours) > 20: print("    …(%d more)" % (len(ours) - 20))
            print("  THEIRS(%d):" % len(theirs))
            for x in theirs[:20]:
                print("    " + x[:150])
            if len(theirs) > 20: print("    …(%d more)" % (len(theirs) - 20))
            print("  AFTER : " + " | ".join(x.strip()[:70] for x in lines[j + 1:j + 3]))
            i = j + 1
        else:
            i += 1
    if n == 0:
        print("  (markers not found — probably staged/already resolved)")
