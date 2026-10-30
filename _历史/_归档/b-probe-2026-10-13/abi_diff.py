import json, re, io, sys

repo = r"C:\Users\lenovo\Desktop\汉客松\rainproof"
html = io.open(repo + r"\05-演示站点\index.html", encoding="utf-8").read()
m = re.search(r"const ABI = \[(.*?)\];", html, re.S)
page = json.loads("[" + m.group(1) + "]")

def sig(e):
    t = e.get("type")
    ins = ",".join(i.get("type", "") for i in e.get("inputs", []) or [])
    if t == "function":
        return "fn %s(%s)" % (e.get("name"), ins)
    if t == "event":
        return "ev %s(%s)" % (e.get("name"), ins)
    if t == "error":
        return "er %s(%s)" % (e.get("name"), ins)
    return "%s %s(%s)" % (t, e.get("name", ""), ins)

pset = set(map(sig, page))
print("page entries:", len(page))

v3 = json.load(io.open(repo + r"\03-合约\RainDeliveryInsuranceV3.abi.json", encoding="utf-8"))
v3set = set(map(sig, v3))
print("v3 abi entries:", len(v3))
print("--- page-only (not in V3 abi.json) ---")
for s in sorted(pset - v3set):
    print("  +", s)
print("--- V3-only (missing from page) ---")
for s in sorted(v3set - pset):
    print("  -", s)

sol = io.open(repo + r"\03-合约\RainDeliveryInsuranceV3.sol", encoding="utf-8").read()
print("--- does the .sol define them? ---")
for s in sorted(pset - v3set):
    name = s.split()[1].split("(")[0]
    hits = re.findall(r"function\s+%s\s*\(" % re.escape(name), sol)
    print("  %-40s in .sol: %d" % (s, len(hits)))
