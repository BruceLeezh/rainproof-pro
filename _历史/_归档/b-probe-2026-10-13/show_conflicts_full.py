import subprocess, sys, io, os

OUT = io.open(r"C:\Users\lenovo\Desktop\汉客松\_b_probe\conflicts_full.txt", "w", encoding="utf-8")
def print(*a):
    OUT.write(" ".join(str(x) for x in a) + "\n")

repo = r"C:\Users\lenovo\Desktop\汉客松\rainproof"
os.chdir(repo)
want = sys.argv[1:]  # substrings of basenames; empty = all
out = subprocess.run(["git", "-c", "core.quotepath=false", "diff", "--name-only", "--diff-filter=U"], capture_output=True)
files = [l for l in out.stdout.decode("utf-8", "replace").split("\n") if l.strip()]
for f in files:
    if want and not any(w in f for w in want):
        continue
    p = os.path.join(repo, f)
    lines = io.open(p, encoding="utf-8").read().split("\n")
    print("\n=== FILE:", f, "(", len(lines), "lines )")
    i = 0; n = 0
    while i < len(lines):
        if lines[i].startswith("<<<<<<<"):
            n += 1; j = i + 1; ours = []; theirs = []; k = None
            while j < len(lines) and not lines[j].startswith(">>>>>>>"):
                if lines[j].startswith("=======") and k is None: k = j
                elif k is None: ours.append(lines[j])
                else: theirs.append(lines[j])
                j += 1
            print("--- conflict #%d line %d  (ours %d lines / theirs %d lines)" % (n, i + 1, len(ours), len(theirs)))
            print("[OURS]")
            for x in ours: print(x)
            print("[THEIRS]")
            for x in theirs: print(x)
            i = j + 1
        else:
            i += 1
print("\nDONE")
OUT.close()
