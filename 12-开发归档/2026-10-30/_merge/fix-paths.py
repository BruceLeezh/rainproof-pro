# -*- coding: utf-8 -*-
import io

def patch(p, pairs):
    s = io.open(p, encoding="utf-8").read()
    o = s
    for a, b in pairs:
        if a not in s:
            print("MISS", p, a[:70])
            continue
        s = s.replace(a, b)
    io.open(p, "w", encoding="utf-8", newline="").write(s)
    print(("OK   " if s != o else "NOCHG"), p)

patch("01-参赛材料/02-定价-人民币口径/rmb-pricing.js", [
    (r"C:\Users\lenovo\Desktop\汉客松\雨证·Rainproof\10-金融与定价\pricing-engine.json",
     r"<项目根>\10-金融与定价\pricing-engine.json"),
    ('"../../雨证·Rainproof/10-金融与定价/pricing-engine.json"',
     '"../../10-金融与定价/pricing-engine.json"'),
    ('"../../雨证·Rainproof/10-金融与定价/rmb-pricing-base.md"',
     '"../../10-金融与定价/rmb-pricing-base.md"'),
])

patch("04-脚本/patch-deck.py", [
    ('DECK = HERE.parent.parent / "保险创业赛-2026" / "神麻组-雨证-路演PPT-答辩版-2026-10-28.pptx"',
     'DECK = HERE.parent / "01-参赛材料" / "交付物" / "PPT" / "神麻组-雨证-路演PPT-答辩版-2026-10-28.pptx"'),
])

patch("07-测试工具/audit-inventory.py", [
    ('for base in [ROOT, ROOT.parent / "保险创业赛-2026", ROOT.parent / "00-赛事资料"]:',
     'for base in [ROOT]:'),
])

patch("07-测试工具/check-city-dashboard.py", [
    (r"ROOT=Path(r'C:\Users\lenovo\Desktop\汉客松\雨证·Rainproof')",
     "ROOT=Path(__file__).resolve().parent.parent"),
])

patch("04-脚本/ops-daily.ps1", [
    (r"C:\Users\lenovo\Desktop\汉客松\雨证·Rainproof\04-脚本",
     r"C:\Users\lenovo\Desktop\汉客松\雨证\04-脚本"),
])

patch("04-脚本/setgrid-v4.js", [("保险创业赛-2026/02-定价-人民币口径", "01-参赛材料/02-定价-人民币口径")])
patch("07-测试工具/check-rmb-grid.js", [("保险创业赛-2026/02-定价-人民币口径", "01-参赛材料/02-定价-人民币口径")])
