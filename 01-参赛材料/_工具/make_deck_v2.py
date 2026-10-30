# -*- coding: utf-8 -*-
"""
雨证 RainProof · 正式提交版路演 PPT 生成器
视觉体系对齐 提交材料/神麻组-雨证-路演PPT1.pptx：
  底色 0A1422 / 主蓝 2D7FF9 / 青 22D3EE / 琥珀 F5A524 / 白
  中文 微软雅黑 · 数字与英文标签 Consolas
  左上竖向渐变装饰条 · 左上中文大标题 · 其上英文副标题 · 右上章节标签 · 右下 NN / TOTAL
运行：python make_deck_v2.py
"""
import os
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from pptx.oxml.ns import qn
import copy

# ---------- 设计令牌 ----------
BG      = RGBColor(0x0A, 0x14, 0x22)
INK     = RGBColor(0xFF, 0xFF, 0xFF)
INK2    = RGBColor(0xB4, 0xC2, 0xD2)
INK3    = RGBColor(0x74, 0x86, 0x9B)
BLUE    = RGBColor(0x2D, 0x7F, 0xF9)
CYAN    = RGBColor(0x22, 0xD3, 0xEE)
AMBER   = RGBColor(0xF5, 0xA5, 0x24)
GREEN   = RGBColor(0x35, 0xD0, 0x9A)
RED     = RGBColor(0xEF, 0x6E, 0x5B)
CARD    = RGBColor(0x12, 0x1E, 0x2F)
CARD2   = RGBColor(0x18, 0x27, 0x3B)
LINE    = RGBColor(0x24, 0x35, 0x4C)

CN = "微软雅黑"
MONO = "Consolas"

W, H = 13.333, 7.5
MARGIN = 0.75
TOTAL = 16

prs = Presentation()
prs.slide_width = Inches(W)
prs.slide_height = Inches(H)
BLANK = prs.slide_layouts[6]

_state = {"n": 0}


def _no_autofit(tf):
    bodyPr = tf._txBody.find(qn('a:bodyPr'))
    for tag in ('a:normAutofit', 'a:spAutoFit', 'a:noAutofit'):
        el = bodyPr.find(qn(tag))
        if el is not None:
            bodyPr.remove(el)
    from lxml import etree
    bodyPr.append(etree.SubElement(bodyPr, qn('a:noAutofit')))


def text(sl, x, y, w, h, s, size=14, color=INK, bold=False, font=CN,
         align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, spacing=1.0, cs=0):
    """单段或多段文本。s 可为 str 或 [(text, dict)] 段落列表。"""
    tb = sl.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    _no_autofit(tf)
    paras = s if isinstance(s, list) else [s]
    for i, p in enumerate(paras):
        para = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        para.alignment = align
        para.line_spacing = spacing
        runs = p if isinstance(p, list) else [(p, {})]
        for rt, ropt in runs:
            r = para.add_run()
            r.text = rt
            r.font.size = Pt(ropt.get("size", size))
            r.font.bold = ropt.get("bold", bold)
            r.font.name = ropt.get("font", font)
            r.font.color.rgb = ropt.get("color", color)
            if ropt.get("cs", cs):
                r.font._rPr.set('spc', str(int(ropt.get("cs", cs) * 100)))
    return tb


def rect(sl, x, y, w, h, fill=CARD, line=None, lw=1.0, radius=None, shape=None):
    if shape is None:
        shape = MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE
    sp = sl.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
    if radius:
        try:
            sp.adjustments[0] = radius
        except Exception:
            pass
    if fill is None:
        sp.fill.background()
    else:
        sp.fill.solid()
        sp.fill.fore_color.rgb = fill
    if line is None:
        sp.line.fill.background()
    else:
        sp.line.color.rgb = line
        sp.line.width = Pt(lw)
    sp.shadow.inherit = False
    sp.text_frame.word_wrap = True
    return sp


def hline(sl, x, y, w, color=LINE, h=0.012):
    return rect(sl, x, y, w, h, fill=color)


def slide():
    sl = prs.slides.add_slide(BLANK)
    _state["n"] += 1

    rect(sl, 0, 0, W, H, fill=BG)
    # 左上竖向渐变装饰条（对齐参考稿）
    bar = rect(sl, MARGIN, 0.573, 0.042, 0.312, fill=BLUE)
    bar.fill.gradient()
    bar.fill.gradient_stops[0].color.rgb = BLUE
    bar.fill.gradient_stops[0].position = 0.0
    bar.fill.gradient_stops[1].color.rgb = CYAN
    bar.fill.gradient_stops[1].position = 1.0
    try:
        bar.fill.gradient_angle = 90.0
    except Exception:
        pass

    # 页码
    text(sl, 11.75, 6.99, 0.9, 0.22, "%02d / %d" % (_state["n"], TOTAL),
         size=11.25, color=INK3, font=MONO, align=PP_ALIGN.RIGHT)
    return sl


def head(sl, title, en, section):
    """左上中文大标题 + 其上英文副标题 + 右上章节标签"""
    if en:
        text(sl, MARGIN, 0.42, 8.42, 0.26, en, size=12, color=INK3, font=MONO)
    text(sl, MARGIN, 0.72, 9.6, 0.62, title, size=27, color=INK, bold=True)
    if section:
        text(sl, 9.35, 0.42, 3.25, 0.26, section, size=12, color=INK3,
             font=MONO, align=PP_ALIGN.RIGHT, cs=0.05)


def notes(sl, s):
    sl.notes_slide.notes_text_frame.text = s


def bullets(sl, x, y, w, items, size=13.5, gap=0.44, color=INK2, dot=CYAN):
    for i, it in enumerate(items):
        yy = y + i * gap
        rect(sl, x, yy + 0.075, 0.075, 0.075, fill=dot, shape=MSO_SHAPE.OVAL)
        text(sl, x + 0.19, yy, w - 0.19, gap, it, size=size, color=color)


