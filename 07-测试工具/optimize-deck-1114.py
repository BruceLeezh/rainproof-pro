# -*- coding: utf-8 -*-
"""答辩版（20 页，WPS 手改版）优化：先改内容，再重排顺序，最后统一页码/章节。
输出 C:/Users/lenovo/Desktop/雨证-路演PPT-答辩版-2026-11-14-优化版.pptx
"""
import pathlib

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.util import Emu, Pt

SRC = pathlib.Path(r"C:\Users\lenovo\Desktop\雨证-路演PPT-答辩版-2026-11-14.pptx")
DST = pathlib.Path(r"C:\Users\lenovo\Desktop\雨证-路演PPT-答辩版-2026-11-14-优化版.pptx")
CHARTS = pathlib.Path(r"C:\temp\charts-dark")
TOTAL = 20

prs = Presentation(str(SRC))
assert len(prs.slides) == TOTAL


def shape_by_id(slide, sid):
    for sh in slide.shapes:
        if sh.shape_id == sid:
            return sh
    raise KeyError(sid)


def rewrite(sh, lines):
    """替换整段文字，沿用首段首个 run 的字号/颜色/加粗。"""
    tf = sh.text_frame
    p0 = tf.paragraphs[0]
    base = p0.runs[0].font if p0.runs else None
    tf.text = lines[0] if len(lines) == 1 else "\n".join(lines)
    for p in tf.paragraphs:
        for r in p.runs:
            if base is not None:
                r.font.size = base.size
                r.font.bold = base.bold
                if base.color and base.color.type is not None:
                    try:
                        r.font.color.rgb = base.color.rgb
                    except Exception:
                        pass


EDITS = {
    (13, 10): ["汉南临江低洼 10.50 vs 黄陂北部丘陵 6.00 元 —— 12h 档更平（4.70–6.70），每一格都可用 premiumOf 在链上核对"],
    (14, 10): ["1 月 1.50 元是「最低保费兜底」在托底，不是冬季无风险；7 月 7.30–10.70 元，新洲 7.1× 最高、黄陂 4.9× 最低"],
    (16, 14): ["3.6 亿"],
    (16, 18): ["1.1 亿"],
    (3, 169): ["700 万＝美团 336 万＋蜂鸟约 400 万（口径并列不混算）；-30% 为暴雨日收入折损量级"],
    (8, 248): ["额度基数 100 元 · 最高给付 75 元（75% 档，另一档 50 元）"],
    (9, 123): ["五地雨量直读链上（示例读数）：上海 242、北京 82、广州 92、成都 27、汉南 180 mm；24h 档线 50 / 100，成都未到第一档。"],
    (9, 124): ["判定与赔付逐条留痕：已签发 4 张真实保单 —— 3 张到期结清、1 张保障中（#2 汉南 11-16 12:10 到期）、0 笔赔付；122 个区划每次喂价都可核验，区块号与证据哈希可逐条回溯。"],
    (10, 289): ["湖北 24 小时档最贵 10.5 元（汉南区）、最便宜 2.4 元（房县），相差 4.4 倍 ——",
                "按地理位置、保障时长、赔付结构与触发概率四个维度定价；用户类型与购买量已留接口，接入渠道后启用"],
    (16, 4): ["把 TAM 说小，市场依然很大"],
    (16, 10): ["19–26 亿"],
    (16, 12): ["500–700 万骑手 × 250 天 × 1.5 元"],
    (16, 24): ["骑手规模 500–700 万：美团 336 万 ＋ 蜂鸟约 400 万，直接相加 736 万；两口径有重叠，故压到 500–700 万"],
    (16, 35): ["边界：只算「会被暴雨打断收入」的那群人；五条假设全部可替换，换一个参数，结论跟着变。"],
    (19, 161): ["29 组门禁、819 项断言，含「每条留痕的哈希都能当场重算」"],
}

for (page, sid), lines in EDITS.items():
    sh = shape_by_id(prs.slides[page - 1], sid)
    rewrite(sh, lines)
    if page == 3 and sid == 169:
        sh.text_frame.word_wrap = True

# 图表换深色 + 图表标题
VERIFY_SHOT = pathlib.Path(r"C:\temp\verify-shot-crop.png")
for idx, fn in ((7, VERIFY_SHOT), (12, CHARTS / "wuhan-price-bars-dark.png"), (13, CHARTS / "wuhan-season-dark.png")):
    slide = prs.slides[idx]
    pics = [s for s in slide.shapes if s.shape_type == 13]
    assert len(pics) == 1, (idx, len(pics))
    pic = pics[0]
    rId = pic._element.blipFill.blip.rEmbed
    pic.part.related_part(rId)._blob = fn.read_bytes()

