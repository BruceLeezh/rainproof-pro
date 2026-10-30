import json, io, re

repo = r"C:\Users\lenovo\Desktop\汉客松\rainproof"
html = io.open(repo + r"\05-演示站点\index.html", encoding="utf-8").read()
page = json.loads("[" + re.search(r"const ABI = \[(.*?)\];", html, re.S).group(1) + "]")

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
files = {
    "v1": r"\03-合约\RainDeliveryInsurance.abi.json",
    "v2": r"\03-合约\RainDeliveryInsuranceV2.abi.json",
    "v3": r"\03-合约\RainDeliveryInsuranceV3.abi.json",
    "msig": r"\03-合约\OperatorMultisig.abi.json",
}
sets = {}
for k, rel in files.items():
    a = json.load(io.open(repo + rel, encoding="utf-8"))
    sets[k] = set(map(sig, a))
    print("%-5s %3d 条  ⊂page %3d  page-only(缺) %3d" % (k, len(sets[k]), len(sets[k] & pset), len(sets[k] - pset)))

u3 = sets["v1"] | sets["v2"] | sets["v3"]
print("union(v1,v2,v3) =", len(u3))
print("page == union(v1,v2,v3)? ", pset == u3)
print("page-only vs union:", sorted(pset - u3))
print("union-only vs page:", sorted(u3 - pset))
print("union+msig =", len(u3 | sets["msig"]))

# 其它页面/单文件核验台的 ABI 条数
import os
for rel in [r"\05-演示站点\verifier.html", r"\06-核验台单文件\汉客松-链上核验台.html"]:
    t = io.open(repo + rel, encoding="utf-8").read()
    m = re.search(r"(?:const|var)\s+([A-Z_]*ABI[A-Z_]*)\s*=\s*\[", t)
    print(rel, "->", m.group(1) if m else "no inline ABI array found")