def card(sl, x, y, w, h, kicker=None, value=None, unit=None, note=None,
         vcolor=INK, fill=CARD, border=LINE, vsize=28.5, kcolor=INK3):
    rect(sl, x, y, w, h, fill=fill, line=border, radius=0.06)
    cy = y + 0.18
    if kicker:
        text(sl, x + 0.22, cy, w - 0.44, 0.22, kicker, size=10.5, color=kcolor, font=MONO, cs=0.04)
        cy += 0.28
    if value is not None:
        runs = [(value, {"size": vsize, "bold": True, "color": vcolor, "font": MONO})]
        if unit:
            runs.append((" " + unit, {"size": 12, "color": INK3, "font": CN}))
        text(sl, x + 0.22, cy, w - 0.40, 0.55, [runs], spacing=1.0)
        cy += 0.54
    if note:
        text(sl, x + 0.22, cy, w - 0.44, max(0.24, h - (cy - y) - 0.10), note,
             size=10.5, color=INK3, spacing=1.35)


# ============================ 01 封面 ============================
sl = slide()
rect(sl, 0, 0, W, H, fill=BG)
for i in range(46):  # 雨丝
    xx = 0.12 + i * 0.29
    ln = rect(sl, xx, 0.0 + (i % 7) * 0.42, 0.006, 1.15 + (i % 5) * 0.55, fill=RGBColor(0x16, 0x28, 0x3E))
bar = rect(sl, MARGIN, 1.55, 0.055, 0.42, fill=CYAN)
bar.fill.gradient()
bar.fill.gradient_stops[0].color.rgb = CYAN
bar.fill.gradient_stops[1].color.rgb = BLUE
text(sl, MARGIN, 1.05, 8.0, 0.30, "2026 大学生保险模拟创业大赛 · 保险科技应用赛道",
     size=12.5, color=INK3, font=MONO, cs=0.03)
text(sl, MARGIN, 1.75, 9.4, 1.15, "雨证 · RainProof", size=54, color=INK, bold=True)
text(sl, MARGIN, 2.95, 9.4, 0.55, "可复算的参数化降雨保障", size=26, color=CYAN, bold=True)
text(sl, MARGIN, 3.68, 9.4, 0.34, "Parametric rain cover for delivery riders — verifiable by anyone",
     size=12.5, color=INK3, font=MONO)
hline(sl, MARGIN, 4.20, 6.2, color=LINE)
text(sl, MARGIN, 4.40, 7.4, 0.42, [[("把「你信不信我」换成「你自己验」", {"size": 19, "bold": True, "color": INK})]])
text(sl, MARGIN, 5.28, 8.2, 0.34, "不核灾 · 不定损 · 骑手不举证",
     size=13.5, color=INK2, font=CN)
text(sl, MARGIN, 5.75, 9.0, 0.60,
     "降雨越过合约档线即触发，判定与证据全部留痕，任何第三方可用同一份原始数据复算出同一个结论。",
     size=13, color=INK3, spacing=1.5)
text(sl, 9.55, 6.62, 3.05, 0.26, "TEAM  【待填队名】", size=12, color=INK3, font=MONO, align=PP_ALIGN.RIGHT)
notes(sl, "开场 30 秒只讲人，不讲技术。一句话定义：骑手雨天没收入，我们让降雨量本身成为理赔依据。")

# ============================ 02 目录 ============================
sl = slide()
head(sl, "这 16 页讲什么", "WHAT THIS DECK COVERS", "00 / CONTENTS")
toc = [
    ("P03", "一个骑手的雨天", "为什么这个需求真实存在"),
    ("P04", "为什么没人做这笔生意", "成本结构决定的下游三件事"),
    ("P05", "把定损换成一个公开数字", "产品形态与两档赔付"),
    ("P07", "你已经可以自己验一遍", "链上证据与 8 条断言"),
    ("P08", "11 年逐小时精算", "六城触发率与 40 格费率"),
    ("P10", "谁为这笔钱付账", "B2B2C 双轨与单位经济"),
    ("P12", "市场、边界与路线图", "主动交代我们还没做到的事"),
]
for i, (no, t, d) in enumerate(toc):
    col = i // 4
    row = i % 4
    x = MARGIN + col * 6.05
    y = 1.62 + row * 1.18
    text(sl, x, y + 0.02, 0.66, 0.30, no, size=13, color=CYAN, bold=True, font=MONO, cs=0.02)
    text(sl, x + 0.74, y - 0.02, 4.75, 0.34, t, size=16.5, color=INK, bold=True)
    text(sl, x + 0.74, y + 0.33, 4.75, 0.28, d, size=11.5, color=INK3)
text(sl, MARGIN + 6.05, 1.62 + 3 * 1.18, 5.4, 0.9,
     "读法：每一页都有一句可以当场验证的话。\n不要求您相信任何数字，只要求您相信您自己点出来的结果。",
     size=12, color=INK3, spacing=1.5)
notes(sl, "目录页用一句话交代读法：这叠 PPT 的每一页都带着可现场验证的入口。")

# ============================ 03 一个骑手的雨天 ============================
sl = slide()
head(sl, "那天，他还是出门了", "THAT DAY, HE STILL WENT OUT", "01 / THE RIDER")
text(sl, MARGIN, 1.62, 7.1, 0.72,
     "暴雨橙色预警。他穿上雨衣，骑上车，跑了 12 个小时 —— 因为当天不出勤，就没有收入。",
     size=15.75, color=INK, spacing=1.45)
card(sl, MARGIN, 2.62, 2.65, 1.28, "被覆盖的骑手规模", "300", "万人", "美团 2025-06-26 官方口径", vcolor=BLUE, vsize=27)
card(sl, MARGIN + 2.83, 2.62, 2.65, 1.28, "暴雨日收入", "-30", "%", "公开口径有分歧，仅作量级参考", vcolor=AMBER, vsize=27)
card(sl, MARGIN + 5.66, 2.62, 2.65, 1.28, "他能拿到的赔偿", "0", "元", "没有产品可买，也不知道找谁", vcolor=AMBER, vsize=27)
text(sl, MARGIN, 4.20, 8.3, 0.44, "而他不知道该找谁赔。", size=22.5, color=INK, bold=True)
hline(sl, MARGIN, 4.86, 8.3, color=LINE)
text(sl, MARGIN, 5.06, 8.30, 1.5,
     "这不是「保险太贵」的问题，也不是「骑手不想买」的问题。\n是一笔账在当前的成本结构下算不过来 —— 下一页只讲这一件事。",
     size=13.5, color=INK2, spacing=1.6)
