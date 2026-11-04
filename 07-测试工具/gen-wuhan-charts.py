# -*- coding: utf-8 -*-
"""生成武汉落地的两张答辩用图（读 武汉落地素材.json，数据由 gen-wuhan-case.js 计算并自校验）。
输出：01-参赛材料/交付物/图表/wuhan-price-bars.png（链上现价 1.75×）
     01-参赛材料/交付物/图表/wuhan-season.png（季节倍数 4.9–7.1×）
运行：python 07-测试工具/gen-wuhan-charts.py
"""
import json
import pathlib

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = json.loads((ROOT / "02-作战与答辩" / "武汉落地素材.json").read_text(encoding="utf-8"))
OUT = ROOT / "01-参赛材料" / "交付物" / "图表"
OUT.mkdir(parents=True, exist_ok=True)

# 中文字体
for name in ("Microsoft YaHei", "SimHei", "DengXian"):
    if any(f.name == name for f in font_manager.fontManager.ttflist):
        plt.rcParams["font.sans-serif"] = [name]
        break
plt.rcParams["axes.unicode_minus"] = False

NAVY = "#1F3864"
BLUE = "#2E5395"
LIGHT = "#9DB4D6"
GRAY = "#8A8A8A"
ACCENT = "#C00000"

regions = sorted(DATA["regions"], key=lambda r: r["code"])
names = [r["name"].replace("区", "") for r in regions]
y12 = [r["chain12"] / 100 for r in regions]
y24 = [r["chain24"] / 100 for r in regions]

# ---------- 图 1：链上现价 ----------
fig, ax = plt.subplots(figsize=(13.0, 5.4), dpi=160)
x = range(len(names))
w = 0.38
b1 = ax.bar([i - w / 2 for i in x], y12, w, label="12h 保障", color=LIGHT)
b2 = ax.bar([i + w / 2 for i in x], y24, w, label="24h 保障", color=NAVY)
ax.set_xticks(list(x))
ax.set_xticklabels(names, fontsize=15)
ax.set_ylabel("链上现价（元）", fontsize=16)
ax.set_ylim(0, 12.4)
ax.tick_params(axis="y", labelsize=14)
ax.spines[["top", "right"]].set_visible(False)
ax.grid(axis="y", color="#E6E6E6", linewidth=0.8)
ax.set_axisbelow(True)
ax.legend(fontsize=15, frameon=False, loc="upper left", ncol=2)

hi = max(range(len(y24)), key=lambda i: y24[i])
lo = min(range(len(y24)), key=lambda i: y24[i])
ax.annotate(f"{y24[hi]:.2f} 元", (hi + w / 2, y24[hi]), textcoords="offset points",
            xytext=(0, 8), ha="center", fontsize=16, color=ACCENT, fontweight="bold")
ax.annotate(f"{y24[lo]:.2f} 元", (lo + w / 2, y24[lo]), textcoords="offset points",
            xytext=(0, 8), ha="center", fontsize=16, color=BLUE, fontweight="bold")
ax.set_title(f"同一座武汉：24h 保费 {y24[lo]:.2f}–{y24[hi]:.2f} 元（{y24[hi]/y24[lo]:.2f}×），没有一张均价糊过去",
             fontsize=20, color=NAVY, pad=14, loc="left", fontweight="bold")
fig.text(0.012, 0.015, "数据：BOT Chain 968 · V6-T1 premiumOf() 实读 · 2026-11-04", fontsize=11, color=GRAY)
fig.tight_layout(rect=(0, 0.03, 1, 1))
p1 = OUT / "wuhan-price-bars.png"
fig.savefig(p1, facecolor="white")
plt.close(fig)
print("written:", p1)

# ---------- 图 2：季节倍数 ----------
m1 = [r["m1_24"] / 100 for r in regions]
m7 = [r["m7_24"] / 100 for r in regions]
ratio = [b / a for a, b in zip(m1, m7)]

fig, ax = plt.subplots(figsize=(13.0, 5.4), dpi=160)
ax.bar([i - w / 2 for i in x], m1, w, label="1 月（冬季）", color=LIGHT)
ax.bar([i + w / 2 for i in x], m7, w, label="7 月（雨季）", color=ACCENT)
ax.set_xticks(list(x))
ax.set_xticklabels(names, fontsize=15)
ax.set_ylabel("24h 研究保费（元）", fontsize=16)
ax.set_ylim(0, 13.2)
ax.tick_params(axis="y", labelsize=14)
ax.spines[["top", "right"]].set_visible(False)
ax.grid(axis="y", color="#E6E6E6", linewidth=0.8)
ax.set_axisbelow(True)
ax.legend(fontsize=15, frameon=False, loc="upper left", ncol=2)
for i, r in enumerate(ratio):
    ax.annotate(f"{r:.1f}×", (i + w / 2, m7[i]), textcoords="offset points",
                xytext=(0, 6), ha="center", fontsize=13, color=NAVY, fontweight="bold")
ax.set_title("同城不同季：7 月 / 1 月 = 4.9–7.1 倍（1 月全城触底 1.50 元兜底价）",
             fontsize=20, color=NAVY, pad=14, loc="left", fontweight="bold")
fig.text(0.012, 0.015, "数据：pricing-next 训练定价（core.quote 与 summary.examples 逐格自校验）· 12:00 起保", fontsize=11, color=GRAY)
fig.tight_layout(rect=(0, 0.03, 1, 1))
p2 = OUT / "wuhan-season.png"
fig.savefig(p2, facecolor="white")
plt.close(fig)
print("written:", p2)
