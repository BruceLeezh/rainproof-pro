# -*- coding: utf-8 -*-
"""答辩版第二轮改版：S7 加融合定位语、新增「刻意不做」与「治理机制」两页、页码全表重编。
运行：python 07-测试工具/deck-pass2.py
"""
import copy
import pathlib
import re

from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR

ROOT = pathlib.Path(__file__).resolve().parent.parent
DECK = ROOT / "01-参赛材料/交付物/PPT/雨证-路演PPT-答辩版-2026-10-28.pptx"
CN = "微软雅黑"
MONO = "Consolas"
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
CYAN = RGBColor(0x22, 0xD3, 0xEE)
SOFT = RGBColor(0xC7, 0xD2, 0xE5)

prs = Presentation(str(DECK))
TEMPLATE = prs.slides[13]


def add_text(slide, x, y, w, h, text, size=10.5, color=WHITE, bold=False, font=CN, align=None, spacing=None):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = 0
    tf.margin_top = tf.margin_bottom = 0
    lines = text.split("\n")
    for i, line in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        if align:
            p.alignment = align
        if spacing:
            p.space_after = Pt(spacing)
        r = p.add_run()
        r.text = line
        r.font.size = Pt(size)
        r.font.color.rgb = color
        r.font.bold = bold
        r.font.name = font
    return box


def new_slide(after_index, kicker, title, subtitle, section):
    s = prs.slides.add_slide(prs.slide_layouts[0])
    for shp in TEMPLATE.shapes:
        if shp.name in ("Rectangle 1", "Rectangle 2"):
            s.shapes._spTree.append(copy.deepcopy(shp._element))
    add_text(s, 1.00, 0.40, 10.60, 0.52, title, 27, WHITE, True)
    add_text(s, 1.00, 1.04, 9.40, 0.24, subtitle, 12, WHITE, False, MONO)
    add_text(s, 9.30, 0.61, 3.03, 0.22, section, 12, WHITE, False, MONO)
    add_text(s, 0.75, 1.50, 11.80, 0.20, kicker, 10.5, CYAN, False, MONO)
    add_text(s, 11.10, 6.99, 1.60, 0.20, "0 / 0", 11.25, WHITE, False, MONO)
    return s


def three_columns(slide, items, top=1.92, bottom_line=None, body_top=3.30):
    xs = [0.75, 4.74, 8.73]
    for i, (num, tag, head, body) in enumerate(items):
        x = xs[i]
        add_text(slide, x, top, 0.44, 0.24, num, 11, CYAN, False, MONO)
        add_text(slide, x + 0.48, top + 0.02, 1.30, 0.22, tag, 9.5, WHITE, False, MONO)
        add_text(slide, x, top + 0.36, 3.62, 0.62, head, 19, WHITE, True)
        line = slide.shapes.add_shape(1, Inches(x), Inches(top + 1.14), Inches(3.62), Pt(1))
        line.fill.solid()
        line.fill.fore_color.rgb = CYAN
        line.line.fill.background()
        add_text(slide, x, body_top, 3.62, 1.55, body, 11, SOFT)
    if bottom_line:
        add_text(slide, 0.75, 5.86, 11.83, 0.80, bottom_line, 12.5, WHITE)


# ---------- 1) S7 追加融合定位语 ----------
s7 = prs.slides[6]
add_text(s7, 0.75, 6.32, 11.83, 0.46,
         "一句话　不是再卖一张保险，是给城市新业态装一层可审计的收入防雨层 —— 让每一场雨都有价签，让雨天不必再拿命赶时间。",
         13, CYAN, True)