text(sl, 9.55, 1.62, 3.05, 2.2,
     [[("12", {"size": 40, "bold": True, "color": CYAN, "font": MONO})],
      [("小时", {"size": 13, "color": INK3})],
      [("", {"size": 8})],
      [("暴雨日连续骑行时长（个例，非均值）", {"size": 11, "color": INK3})]],
     spacing=1.15)
notes(sl, "先讲人：不讲产品、不讲技术。让评委在情绪上先站到骑手这一边，后面所有成本讨论才有意义。")

# ============================ 04 为什么没人做 ============================
sl = slide()
head(sl, "不是没人想保，是这笔账算不过来", "NOT THAT NOBODY WANTS TO — THE MATH DOESN'T WORK", "02 / THE MATH")
text(sl, MARGIN, 1.58, 5.1, 0.52, "查一次的成本", size=17, color=INK, bold=True)
text(sl, MARGIN + 5.25, 1.50, 0.6, 0.6, "≈", size=30, color=INK3, font=MONO)
text(sl, MARGIN + 6.0, 1.58, 5.1, 0.52, "赔一次的钱", size=17, color=AMBER, bold=True)
bullets(sl, MARGIN, 2.52, 7.6, [
    "单次赔款量级：几十到几百元 —— 客单价极低，容不下任何人工环节",
    "人工报案 + 查勘 + 核赔的固定成本，与赔款本身同量级",
    "于是保险公司的理性选择是：不卖这个人群的天气险",
], size=13.5, gap=0.52)
rect(sl, MARGIN, 5.40, 7.6, 1.32, fill=CARD, line=LINE, radius=0.05)
text(sl, MARGIN + 0.28, 5.58, 7.0, 0.28, "下游的三个结果", size=12.5, color=CYAN, bold=True, font=MONO, cs=0.03)
text(sl, MARGIN + 0.28, 5.94, 7.0, 0.62,
     "损失核不了 · 逆选择与骗赔 · 身份无正式凭据 —— 都是这个成本结构的下游，不是三个独立的问题。",
     size=12, color=INK2, spacing=1.4)
card(sl, 8.82, 2.52, 3.78, 1.42, "雨天配送事故率", "6.8", "×", "泰国骑手交通事故研究，OR = 6.79", vcolor=BLUE, vsize=30)
card(sl, 8.82, 4.15, 3.78, 1.52, "一笔保单的定价区间", "1.1–8.8", "元 / 份", "40 格全表区间：平台批发 1.1–2.2、骑手自付 3.6–8.8（见第 9 页）", vcolor=CYAN, vsize=26)
text(sl, 8.82, 5.78, 3.78, 0.9,
     "低客单 + 高定损成本\n= 这个人群长期没有可买的天气险。",
     size=11.5, color=INK3, spacing=1.5)
notes(sl, "核心论证：不是需求不存在，是成本结构不允许。这样后面「去掉定损环节」就不是取巧，而是唯一解。")

# ============================ 05 转念 ============================
sl = slide()
head(sl, "所以我们根本不问「你损失了多少」", "SO WE NEVER ASK HOW MUCH YOU LOST", "03 / THE TURN")
rect(sl, MARGIN, 1.55, 11.83, 1.02, fill=CARD2, line=None, radius=0.05)
text(sl, MARGIN + 0.34, 1.83, 11.1, 0.5, "只看一个公开数字：保单期内，这个区域下了多少雨。",
     size=20, color=INK, bold=True)
steps = [
    ("STEP 01", "锁定基线", "投保那一刻，把该区域链上累计降雨记录成基线。已经下过的雨，增量永远是 0。"),
    ("STEP 02", "三源交叉", "ECMWF / GFS / ICON 三家模型各自累计，离散度超过容差就拒收，拒收也留链上事件。"),
    ("STEP 03", "确定性判定", "增量对比国标档线，规则 R1–R5 逐条判定；大模型只写解释文字，不进哈希、不改结论。"),
    ("STEP 04", "任意人可结算", "判定上链后，任何人用任意地址都能触发打款，钱只会进保单登记的骑手地址。"),
]
for i, (k, t, d) in enumerate(steps):
    x = MARGIN + i * 2.99
    rect(sl, x, 2.92, 2.78, 2.28, fill=CARD, line=LINE, radius=0.06)
    text(sl, x + 0.24, 3.14, 2.3, 0.24, k, size=10.5, color=CYAN, font=MONO, cs=0.08)
    text(sl, x + 0.24, 3.46, 2.3, 0.32, t, size=15, color=INK, bold=True)
    text(sl, x + 0.24, 3.86, 2.32, 1.18, d, size=10.5, color=INK2, spacing=1.45)
rect(sl, MARGIN, 5.52, 11.83, 1.28, fill=None, line=BLUE, radius=0.05, lw=1.2)
text(sl, MARGIN + 0.34, 5.72, 11.1, 0.28, "换来的三件事", size=12, color=CYAN, bold=True, font=MONO, cs=0.03)
text(sl, MARGIN + 0.34, 6.06, 11.1, 0.56,
     "免人工定损 · 骑手不用举证 · 结论可被任何第三方用同一份原始数据复算出来",
     size=15, color=INK, bold=True)
notes(sl, "这一页是全场的转折：把「查损失」换掉。四步都可在现场演示里走完。")