for sh in prs.slides[9].shapes:
    if sh.has_chart:
        ch = sh.chart
        ch.has_title = True
        ch.chart_title.text_frame.text = "首档触发概率（24h ≥ 50 mm ／ 12h ≥ 30 mm，%）"
        try:
            va = ch.value_axis
            va.tick_labels.number_format = "0.0"
            va.tick_labels.number_format_is_linked = False
        except Exception:
            pass
        for p in ch.chart_title.text_frame.paragraphs:
            for r in p.runs:
                r.font.size = Pt(14)
                r.font.bold = True
                r.font.color.rgb = RGBColor(0xE2, 0xE8, 0xF0)

# 修正图例系列名：python-pptx 不支持改 series.name，直接改 XML 缓存
from lxml import etree
NS = {"c": "http://schemas.openxmlformats.org/drawingml/2006/chart"}
for _slide in prs.slides:
  for sh in _slide.shapes:
    if not sh.has_chart:
        continue
    for ser in sh.chart._chartSpace.findall(".//c:ser", NS):
        for v in ser.findall(".//c:tx//c:v", NS):
            t = v.text or ""
            if "12h" in t:
                v.text = "12h 触发概率（≥30 mm，%）"
            elif "24h" in t:
                v.text = "24h 触发概率（≥50 mm，%）"

# B2B2C 卡补说明
s17 = prs.slides[16]
anchor = next(sh for sh in s17.shapes if sh.has_text_frame and sh.text_frame.text.strip() == "B2B2C")
anchor.top = Emu(5130000)
for para in anchor.text_frame.paragraphs:
    for r in para.runs:
        r.font.size = Pt(28)
tb = s17.shapes.add_textbox(Emu(838200), Emu(5620000), Emu(3505200), Emu(420000))
tb.text_frame.word_wrap = True
tb.text_frame.text = "先以平台为客户，把单城区在保规模做起来；规模起来后，再向保险公司输出定价与证据能力。"
for p in tb.text_frame.paragraphs:
    p.alignment = PP_ALIGN.LEFT
    for r in p.runs:
        r.font.size = Pt(10)
        r.font.color.rgb = RGBColor(0x94, 0xA3, 0xB8)

# 影响页底部结论句
s18 = prs.slides[17]
tb = s18.shapes.add_textbox(Emu(686000), Emu(5530000), Emu(10515000), Emu(460000))
tb.text_frame.word_wrap = True
tb.text_frame.text = "三件事指向同一个判断：这块缺口必须有人补，而且只有参数化的结构补得起。"
for p in tb.text_frame.paragraphs:
    for r in p.runs:
        r.font.size = Pt(15)
        r.font.bold = True
        r.font.color.rgb = RGBColor(0x22, 0xD3, 0xEE)

# 重排
ORDER = [0, 2, 3, 4, 5, 6, 8, 7, 18, 11, 9, 10, 12, 13, 14, 15, 16, 17, 1, 19]
lst = prs.slides._sldIdLst
items = list(lst)
for e in items:
    lst.remove(e)
for i in ORDER:
    lst.append(items[i])

# 页码 & 章节
import re
PAGE = re.compile(r"^\s*\d{1,2}\s*/\s*\d{1,2}\s*$")
SEC = re.compile(r"^\s*\d{2}\s*/\s*([A-Z][A-Z0-9 ·&.\-]*)$")
ACT = {"THE RIDER": "01", "THE MATH": "01", "THE INDUSTRY": "01",
       "THE TURN": "02", "THE POLICY": "02",
       "LIVE DEMO": "03", "EVIDENCE": "03",
       "ARCHITECTURE": "04", "INNOVATION": "04",
       "ACTUARY": "05", "CASE · WUHAN": "05",
       "COMPETITION": "06", "MARKET": "06", "BUSINESS": "06", "IMPACT": "06", "TEAM": "06"}
out = []
for n, slide in enumerate(prs.slides, 1):
    tag = ""
    for sh in slide.shapes:
        if not sh.has_text_frame:
            continue
        t = sh.text_frame.text.strip()
        if PAGE.match(t):
            rewrite(sh, [f"{n} / {TOTAL}"])
            for para in sh.text_frame.paragraphs:
                para.alignment = PP_ALIGN.RIGHT
        m = SEC.match(t)
        if m:
            name = m.group(1).strip()
            if name in ACT:
                rewrite(sh, [f"{ACT[name]} / {name}"])
                tag = name
    out.append((n, tag))

prs.save(str(DST))
print("saved", DST.name, DST.stat().st_size)
print("order:", out)
