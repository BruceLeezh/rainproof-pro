# -*- coding: utf-8 -*-
"""把两张武汉图插进答辩版 PPT（克隆现有页头保风格，插在第 14 页之后，页码全表重编）。
运行：python 07-测试工具/insert-wuhan-slides.py
"""
import copy
import pathlib

from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN

ROOT = pathlib.Path(__file__).resolve().parent.parent
DECK = ROOT / "01-参赛材料/交付物/PPT/雨证-路演PPT-答辩版-2026-10-28.pptx"
CHART = ROOT / "01-参赛材料/交付物/图表"
NAVY = RGBColor(0x1F, 0x38, 0x64)
GRAY = RGBColor(0x77, 0x77, 0x77)

prs = Presentation(str(DECK))
TEMPLATE = prs.slides[13]  # S14：三个创新（页头结构标准）
HEADER = ["Rectangle 1", "Rectangle 2", "TextBox 3", "TextBox 4", "TextBox 5", "TextBox 6", "TextBox 7"]

PAGES = [
    {
        "title": "同一座武汉，24h 保费 6.00–10.50 元",
        "subtitle": "One city, 1.75× spread — priced per district, never averaged",
        "section": "04 / CASE · WUHAN",
        "kicker": "CASE · 城内差异：244 格逐区划定价的直接证据",
        "img": CHART / "wuhan-price-bars.png",
        "caption": "汉南临江低洼 10.50 元 vs 黄陂北部丘陵 6.00 元 —— 12h 档更平（4.70–6.70），短窗口把地形差异摊平；每一格都可用 premiumOf 在链上核对。",
    },
    {
        "title": "同城不同季：7 月 / 1 月 = 4.9–7.1 倍",
        "subtitle": "Same city, different season — priced from 11 years of hourly rainfall",
        "section": "04 / CASE · WUHAN",
        "kicker": "CASE · 季节差异：月 × 起保时点定价，不是季节系数拍脑袋",
        "img": CHART / "wuhan-season.png",
        "caption": "1 月全城 1.50 元是「最低保费兜底」在起作用，不是冬季无风险；7 月 7.30–10.60 元，新洲 7.1× 最高、黄陂 4.9× 最低 —— 季风路径差异被算进了价目表。",
    },
]

new_ids = []
for page in PAGES:
    s = prs.slides.add_slide(prs.slide_layouts[0])
    # 克隆页头形状（背景/色条/标题/副标/章标/页码/kicker）
    for shp in TEMPLATE.shapes:
        if shp.name in HEADER:
            s.shapes._spTree.append(copy.deepcopy(shp._element))
    texts = {}
    for shp in s.shapes:
        if shp.has_text_frame:
            texts[shp.name] = shp
    def settext(name, value):
        shp = texts.get(name)
        if shp is None:
            return
        tf = shp.text_frame
        p0 = tf.paragraphs[0]
        if p0.runs:
            p0.runs[0].text = value
            for r in p0.runs[1:]:
                r.text = ""
        else:
            p0.text = value
    settext("TextBox 3", page["title"])
    settext("TextBox 4", page["subtitle"])
    settext("TextBox 5", page["section"])
    settext("TextBox 7", page["kicker"])
    settext("TextBox 6", "")  # 页码稍后统一重编
    # 图（宽 11.83in，保持比例）
    from PIL import Image
    with Image.open(page["img"]) as im:
        w_px, h_px = im.size
    width = Inches(11.83)
    height = int(width * h_px / w_px)
    s.shapes.add_picture(str(page["img"]), Inches(0.75), Inches(1.72), width=width, height=height)
    # 说明行
    box = s.shapes.add_textbox(Inches(0.75), Inches(6.62), Inches(11.83), Inches(0.32))
    tf = box.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    r = p.add_run()
    r.text = page["caption"]
    r.font.size = Pt(10.5)
    r.font.color.rgb = GRAY
    r.font.name = "Microsoft YaHei"
    new_ids.append(s.slide_id)

# 移到第 14 页之后（索引 14 起）
sldIdLst = prs.slides._sldIdLst
ids = list(sldIdLst)
moved = [el for el in ids if el.get("id") in {str(i) for i in new_ids}]
for el in moved:
    sldIdLst.remove(el)
insert_at = 14
for offset, el in enumerate(moved):
    sldIdLst.insert(insert_at + offset, el)

# 页码重编：n / total
total = len(prs.slides)
for idx, slide in enumerate(prs.slides, start=1):
    for shp in slide.shapes:
        if not shp.has_text_frame:
            continue
        t = shp.text_frame.text.strip()
        if "/ 29" in t or "/ 31" in t:
            p0 = shp.text_frame.paragraphs[0]
            if p0.runs:
                p0.runs[0].text = f"{idx} / {total}"
                for r in p0.runs[1:]:
                    r.text = ""

prs.save(str(DECK))
print(f"done: {len(prs.slides)} slides (was 29), inserted at 15-16")