# ============================ 06 产品 ============================
sl = slide()
head(sl, "一张保单长什么样", "WHAT A POLICY LOOKS LIKE", "04 / THE PRODUCT")
rows = [
    ("保障对象", "外卖／即时配送骑手（可由平台代付）"),
    ("窗口", "12 小时 / 24 小时（对齐国标两个时段）"),
    ("档线", "12h：≥30mm 赔 50%、≥70mm 赔 75%　·　24h：≥50mm 赔 50%、≥100mm 赔 75%"),
    ("满额赔付", "最高实赔 75 元（基数 100 元）"),
    ("价格", "骑手自付 3.6–8.8 元／份；平台团体批发 1.1–2.2 元／份（义乌无历史样本，按兜底价 10 元）"),
    ("不做", "特大暴雨档 —— 样本不足，定不出可信的价"),
]
for i, (k, v) in enumerate(rows):
    y = 1.62 + i * 0.66
    rect(sl, MARGIN, y, 7.55, 0.56, fill=(CARD if i % 2 == 0 else None), line=None, radius=0.04)
    text(sl, MARGIN + 0.22, y + 0.14, 1.45, 0.28, k, size=11.5, color=CYAN, font=MONO, cs=0.02)
    text(sl, MARGIN + 1.75, y + 0.11, 5.62, 0.40, v, size=12, color=INK2, spacing=1.25)
text(sl, MARGIN, 5.66, 7.55, 1.15,
     "赔付额是定值，不是实际损失 —— 这是参数化保险的固有代价，也是它能把定损成本降到零的原因。\n"
     "所以我们把它定位成「收入中断补偿」，而不是「损失补偿」。",
     size=11.5, color=INK3, spacing=1.5)
card(sl, 8.86, 1.62, 3.74, 1.30, "12h 档线", "30 / 70", "mm", "国标暴雨 → 大暴雨", vcolor=CYAN, vsize=24)
card(sl, 8.86, 3.05, 3.74, 1.30, "24h 档线", "50 / 100", "mm", "国标暴雨 → 大暴雨", vcolor=CYAN, vsize=24)
card(sl, 8.86, 4.48, 3.74, 1.30, "赔付比例", "50 / 75", "%", "按命中档线比例给付", vcolor=AMBER, vsize=24)
text(sl, 8.86, 5.94, 3.74, 0.9, "依据 GB/T 28592—2012：暴雨 = 12h 30.0–69.9mm 或 24h 50.0–99.9mm。",
     size=10, color=INK3, spacing=1.45)
notes(sl, "产品形态一页讲完。强调「不做特大暴雨档」是主动的诚实动作，不是能力不足。")

# ============================ 07 证据 ============================
sl = slide()
head(sl, "不用信这份 PPT，自己点一遍", "DO NOT TRUST THIS DECK — CLICK THROUGH IT YOURSELF", "05 / EVIDENCE")
text(sl, MARGIN, 1.55, 7.5, 0.30, "核验台 · 8 条断言逐条自证", size=13, color=CYAN, bold=True, font=MONO, cs=0.03)
asserts = [
    "链号 = 968（不是随便哪条链都算数）",
    "合约地址上确实有字节码（19,841 字节运行时）",
    "治理在 2/3 多签手里，合约未暂停",
    "冷却期 = 0 秒（演示窗口内可跑完）",
    "6 个民政部区划码全部处于可用状态",
    "武汉 84mm 的链上哈希 = 原始报文现算 SHA-256",
    "保单 #0：被保险人 ≠ 付款人，阈值 30mm、基线 172mm",
    "台账逐分等于链上资金池（4958.40 元）",
]
for i, a in enumerate(asserts):
    y = 1.98 + i * 0.50
    rect(sl, MARGIN, y, 0.20, 0.20, fill=GREEN, shape=MSO_SHAPE.OVAL)
    text(sl, MARGIN + 0.05, y + 0.03, 0.14, 0.18, "✓", size=10, color=BG, bold=True, align=PP_ALIGN.CENTER)
    text(sl, MARGIN + 0.34, y - 0.02, 7.0, 0.30, a, size=12, color=INK2)
rect(sl, 8.62, 1.55, 3.98, 2.30, fill=CARD, line=LINE, radius=0.06)
text(sl, 8.88, 1.76, 3.5, 0.26, "两票制 · 21 小时真实运行", size=11, color=INK3, font=MONO, cs=0.02)
text(sl, 8.88, 2.10, 3.5, 0.60, "2 / 3", size=40, color=BLUE, bold=True, font=MONO)
text(sl, 8.88, 2.74, 3.5, 0.90, "喂价、判定、调参全部要两把钥匙；单一私钥写不进任何一条值。",
     size=11, color=INK2, spacing=1.45)
rect(sl, 8.62, 4.02, 3.98, 2.30, fill=CARD, line=LINE, radius=0.06)
text(sl, 8.88, 4.23, 3.5, 0.26, "源码 ↔ 产物 ↔ 链上", size=11, color=INK3, font=MONO, cs=0.02)
text(sl, 8.88, 4.57, 3.5, 0.60, "0 字节", size=40, color=GREEN, bold=True, font=MONO)
text(sl, 8.88, 5.21, 3.5, 0.95, "现场编译的字节码与部署文件逐字节相同；链上运行时代码只差构造函数写入的地址常量。",
     size=11, color=INK2, spacing=1.45)
notes(sl, "评委最该点的一页。现场打开核验台，8 条全绿；断网时至少展示已存证的截图。")

# ============================ 08 精算 ============================
sl = slide()
head(sl, "统一定价是错的", "FLAT PRICING IS WRONG", "06 / ACTUARY")
text(sl, MARGIN, 1.55, 7.4, 0.28, "11 年 · 每城 96,432 小时 · 24h 档条件触发率", size=12, color=INK3, font=MONO)
cities = [("武汉", 4.18, RED), ("成都", 3.99, AMBER), ("广州", 3.81, AMBER),
          ("上海", 2.64, BLUE), ("北京", 2.49, BLUE)]
