# -*- coding: utf-8 -*-
"""深色版武汉两张图（与 deck 背景 #0B1220 一致），数据同样读 武汉落地素材.json。
输出：C:/temp/charts-dark/wuhan-price-bars-dark.png / wuhan-season-dark.png（2080x864）
运行：python 07-测试工具/gen-wuhan-charts-dark.py
"""
import json
import pathlib

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = json.loads((ROOT / "02-作战与答辩" / "武汉落地素材.json").read_text(encoding="utf-8"))
OUT = pathlib.Path(r"C:\temp\charts-dark")
OUT.mkdir(parents=True, exist_ok=True)

for name in ("Microsoft YaHei", "SimHei", "DengXian"):
    if any(f.name == name for f in font_manager.fontManager.ttflist):
        plt.rcParams["font.sans-serif"] = [name]
        break
plt.rcParams["axes.unicode_minus"] = False

BG = "#0B1220"
FG = "#CBD5E1"
GRID = "#1E293B"
C12 = "#38BDF8"
C24 = "#2563EB"
C1 = "#64748B"
C7 = "#F87171"
ACC = "#F59E0B"

regions = sorted(DATA["regions"], key=lambda r: r["code"])
names = [r["name"].replace("区", "") for r in regions]
y12 = [r["chain12"] / 100 for r in regions]
y24 = [r["chain24"] / 100 for r in regions]

# ---------- 图 1：链上现价 ----------
fig, ax = plt.subplots(figsize=(13.0, 5.4), dpi=160)
fig.patch.set_facecolor(BG)
ax.set_facecolor(BG)
x = range(len(names))
w = 0.38
ax.bar([i - w / 2 for i in x], y12, w, label="12h 保障", color=C12, alpha=0.75)
ax.bar([i + w / 2 for i in x], y24, w, label="24h 保障", color=C24)
ax.set_xticks(list(x))
ax.set_xticklabels(names, fontsize=15, color=FG)
ax.set_ylim(0, 12.4)
ax.tick_params(axis="y", labelsize=14, colors=FG)
ax.tick_params(axis="x", colors=FG, length=0)
for s in ax.spines.values():
    s.set_visible(False)
ax.grid(axis="y", color=GRID, linewidth=0.8)
ax.set_axisbelow(True)
hi = max(range(len(y24)), key=lambda i: y24[i])
lo = min(range(len(y24)), key=lambda i: y24[i])
ax.annotate(f"{y24[hi]:.2f} 元", (hi + w / 2, y24[hi]), textcoords="offset points", xytext=(0, 10),
            ha="center", fontsize=17, color=ACC, fontweight="bold")
ax.annotate(f"{y24[lo]:.2f} 元", (lo + w / 2, y24[lo]), textcoords="offset points", xytext=(0, 10),
            ha="center", fontsize=17, color=ACC, fontweight="bold")
leg = ax.legend(loc="upper left", fontsize=15, frameon=False)
for t in leg.get_texts():
    t.set_color(FG)
fig.tight_layout(pad=0.6)
fig.savefig(OUT / "wuhan-price-bars-dark.png", facecolor=BG)
plt.close(fig)

# ---------- 图 2：季节倍数 ----------
y1 = [r["m1_24"] / 100 for r in regions]
y7 = [r["m7_24"] / 100 for r in regions]
fig, ax = plt.subplots(figsize=(13.0, 5.4), dpi=160)
fig.patch.set_facecolor(BG)
ax.set_facecolor(BG)
ax.bar([i - w / 2 for i in x], y1, w, label="1 月（冬季）", color=C1, alpha=0.8)
ax.bar([i + w / 2 for i in x], y7, w, label="7 月（雨季）", color=C7, alpha=0.9)
ax.set_xticks(list(x))
ax.set_xticklabels(names, fontsize=15, color=FG)
ax.set_ylim(0, 13.2)
ax.tick_params(axis="y", labelsize=14, colors=FG)
ax.tick_params(axis="x", colors=FG, length=0)
for s in ax.spines.values():
    s.set_visible(False)
ax.grid(axis="y", color=GRID, linewidth=0.8)
ax.set_axisbelow(True)
for i in x:
    if y1[i] > 0:
        ax.annotate(f"{y7[i] / y1[i]:.1f}×", (i + w / 2, y7[i]), textcoords="offset points",
                    xytext=(0, 8), ha="center", fontsize=14, color="#FCD34D", fontweight="bold")
leg = ax.legend(loc="upper center", bbox_to_anchor=(0.5, 1.12), ncol=2, fontsize=15, frameon=False)
for t in leg.get_texts():
    t.set_color(FG)
fig.tight_layout(pad=0.6)
fig.savefig(OUT / "wuhan-season-dark.png", facecolor=BG)
plt.close(fig)
print("ok", sorted(p.name for p in OUT.glob("*.png")))
