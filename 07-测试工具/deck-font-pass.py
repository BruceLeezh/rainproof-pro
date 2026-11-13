# -*- coding: utf-8 -*-
"""字号整治 v2（保守版）：只放大 ≤11.9pt 的正文，跳过单行标签框，按估算拦截溢出。
规则：
  · 只处理 run 字号 < 12pt（正文小字）；≥12pt 一律不动
  · 新字号 = 原字号 + 1.5，四舍五入到 0.5，上限 13.5
  · 跳过：框高 < 0.30in 的单行标签框；估算溢出 > 1.35× 的框（保留原字号）
运行：python 07-测试工具/deck-font-pass.py --apply
"""
import pathlib
import sys

from pptx import Presentation
from pptx.util import Pt

ROOT = pathlib.Path(__file__).resolve().parent.parent
DECKS = [
    ROOT / "01-参赛材料/交付物/PPT/雨证-路演PPT-答辩版-2026-10-28.pptx",
    ROOT / "01-参赛材料/交付物/PPT/雨证-路演PPT-精简版-2026-10-30.pptx",
]


def cjk_units(text):
    return sum(1 if ord(ch) > 0x2E80 else 0.55 for ch in text)


def estimate(shp, size, text):
    w_in = (shp.width or 0) / 914400
    h_in = (shp.height or 0) / 914400
    if w_in <= 0.2 or h_in <= 0.2:
        return 1.0
    per_line = max(1.0, w_in * 72 / size)
    lines = 0
    for para in text.split("\n"):
        u = cjk_units(para)
        lines += max(1, int(u / per_line) + (1 if u % per_line else 0))
    return lines * size * 1.35 / 72 / h_in


for deck in DECKS:
    prs = Presentation(str(deck))
    changed = skipped_box = skipped_fit = 0
    for slide in prs.slides:
        for shp in slide.shapes:
            if not shp.has_text_frame:
                continue
            txt = shp.text_frame.text
            if not txt.strip():
                continue
            h_in = (shp.height or 0) / 914400
            w_in = (shp.width or 0) / 914400
            if h_in < 0.30:                       # 单行标签/数字框：原尺寸已为排版定制
                skipped_box += 1
                continue
            if w_in < 1.2 and cjk_units(txt.strip()) > 5:   # 窄框长文本：放大必折行
                skipped_box += 1
                continue
            sizes = [r.font.size.pt for p in shp.text_frame.paragraphs for r in p.runs if r.font.size]
            if not sizes:
                continue
            base = max(sizes)
            if base >= 12:
                continue
            new = min(13.5, round((base + 1.5) * 2) / 2)
            if estimate(shp, new, txt) > 1.35:    # 放大后会明显溢出：不动
                skipped_fit += 1
                continue
            for p in shp.text_frame.paragraphs:
                for r in p.runs:
                    if r.font.size and r.font.size.pt < 12:
                        r.font.size = Pt(new)
                        changed += 1
    prs.save(str(deck))
    print(f"{deck.name}: 放大 {changed} 个 run · 跳过标签框 {skipped_box} · 跳过溢出风险 {skipped_fit}")