base_y, max_v, bar_max = 4.48, 5.0, 2.42
for i, (name, v, col) in enumerate(cities):
    x = MARGIN + 0.30 + i * 1.44
    hgt = v / max_v * bar_max
    rect(sl, x, base_y - hgt, 0.86, hgt, fill=col, radius=0.03)
    text(sl, x - 0.16, base_y - hgt - 0.34, 1.2, 0.28, "%.2f%%" % v, size=13, color=col,
         bold=True, font=MONO, align=PP_ALIGN.CENTER)
    text(sl, x - 0.16, base_y + 0.10, 1.2, 0.26, name, size=12, color=INK2, align=PP_ALIGN.CENTER)
hline(sl, MARGIN + 0.10, base_y, 7.35, color=LINE, h=0.014)
text(sl, MARGIN, 4.92, 7.4, 0.95,
     "最高与最低相差 1.68 倍。统一价意味着必然有一半城市收错钱：\n收多了骑手不买，收少了池子亏穿。",
     size=12, color=INK2, spacing=1.55)
card(sl, 8.75, 1.55, 3.85, 1.55, "回测口径", "96,432", "小时/城", "2014–2025，逐小时，六城同源", vcolor=CYAN, vsize=25)
card(sl, 8.75, 3.28, 3.85, 1.55, "档位加权", "2 档", "×2 窗口", "50% / 75% 按命中档线加权，不是单点概率", vcolor=BLUE, vsize=25)
text(sl, 8.75, 5.02, 3.85, 1.75,
     "注意口径：这里说的是「按档位加权的条件触发率」。\n若只看单点 ≥50mm 的无条件概率，武汉 0.41%、广州 0.74% —— 两者差 5–12 倍，不能混用。",
     size=10, color=INK3, spacing=1.5)
notes(sl, "专业深度的一页。被追问概率时，先问对方要哪个口径：单点还是档位加权。")

# ============================ 09 定价 ============================
sl = slide()
head(sl, "价格是算出来的，不是拍的", "PRICES ARE DERIVED, NOT GUESSED", "07 / PRICING")
rect(sl, MARGIN, 1.55, 11.83, 0.92, fill=CARD2, line=None, radius=0.05)
text(sl, MARGIN + 0.32, 1.78, 11.1, 0.46,
     [[("保费 = 上整", {"size": 15, "color": INK})],
      [("(  触发概率上界 × 赔付额 + 固定成本  )  ÷  赔付率上限 60%", {"size": 15, "color": CYAN, "font": MONO, "bold": True})]],
     spacing=1.0)
tbl = [
    ["城市", "12h 自付", "24h 自付", "24h 平台批发"],
    ["武汉", "5.9", "8.8", "2.2"],
    ["上海", "4.2", "5.3", "1.9"],
    ["北京", "3.6", "5.1", "1.8"],
    ["广州", "5.9", "7.9", "2.2"],
    ["成都", "5.8", "8.2", "2.1"],
    ["义乌", "10.0", "10.0", "10.0"],
]
tx, ty, rh = MARGIN, 2.72, 0.42
colw = [1.55, 2.05, 2.05, 2.35]
xx = tx
for j, h in enumerate(tbl[0]):
    text(sl, xx + 0.10, ty, colw[j] - 0.1, 0.26, h, size=10.5, color=INK3, font=MONO, cs=0.02)
    xx += colw[j]
hline(sl, tx, ty + 0.30, sum(colw), color=LINE)
for i, row in enumerate(tbl[1:]):
    yy = ty + 0.38 + i * rh
    if i % 2 == 0:
        rect(sl, tx, yy - 0.06, sum(colw), rh - 0.04, fill=CARD, line=None, radius=0.03)
    xx = tx
    for j, v in enumerate(row):
        col = INK2 if j == 0 else (AMBER if (v == "10.0" and i == 5) else (CYAN if j == 1 else INK))
        text(sl, xx + 0.10, yy, colw[j] - 0.1, 0.28, v + (" 元" if j else ""),
             size=12 if j == 0 else 13, color=col, bold=(j > 0), font=(CN if j == 0 else MONO))
        xx += colw[j]
hline(sl, tx, ty + 0.38 + 6 * rh - 0.08, sum(colw), color=LINE)
text(sl, tx, 5.60, 7.6, 1.20,
     "义乌的 10.0 元不是定价，是兜底价：该区还没有精算网格（`premiumGrid` 返回 0），合约回落到默认值。\n"
     "把它挂出来是为了证明民政部区划码能下沉到县级市 —— 定价要等 11 年数据补齐。",
     size=10.5, color=INK3, spacing=1.5)
rect(sl, 8.85, 2.72, 3.73, 1.32, fill=CARD, line=LINE, radius=0.06)
text(sl, 9.08, 2.92, 3.3, 0.24, "60% 是上限，不是目标", size=11, color=CYAN, bold=True, font=MONO, cs=0.02)
text(sl, 9.08, 3.22, 3.3, 0.70, "约束「上行赔付率 ≤ 0.6」；实际期望赔付只占 34%（下一页）。",
     size=10.5, color=INK2, spacing=1.45)
rect(sl, 8.85, 4.22, 3.73, 1.32, fill=CARD, line=LINE, radius=0.06)
text(sl, 9.08, 4.42, 3.3, 0.24, "逐格可复算", size=11, color=CYAN, bold=True, font=MONO, cs=0.02)
text(sl, 9.08, 4.72, 3.3, 0.70, "广州 24h：(101 + 30) ÷ 0.6 = 218.3 → 220 分 = 2.2 元，与链上逐格相等。",
     size=10.5, color=INK2, spacing=1.45)
text(sl, 8.85, 5.72, 3.73, 1.0, "链上只固化自付价；平台批发价目前是商务条款，未写进合约（v6 才做）。",
     size=10, color=RED, spacing=1.5)
notes(sl, "被问「为什么不便宜」就指公式；被问「批发价怎么来」要直说还没进合约。")

# ============================ 10 单位经济 ============================
sl = slide()
head(sl, "一张 2.2 元的平台保单，钱去哪了", "WHERE EVERY YUAN OF A 2.2 YUAN POLICY GOES", "08 / UNIT ECONOMICS")
segs = [("期望赔付", 0.74, 34, AMBER), ("固定成本", 0.30, 14, INK3),
        ("再保", 0.33, 15, BLUE), ("渠道与运营", 0.55, 25, CYAN), ("毛利", 0.28, 12, GREEN)]