# ---------- 2) 新页：我们刻意不做的事（插在 S18 之后） ----------
p_dont = new_slide(
    18,
    "COMPETITION · 三件刻意不做的事，比做什么更能说明定位",
    "我们刻意不做的事",
    "Three things we deliberately do not do",
    "05 / COMPETITION",
)
three_columns(p_dont, [
    ("01", "产品边界", "不做综合意外",
     "低频、必须人工查勘 —— 参数化机制覆盖不了；做了就退回「卖一单亏一单」的成本结构。"),
    ("02", "定价边界", "不做 UBI 行为定价",
     "行为数据拿不到、也验不了真。把不可验证的维度写进条款，等于没定价。"),
    ("03", "品类边界", "不做多险种",
     "分散会让 244 格精算与三模型验真失焦。专耕降雨，才做得到零人工与可复算。"),
], bottom_line="取舍的代价是市场看起来更小；回报是每一格价格都站得住 —— 这也是我们敢把定价公式、原始数据与门禁全部公开的原因。")

# ---------- 3) 新页：治理机制（插在原 S25 之后，即索引 25） ----------
p_gov = new_slide(
    26,
    "GOVERNANCE · 三层机制，让它嵌得进城市新业态治理",
    "不是再卖一张保险，是一层可审计的收入防雨层",
    "From commercial product to a quasi-public protection layer",
    "05 / GOVERNANCE",
)
three_columns(p_gov, [
    ("01", "谁出钱", "共同分摊",
     "平台 70% / 骑手 20% / 公益或财政 10%（示例比例）：平台份额走 buyFor 每日代付，骑手份额平台月结，补贴份额留政策接口。"),
    ("02", "什么时候停", "分级响应",
     "预警级只停 toC 新投保、toB 签发照常；灾难级全停新单，已生效保单照常判赔 —— 治理动作写进运营手册，不靠临场决定。"),
    ("03", "凭什么被信任", "可审计",
     "2/3 多签 + 每笔操作留依据哈希 + 单文件核验台零依赖 —— 公共资金进来也查得清、复算得出。"),
], bottom_line="双重正外部性（设计目标，不是已测效果）：雨天收入有保障 → 不必拿命冲单 → 超速与闯灯激励下降。")

# ---------- 4) 排序：新页移到目标位置 ----------
sldIdLst = prs.slides._sldIdLst
ids = list(sldIdLst)
by_id = {el.get("id"): el for el in ids}
dont_id = p_dont.slide_id
gov_id = p_gov.slide_id
for el in ids:
    if el.get("id") in (str(dont_id), str(gov_id)):
        sldIdLst.remove(el)
# 先插 gov（原 S25 之后 → 索引 25），再插 dont（S18 之后 → 索引 18），顺序无关但需按索引升序插
sldIdLst.insert(18, by_id[str(dont_id)])
sldIdLst.insert(26, by_id[str(gov_id)])

# ---------- 5) 页码全表重编 ----------
total = len(prs.slides)
pat = re.compile(r"^\d+\s*/\s*\d+$")
for idx, slide in enumerate(prs.slides, start=1):
    for shp in slide.shapes:
        if not shp.has_text_frame:
            continue
        t = shp.text_frame.text.strip()
        if pat.match(t):
            p0 = shp.text_frame.paragraphs[0]
            if p0.runs:
                p0.runs[0].text = f"{idx} / {total}"
                for r in p0.runs[1:]:
                    r.text = ""

# ---------- 6) 修武汉两页说明行在深色底上的对比度 ----------
for slide in prs.slides:
    for shp in slide.shapes:
        if not shp.has_text_frame:
            continue
        t = shp.text_frame.text.strip()
        if t.startswith("汉南临江") or t.startswith("1 月全城"):
            for para in shp.text_frame.paragraphs:
                for r in para.runs:
                    r.font.color.rgb = SOFT
                    r.font.size = Pt(11)

prs.save(str(DECK))
print(f"done: {len(prs.slides)} slides")
for i, s in enumerate(prs.slides, 1):
    ts = [sh.text_frame.text.strip().split("\n")[0] for sh in s.shapes if sh.has_text_frame and sh.text_frame.text.strip()]
    if i in (7, 19, 26, 27, 28):
        print(f"  S{i}: {ts[0][:38]}")