bx, by, bw, bh = MARGIN, 2.05, 7.9, 0.86
cx = bx
for name, amt, pct, col in segs:
    ww = bw * pct / 100.0
    rect(sl, cx, by, ww - 0.02, bh, fill=col, radius=0.04)
    text(sl, cx, by + 0.30, ww - 0.02, 0.28, "%d%%" % pct, size=13, color=BG, bold=True,
         font=MONO, align=PP_ALIGN.CENTER)
    cx += ww
for i, (name, amt, pct, col) in enumerate(segs):
    x = MARGIN + i * 1.60
    rect(sl, x, 3.10, 0.10, 0.10, fill=col, shape=MSO_SHAPE.OVAL)
    text(sl, x + 0.20, 3.02, 1.45, 0.26, name, size=11, color=INK2)
    text(sl, x, 3.42, 1.5, 0.30, "%.2f 元" % amt, size=13, color=col, bold=True, font=MONO)
text(sl, MARGIN, 1.62, 7.9, 0.28, "保费 2.20 元 = 100%", size=11.5, color=INK3, font=MONO)
hline(sl, MARGIN, 4.02, 7.9, color=LINE)
card(sl, MARGIN, 4.22, 2.52, 1.36, "期望赔付率", "34", "%", "收 100 赔 34，不是 60", vcolor=GREEN, vsize=28)
card(sl, MARGIN + 2.70, 4.22, 2.52, 1.36, "定损成本", "0", "元", "不查勘、不定损、不举证", vcolor=GREEN, vsize=28)
card(sl, MARGIN + 5.40, 4.22, 2.50, 1.36, "触发倍数", "2.6–6.7", "×", "条件触发率 vs 单点概率", vcolor=CYAN, vsize=22)
rect(sl, 8.85, 1.62, 3.73, 2.45, fill=CARD, line=LINE, radius=0.06)
text(sl, 9.08, 1.84, 3.3, 0.26, "和传统保险相反", size=11.5, color=CYAN, bold=True, font=MONO, cs=0.03)
text(sl, 9.08, 2.18, 3.32, 1.70,
     "传统保险的钱花在「查」：查勘、核赔、诉讼反欺诈。\n\n我们把这一整块换成一条链上判定，成本结构从人力密集变成算力加校验。",
     size=11, color=INK2, spacing=1.5)
text(sl, 8.85, 4.26, 3.73, 1.9,
     "口径说明：以广州 24h 平台批发价 2.2 元为例。\n赔付率为期望值，按 11 年回测的上界概率计算，不含极端年份尾部。",
     size=10, color=INK3, spacing=1.55)
notes(sl, "单位经济是最容易被追问的一页。34% 而不是 60% 是卖点：说明定价留了安全垫。")

# ============================ 11 谁付钱 ============================
sl = slide()
head(sl, "谁为这笔风险付账", "SO WHO PAYS FOR THIS RISK", "09 / BUSINESS MODEL")
text(sl, MARGIN, 1.58, 6.2, 0.72,
     [[("主路径：平台／众包服务商批量代付。", {"size": 17, "bold": True, "color": INK})],
      [("骑手自费是补充，不是主线。", {"size": 15, "color": INK2})]],
     spacing=1.35)
text(sl, MARGIN, 2.52, 6.2, 1.35,
     "单均 1–9 元，靠骑手逐单付费撑不起渠道成本；但平台一次决策就能覆盖成千上万骑手，边际获客成本趋近于零。\n\n"
     "更关键：暴雨天的运力缺口与事故舆情，本身就是平台必须花的钱。",
     size=12, color=INK2, spacing=1.55)
buyers = [
    ("骑手自付", "价格极敏感、获客成本高、单均太小", INK3, False),
    ("平台 / 众包服务商", "一次决策覆盖上万人，边际成本≈0", GREEN, True),
    ("保险公司", "我们输出定价与证据能力，做技术方", BLUE, False),
]
for i, (t, d, col, rec) in enumerate(buyers):
    y = 4.24 + i * 0.86
    rect(sl, MARGIN, y, 6.2, 0.74, fill=CARD if rec else None, line=(col if rec else LINE), radius=0.05)
    text(sl, MARGIN + 0.24, y + 0.10, 2.35, 0.28, t, size=13, color=(INK if rec else INK2), bold=rec)
    text(sl, MARGIN + 2.72, y + 0.12, 2.55, 0.50, d, size=10.5, color=INK3, spacing=1.35)
    if rec:
        text(sl, MARGIN + 5.30, y + 0.10, 0.80, 0.26, "推荐", size=10, color=GREEN, bold=True,
             font=MONO, align=PP_ALIGN.RIGHT)
card(sl, 7.35, 1.58, 5.23, 1.62, "第二阶段", "技术输出", None,
     "把参数化定价、喂价验收、链上证据层卖给持牌保险公司 —— 我们不做承保主体。", vcolor=BLUE, vsize=24)
card(sl, 7.35, 3.40, 5.23, 1.62, "收费形态", "双轨", None,
     "平台按人头批量结算＋按保额分成；骑手端保留自费入口作为补充。", vcolor=CYAN, vsize=24)
text(sl, 7.35, 5.22, 5.23, 1.35,
     "为什么这条路径必须成立：我们不是持牌承保主体，也不打算是。\n没有平台这一层，产品在法理上更接近对赌而不是保险。",
     size=10.5, color=INK3, spacing=1.5)
notes(sl, "合规与商业模式压在一页。被问牌照：我们不卖保险，给持牌方提供技术与核验。")

# ============================ 12 市场 ============================
sl = slide()
head(sl, "市场不大，但足够养活一个技术服务商", "SMALL MARKET, BUT ENOUGH FOR A TECH VENDOR", "10 / MARKET")
levels = [("TAM", "19–26", "亿元", "全国灵活用工天气风险可保规模", BLUE, 7.25),
          ("SAM", "3.6", "亿元", "即时配送骑手 × 现有六城可触达", CYAN, 6.35),
          ("SOM", "1.1", "亿元", "三年内单区域渗透 30% 的可及规模", GREEN, 4.80)]
for i, (k, v, u, d, col, wid) in enumerate(levels):
    y = 1.72 + i * 1.30
    rect(sl, MARGIN, y, wid, 1.02, fill=CARD, line=col, radius=0.05, lw=1.2)
    text(sl, MARGIN + 0.26, y + 0.14, 0.7, 0.26, k, size=11.5, color=col, bold=True, font=MONO, cs=0.06)
    text(sl, MARGIN + 1.05, y + 0.10, 1.55, 0.44, v, size=25, color=INK, bold=True, font=MONO)
    text(sl, MARGIN + 2.62, y + 0.20, 0.7, 0.26, u, size=11, color=INK3)
    text(sl, MARGIN + 3.30, y + 0.20, 3.55, 0.30, d, size=10.5, color=INK3)
text(sl, MARGIN, 5.72, 7.5, 1.0,
     "我们把 TAM 写小一点：4.25 亿蓝领里，真正会被暴雨打断收入且能被参数化定价的，是即时配送这一小群人。\n"
     "把市场说大，是这个行业最容易犯的错。",
     size=10.5, color=INK3, spacing=1.55)
rect(sl, 8.85, 1.72, 3.73, 2.55, fill=CARD, line=LINE, radius=0.06)
text(sl, 9.08, 1.94, 3.3, 0.26, "政策口径", size=11, color=CYAN, bold=True, font=MONO, cs=0.03)
text(sl, 9.08, 2.28, 3.32, 1.85,
     "人社部发〔2025〕24 号：明确新就业形态劳动者职业伤害保障扩围。\n\n我们在这条政策链上，扮演的是「可核验的补偿工具」。",
     size=10.5, color=INK2, spacing=1.5)
rect(sl, 8.85, 4.46, 3.73, 1.55, fill=CARD, line=LINE, radius=0.06)
text(sl, 9.08, 4.66, 3.3, 0.26, "单骑手可服务规模", size=11, color=CYAN, bold=True, font=MONO, cs=0.03)
text(sl, 9.08, 5.00, 3.34, 1.05, "两种口径都给：只在暴雨日买 ≈ 53 元／人／年（12 天 × 2 单 × 2.2 元）；雨季常规投保 ≈ 140 元／人／年（100 天 × 1.4 元）。SOM 按后者算。",
     size=11, color=INK2, spacing=1.5)
notes(sl, "主动把 TAM 说小是加分项。评委见过太多「万亿市场」的 PPT。")

# ============================ 13 对比 ============================
sl = slide()
head(sl, "回到那个骑手", "BACK TO THAT RIDER", "11 / COMPARISON")
rows = [
    ("触发依据", "实际受伤与实际损失", "该区域链上累计降雨是否越过档线"),
    ("举证责任", "骑手报案 + 人工查勘定损", "无人报案，判定链上自证"),
    ("到账时间", "数天到数周", "判定上链后，任何人可立即触发"),
    ("单笔成本", "查勘成本与赔款同量级", "免人工定损；仍有数据与服务成本"),
    ("可否复核", "看保险公司的结论", "第三方用同一份原始数据重算"),
]
hx = [MARGIN, MARGIN + 2.62, MARGIN + 7.05]
text(sl, hx[0], 1.66, 2.4, 0.28, "对比维度", size=11, color=INK3, font=MONO, cs=0.03)
text(sl, hx[1], 1.66, 4.2, 0.28, "传统骑手意外险", size=11, color=INK3, font=MONO, cs=0.03)
text(sl, hx[2], 1.66, 4.6, 0.28, "雨证 · 参数化降雨保障", size=11, color=CYAN, font=MONO, cs=0.03)
hline(sl, MARGIN, 2.02, 11.83, color=LINE)
for i, (k, a, b) in enumerate(rows):
    y = 2.18 + i * 0.80
    rect(sl, MARGIN, y - 0.06, 11.83, 0.70, fill=(CARD if i % 2 == 0 else None), line=None, radius=0.04)
    text(sl, hx[0], y + 0.10, 2.45, 0.30, k, size=12, color=CYAN, font=MONO, cs=0.02)
    text(sl, hx[1], y + 0.08, 4.25, 0.36, a, size=11.5, color=INK3, spacing=1.3)
    text(sl, hx[2], y + 0.08, 4.55, 0.40, b, size=11.5, color=INK, spacing=1.3)
text(sl, MARGIN, 6.24, 11.83, 0.34,
     "贵的不是赔付，是「查」。我们删掉的正是这一环 —— 代价是赔付额固定，不一定等于真实损失。",
     size=13, color=INK, bold=True)
notes(sl, "对比页放在最后三分之一，用来收束「删掉定损」这条主线，同时把代价说清楚。")

# ============================ 14 主动交代 ============================
sl = slide()
head(sl, "我们还没做到的四件事", "FOUR THINGS WE HAVE NOT SOLVED", "12 / HONEST GAPS")
gaps = [
    ("01", "身份与保险利益", "现在任何人付钱都能买（`eligibleRequired = false`）。缺这一层，产品在法理上更接近对赌。白名单机制已备好，赛期默认关闭。", RED),
    ("02", "基差风险", "用城市中心代表全市，郊区下雨、市区没下时判定与体感不一致。路线图是多站点加权，赛期不做。", AMBER),
    ("03", "赔付路径缺链上证据", "唯一一张保单的判定是 DENY（增量 0mm < 30mm）。投保→喂价→判定→上链四步都通了，但「判赔并到账」那一步还没有真链证据。", AMBER),
    ("04", "第三方安全审计", "没有审计。有的是 22 道自动化门禁、源码/产物/链上三重比对、operator 2/3 多签。", INK3),
]
for i, (no, t, d, col) in enumerate(gaps):
    y = 1.66 + i * 1.34
    rect(sl, MARGIN, y, 11.83, 1.18, fill=CARD, line=None, radius=0.05)
    rect(sl, MARGIN, y, 0.055, 1.18, fill=col, radius=0.02)
    text(sl, MARGIN + 0.34, y + 0.16, 0.55, 0.28, no, size=13, color=col, bold=True, font=MONO)
    text(sl, MARGIN + 0.95, y + 0.14, 3.1, 0.30, t, size=14, color=INK, bold=True)
    text(sl, MARGIN + 4.15, y + 0.14, 7.45, 0.92, d, size=11, color=INK2, spacing=1.45)
text(sl, MARGIN, 7.02, 10.55, 0.26,
     "这四条我们自己挂在墙上。答辩时被问到任何一条，都按这页答 —— 承认边界不是失分项，藏缺陷才是。",
     size=10.5, color=INK3)
notes(sl, "诚信页。放在路线图前面，先说没做到的，再说打算怎么做。这是答辩的加分页，不是减分页。")

# ============================ 15 路线图与团队 ============================
sl = slide()
head(sl, "接下来 12 个月", "THE NEXT TWELVE MONTHS", "13 / ROADMAP")
phases = [
    ("Q1", "合约 v6", "判定加窗口校验、定价参数真正生效、赔付链上留痕；完成第一笔「判赔→到账」。", CYAN),
    ("Q2", "合规收口", "接入平台身份 attestation，把「谁有资格买」从链上白名单落到平台侧。", BLUE),
    ("Q3", "扩城与多站点", "从 6 城扩到 15–20 城，同城多站点加权，压基差风险。", BLUE),
    ("Q4", "技术输出", "把定价与证据层打包给持牌保险公司，跑第一份商业合同。", GREEN),
]
for i, (q, t, d, col) in enumerate(phases):
    x = MARGIN + i * 3.02
    rect(sl, x, 1.66, 2.82, 1.86, fill=CARD, line=LINE, radius=0.05)
    text(sl, x + 0.24, 1.86, 1.0, 0.26, q, size=12, color=col, bold=True, font=MONO, cs=0.06)
    text(sl, x + 0.24, 2.18, 2.4, 0.30, t, size=14, color=INK, bold=True)
    text(sl, x + 0.24, 2.56, 2.42, 0.82, d, size=10.5, color=INK2, spacing=1.4)
hline(sl, MARGIN, 3.72, 11.83, color=LINE)
text(sl, MARGIN, 3.92, 5.5, 0.30, "团队", size=13, color=CYAN, bold=True, font=MONO, cs=0.04)
team = [
    ("【待填】", "队长 · 产品与合约", "【院系 / 年级】"),
    ("【待填】", "精算与定价", "【院系 / 年级】"),
    ("【待填】", "前端与演示", "【院系 / 年级】"),
]
for i, (n, r, s2) in enumerate(team):
    x = MARGIN + i * 2.55
    rect(sl, x, 4.28, 2.32, 1.02, fill=CARD, line=LINE, radius=0.05)
    text(sl, x + 0.20, 4.44, 1.95, 0.28, n, size=12.5, color=INK, bold=True)
    text(sl, x + 0.20, 4.74, 1.95, 0.24, r, size=10.5, color=CYAN)
    text(sl, x + 0.20, 4.98, 1.95, 0.24, s2, size=10, color=INK3)
text(sl, MARGIN, 5.52, 7.4, 0.30, "指导教师  【待填 · 姓名 / 职称】", size=11.5, color=INK3)
rect(sl, 8.85, 4.28, 3.73, 1.70, fill=CARD, line=LINE, radius=0.06)
text(sl, 9.08, 4.46, 3.3, 0.26, "已有进展", size=11, color=CYAN, bold=True, font=MONO, cs=0.03)
text(sl, 9.08, 4.78, 3.32, 1.05,
     "合约已部署并真实运行 21 小时 · 22 道门禁全绿 · 核验台 8/8 · 六城区划码 · 两票治理在跑。",
     size=10.5, color=INK2, spacing=1.5)
notes(sl, "团队页留占位，必须由本人填。姓名不编、院校不编 —— 这是报名表的红线。")

# ============================ 16 结尾 ============================
sl = slide()
rect(sl, 0, 0, W, H, fill=BG)
for i in range(46):
    xx = 0.12 + i * 0.29
    rect(sl, xx, 0.0 + (i % 7) * 0.42, 0.006, 1.15 + (i % 5) * 0.55, fill=RGBColor(0x16, 0x28, 0x3E))
bar = rect(sl, MARGIN, 2.05, 0.055, 0.42, fill=CYAN)
bar.fill.gradient()
bar.fill.gradient_stops[0].color.rgb = CYAN
bar.fill.gradient_stops[1].color.rgb = BLUE
text(sl, MARGIN, 2.28, 10.6, 1.05, "下雨这件事，不该需要谁来批准", size=40, color=INK, bold=True)
text(sl, MARGIN, 3.52, 10.6, 0.34, "Rain should not require anyone's approval to be paid for.",
     size=13, color=INK3, font=MONO)
hline(sl, MARGIN, 4.16, 7.4, color=LINE)
text(sl, MARGIN, 4.40, 9.2, 0.72,
     "把判定、证据和结算放到任何人可复算的地方 —— 这是我们对「可信」的理解。",
     size=15, color=INK2, spacing=1.5)
text(sl, MARGIN, 5.42, 9.2, 0.34,
     "【待填队名】 · 2026 大学生保险模拟创业大赛 · 保险科技应用赛道",
     size=12, color=INK3, font=MONO)
text(sl, MARGIN, 5.94, 9.2, 0.32, "现场演示：核验台 8 条断言，您自己点。", size=12, color=CYAN)
notes(sl, "结尾不要总结，留一句能被记住的话，然后把话筒交回给评委。")

# ---------- 保存 ----------
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "雨证-路演PPT-定稿-2026-10-27.pptx")
prs.save(out)
print("OK ->", out, "| 页数", len(prs.slides.__iter__.__self__._sldIdLst))