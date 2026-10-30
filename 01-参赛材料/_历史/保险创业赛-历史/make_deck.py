# -*- coding: utf-8 -*-
"""雨证 RainProof 路演 PPT 生成器（16:9 · 深色量测仪风格，取自 DESIGN.md）"""
import os
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

W, H = Inches(13.333), Inches(7.5)

NIGHT = RGBColor(0x05, 0x0A, 0x12)
NIGHT2 = RGBColor(0x0A, 0x12, 0x20)
SURF = RGBColor(0x0D, 0x17, 0x27)
SURF2 = RGBColor(0x12, 0x1E, 0x31)
INK = RGBColor(0xED, 0xF3, 0xFA)
INK2 = RGBColor(0xA6, 0xB8, 0xCB)
INK3 = RGBColor(0x6E, 0x82, 0x99)
MEASURE = RGBColor(0x34, 0xD3, 0xE4)
MONEY = RGBColor(0xFF, 0xC8, 0x57)
EVI = RGBColor(0x9E, 0x8C, 0xF5)
OK = RGBColor(0x3F, 0xD9, 0xA5)
BAD = RGBColor(0xF0, 0x83, 0x6F)
LINE = RGBColor(0x2A, 0x3A, 0x50)

SANS = "Microsoft YaHei"
MONO = "Consolas"

prs = Presentation()
prs.slide_width, prs.slide_height = W, H
BLANK = prs.slide_layouts[6]


def bg(slide, color=NIGHT):
    f = slide.background.fill
    f.solid()
    f.fore_color.rgb = color


def rect(slide, x, y, w, h, color=None, line=None, lw=0.75, shape=MSO_SHAPE.RECTANGLE):
    s = slide.shapes.add_shape(shape, x, y, w, h)
    if color is None:
        s.fill.background()
    else:
        s.fill.solid()
        s.fill.fore_color.rgb = color
    if line is None:
        s.line.fill.background()
    else:
        s.line.color.rgb = line
        s.line.width = Pt(lw)
    s.shadow.inherit = False
    return s


def text(slide, x, y, w, h, runs, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP,
         line_spacing=1.25, space_after=0):
    """runs: list of (txt, size, color, bold, font) or list of paragraphs(list of tuples)"""
    tb = slide.shapes.add_textbox(x, y, w, h)
    tf = tb.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = 0
    tf.margin_top = tf.margin_bottom = 0
    if runs and isinstance(runs[0], tuple):
        runs = [runs]
    for i, para in enumerate(runs):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.line_spacing = line_spacing
        p.space_after = Pt(space_after)
        for (t, size, color, bold, font) in para:
            r = p.add_run()
            r.text = t
            r.font.size = Pt(size)
            r.font.color.rgb = color
            r.font.bold = bold
            r.font.name = font
    return tb


def kicker(slide, txt, y=Inches(0.52), color=MEASURE):
    text(slide, Inches(0.95), y, Inches(11.4), Inches(0.28),
         [(txt, 11, color, True, SANS)])


def title(slide, txt, y=Inches(0.86), size=32):
    text(slide, Inches(0.95), y, Inches(11.4), Inches(0.75),
         [(txt, size, INK, True, SANS)])


def rule(slide, y=Inches(1.66), w=Inches(11.43), color=LINE):
    rect(slide, Inches(0.95), y, w, Emu(9525), color)


def page_no(slide, n, total=14):
    text(slide, Inches(11.9), Inches(6.92), Inches(0.5), Inches(0.25),
         [(f"{n:02d}", 10, INK3, False, MONO)], align=PP_ALIGN.RIGHT)


def footer(slide, txt="雨证 RainProof · 可复算的参数化降雨保障"):
    text(slide, Inches(0.95), Inches(6.92), Inches(6.5), Inches(0.25),
         [(txt, 9.5, INK3, False, SANS)])


def notes(slide, txt):
    slide.notes_slide.notes_text_frame.text = txt


def newslide(n, kick=None, ttl=None, size=32):
    s = prs.slides.add_slide(BLANK)
    bg(s)
    if kick:
        kicker(s, kick)
    if ttl:
        title(s, ttl, size=size)
        rule(s)
    page_no(s, n)
    footer(s)
    return s


# ---------------------------------------------------------------- 01 封面
s = prs.slides.add_slide(BLANK)
bg(s, NIGHT)
# 顶部雨幕装饰：一排细竖线，长度递减
import random
random.seed(7)
for i in range(46):
    x = Inches(0.9 + i * 0.257)
    h = Inches(0.35 + random.random() * 1.5)
    a = int(28 + random.random() * 55)
    c = RGBColor(0x34, 0xD3, 0xE4)
    sh = rect(s, x, Inches(0.42), Emu(9525), h, color=c)
    sh.fill.fore_color.rgb = RGBColor(
        min(255, 0x05 + int(a * 0.35)), min(255, 0x0A + int(a * 0.55)), min(255, 0x12 + int(a * 0.9)))

text(s, Inches(0.95), Inches(2.42), Inches(11.4), Inches(0.3),
     [("分子实验室 2026 大学生保险模拟创业大赛 · 保险科技应用赛道", 12, MEASURE, True, SANS)])

text(s, Inches(0.95), Inches(2.92), Inches(11.4), Inches(1.5),
     [("雨证 ", 62, INK, True, SANS), ("RainProof", 44, INK2, False, MONO)])

rect(s, Inches(0.98), Inches(4.28), Inches(1.5), Emu(28575), color=MONEY)

text(s, Inches(0.95), Inches(4.62), Inches(10.6), Inches(1.1),
     [("可复算的参数化降雨保障", 26, INK, True, SANS)],
     line_spacing=1.2)

text(s, Inches(0.95), Inches(5.62), Inches(10.2), Inches(0.9),
     [("骑手暴雨天跑不了单，收入当天归零。", 15, INK2, False, SANS),
      ("雨量过线，系统自动赔 —— 不报案、不定损、不求人。", 15, INK2, False, SANS)],
     line_spacing=1.55)

text(s, Inches(0.95), Inches(6.86), Inches(8.0), Inches(0.3),
     [("2026.11 · 队名待定", 10, INK3, False, SANS)])
notes(s, "开场不讲技术。先讲一个人的一天：早上六点出门，中午开始下雨，晚上八点回家，"
         "流水是平时的三分之一。他不缺勤劳，缺的是一份『今天下这么大雨，我少赚的钱谁补』的答案。"
         "雨证就是这个答案，而且它不需要他做任何事。")

# ---------------------------------------------------------------- 02 故事
s = newslide(2, "01 / 场景", "一个骑手的雨天，损失是即时的")
rows = [
    ("06:40", "出车。今天预报有雨，平台单量预估下降 30%。", INK2),
    ("11:20", "雨开始下。地面湿滑，摔一单就是几百块，他放慢速度。", INK2),
    ("14:00", "小时降雨 12mm。系统提示「恶劣天气」，配送时限放宽，单量继续掉。", MONEY),
    ("18:30", "当日流水 210 元。同城晴天均值 385 元。", BAD),
    ("20:00", "收工。没有保险可报——没有事故，没有伤，只是「没赚到」。", INK2),
]
y = Inches(2.05)
for i, (t, d, c) in enumerate(rows):
    text(s, Inches(0.95), y, Inches(0.95), Inches(0.3), [(t, 11.5, INK3, False, MONO)])
    rect(s, Inches(2.0), y + Inches(0.06), Emu(9525), Inches(0.5), color=LINE)
    text(s, Inches(2.22), y - Inches(0.02), Inches(9.9), Inches(0.5), [(d, 14.5, c, False, SANS)])
    y += Inches(0.86)

rect(s, Inches(0.95), Inches(6.28), Inches(11.43), Inches(0.62), color=SURF)
rect(s, Inches(0.95), Inches(6.28), Emu(28575), Inches(0.62), color=MONEY)
text(s, Inches(1.22), Inches(6.4), Inches(10.9), Inches(0.4),
     [("收入损失不是「意外」，是「天气」——而天气可以被测量。", 14, MONEY, True, SANS)])
notes(s, "385 元是一线城市高频熟练骑手的日均值（美团研究院 2024 全年 11,547 元/月 ÷ 30）。"
         "重点：这一天的损失没有任何『事故』可以报案。传统保险的理赔流程从第一步就走不通。")

# ---------------------------------------------------------------- 03 为什么没人做
s = newslide(3, "02 / 为什么是空白", "不是没需求，是成本结构把人筛掉了")
cards = [
    ("定损成本 ≈ 赔款", "单次赔 50–100 元，人工查勘核赔的成本与赔款同量级。保险经济学直接不成立。", BAD),
    ("损失无法核实", "骑手收入在平台侧数据里，保险公司拿不到。无法核损 = 无法承保。", BAD),
    ("逆选择极强", "看到暴雨预警才买。11 年数据实测：挑最优时点投保，期望赔付/敞口中位比可达月均 5.7–10.4 倍。", BAD),
]
x = Inches(0.95)
for (h, b, c) in cards:
    rect(s, x, Inches(2.1), Inches(3.6), Inches(2.5), color=SURF)
    rect(s, x, Inches(2.1), Inches(3.6), Emu(28575), color=c)
    text(s, x + Inches(0.3), Inches(2.42), Inches(3.0), Inches(0.45), [(h, 15, c, True, SANS)])
    text(s, x + Inches(0.3), Inches(2.98), Inches(3.05), Inches(1.5), [(b, 11.5, INK2, False, SANS)],
         line_spacing=1.5)
    x += Inches(3.92)

text(s, Inches(0.95), Inches(4.95), Inches(11.4), Inches(0.45),
     [("结论：传统保险卖不了这个人群，不是不愿意，是算不过账。", 17, INK, True, SANS)])

rect(s, Inches(0.95), Inches(5.6), Inches(11.43), Inches(1.05), color=SURF2)
text(s, Inches(1.25), Inches(5.78), Inches(10.9), Inches(0.7),
     [("我们的做法：不查损失，只查天气。把「赔多少」交给一个所有人都能复算的物理量，"
       "于是定损成本归零，逆选择被定价参数吸收。", 13, INK2, False, SANS)], line_spacing=1.5)
notes(s, "这一页是全场最重要的逻辑：参数化不是技术炫技，是唯一能让这个人群的单位经济成立的办法。"
         "定损成本→0 之后，几块钱的保单才可能赚钱。")

# ---------------------------------------------------------------- 04 产品
s = newslide(4, "03 / 产品", "雨量过线，自动到账")
tbl = [
    ("保障对象", "外卖 / 即时配送骑手"),
    ("保障时长", "12 小时 / 24 小时（国标 GB/T 28592—2012 唯二时段）"),
    ("触发条件", "保障窗口内「新增累计降雨量」越过档线"),
    ("赔付档位", "12h：30mm 赔 50% · 70mm 赔 75%　|　24h：50mm 赔 50% · 100mm 赔 75%"),
    ("满额赔付", "100 元 ≈ 一线骑手 0.26 个工作日收入"),
    ("理赔方式", "自动触发：不报案、不定损、不交材料，判定后分钟级到账"),
    ("价格", "众包自助 3.6–8.8 元 / 份；平台团体批发 1.1–2.2 元"),
]
y = Inches(1.98)
for i, (k, v) in enumerate(tbl):
    if i % 2 == 0:
        rect(s, Inches(0.95), y - Inches(0.06), Inches(11.43), Inches(0.62), color=SURF)
    text(s, Inches(1.2), y + Inches(0.02), Inches(1.85), Inches(0.35), [(k, 12, INK3, False, SANS)])
    text(s, Inches(3.1), y + Inches(0.02), Inches(9.1), Inches(0.42),
         [(v, 13, INK, i == 3, SANS)], line_spacing=1.2)
    y += Inches(0.62)

rect(s, Inches(0.95), Inches(6.42), Inches(11.43), Inches(0.5), color=RGBColor(0x14, 0x24, 0x1E))
text(s, Inches(1.2), Inches(6.52), Inches(11.0), Inches(0.32),
     [("刻意不做特大暴雨档：11 年数据里五城 24h ≥ 250mm 零命中 —— 写进条款却永远赔不到的档，是虚假承诺。",
       11.5, OK, False, SANS)])
notes(s, "档线直接取国标，这是为了让评委和监管都不用重新论证『多少毫米算暴雨』。"
         "『不做第三档』是个主动的诚实动作，评委很吃这一套。")

# ---------------------------------------------------------------- 05 技术
s = newslide(5, "04 / 凭什么不扯皮", "三件事让赔付变成可复算的")
cols = [
    ("① 三源验真", "ECMWF / GFS / ICON 三家数值模式同时取数，中位数与离散度双闸门。\n"
     "三家分歧过大 → 本轮拒绝写入，宁可不赔也不错赔。", MEASURE),
    ("② 确定性判定", "AI 不参与「赔不赔」的决定。\n"
     "R1–R5 五条规则，同一份输入永远得到同一个输出；大模型只负责写人话解释。", EVI),
    ("③ 全流程哈希", "每笔取数、每次判定都留下 inputHash / outputHash。\n"
     "任何人拿原始气象报文重算，必须得到同一个哈希。", MONEY),
]
x = Inches(0.95)
for (h, b, c) in cols:
    rect(s, x, Inches(2.0), Inches(3.6), Inches(2.72), color=SURF)
    rect(s, x, Inches(2.0), Inches(3.6), Emu(28573), color=c)
    text(s, x + Inches(0.3), Inches(2.3), Inches(3.0), Inches(0.4), [(h, 16, c, True, SANS)])
    text(s, x + Inches(0.3), Inches(2.86), Inches(3.02), Inches(1.7), [(b, 11.5, INK2, False, SANS)],
         line_spacing=1.55)
    x += Inches(3.92)

text(s, Inches(0.95), Inches(5.0), Inches(11.4), Inches(0.35),
     [("对外可验证到这一步：", 12, INK3, True, SANS)])
rect(s, Inches(0.95), Inches(5.38), Inches(11.43), Inches(1.32), color=SURF2)
text(s, Inches(1.25), Inches(5.55), Inches(10.9), Inches(1.0),
     [("打开核验台，8 条断言逐条自检：链上累计雨量 84mm ↔ 本地气象报文现算 SHA-256 是否一致、"
       "多签治理是否生效、保单的投保人与付款人是否分离、资金池台账能否逐分对平。", 12.5, INK2, False, SANS)],
     line_spacing=1.5)
notes(s, "这一页回答『你们和别家 AI 保险的区别』：我们不把 AI 放在决策位上。"
         "AI 在这里的位置是『发现运营方写数写错了』，而不是『决定赔不赔』。这是可以写进监管沟通材料的设计。")

# ---------------------------------------------------------------- 06 单位经济
s = newslide(6, "05 / 单位经济", "一张 2.2 元的平台保单，钱去哪了")
# 左：瀑布条
bars = [
    ("保费收入", 2.20, MONEY),
    ("期望赔付 34%", 0.74, BAD),
    ("固定成本 14%", 0.30, INK3),
    ("再保 15%", 0.33, EVI),
    ("渠道与运营 25%", 0.55, MEASURE),
    ("毛利 12%", 0.28, OK),
]
y = Inches(2.05)
for (k, v, c) in bars:
    text(s, Inches(0.95), y, Inches(1.95), Inches(0.3), [(k, 11.5, INK2, False, SANS)])
    w = Inches(v / 2.2 * 4.4)
    rect(s, Inches(2.95), y + Inches(0.02), max(w, Emu(9525)), Inches(0.24), color=c)
    text(s, Inches(2.95 + (v / 2.2 * 4.4) + 0.12), y - Inches(0.01), Inches(1.1), Inches(0.3),
         [(f"{v:.2f} 元", 11, c, True, MONO)])
    y += Inches(0.62)

# 右：三个数字
stats = [
    ("34%", "广州 24h 平台团体价的\n期望赔付率（点估计）", MEASURE),
    ("46–50%", "众包自助段赔付率\n（逆选择最强，故最贵）", MONEY),
    ("0 元", "定损与查勘成本\n（参数化，无需核损）", OK),
]
y = Inches(2.05)
for (n, d, c) in stats:
    text(s, Inches(8.75), y, Inches(3.6), Inches(0.5), [(n, 27, c, True, MONO)])
    text(s, Inches(8.75), y + Inches(0.52), Inches(3.6), Inches(0.7), [(d, 11, INK2, False, SANS)],
         line_spacing=1.45)
    y += Inches(1.42)

text(s, Inches(0.95), Inches(6.1), Inches(11.4), Inches(0.5),
     [("广州 24h 平台团体价 2.2 元 = （期望赔付 1.01 元 + 固定成本 0.30 元）÷ 60% 目标赔付率上限 —— 每一格都能倒推。",
       11.5, INK2, False, SANS)])
notes(s, "如果评委只问一个数字，就是这个 2.2 元的推导。分母 60% 是我们的目标赔付率上限，"
         "分子里 0.30 元是每份的固定成本（支付通道、运维、再保管理）。"
         "注意左边是定价时用的 97.5% 上界（1.01 元），右边是按历史点估计（0.74 元）算的实际赔付率——"
         "两者差 27 个百分点，就是我们留的安全边际。")

# ---------------------------------------------------------------- 07 定价表
s = newslide(7, "06 / 定价", "40 格费率：同一场雨，不同的人付不同的钱")
data12 = [("武汉", "1.6", "2.3", "4.1", "5.9"), ("上海", "1.4", "1.9", "3.0", "4.2"),
          ("北京", "1.1", "1.5", "2.5", "3.6"), ("广州", "2.0", "2.7", "4.3", "5.9"),
          ("成都", "1.4", "2.1", "3.9", "5.8")]
data24 = [("武汉", "1.6", "2.9", "5.8", "8.8"), ("上海", "1.5", "2.1", "3.7", "5.3"),
          ("北京", "1.2", "1.8", "3.5", "5.1"), ("广州", "2.2", "3.2", "5.5", "7.9"),
          ("成都", "1.4", "2.6", "5.3", "8.2")]

hdrs = ["城市", "平台团体", "认证·代付", "认证·自助", "众包·自助"]


def price_table(slide, x0, y0, ttl, rows, accent):
    text(slide, x0, y0, Inches(5.4), Inches(0.3), [(ttl, 12.5, accent, True, SANS)])
    yy = y0 + Inches(0.38)
    for j, h in enumerate(hdrs):
        text(slide, x0 + Inches(j * 1.06), yy, Inches(1.05), Inches(0.28),
             [(h, 9.5, INK3, False, SANS)])
    yy += Inches(0.3)
    for i, r in enumerate(rows):
        if i % 2 == 0:
            rect(slide, x0 - Inches(0.08), yy - Inches(0.04), Inches(5.36), Inches(0.34), color=SURF)
        for j, v in enumerate(r):
            c = INK2 if j == 0 else (accent if j == 4 else INK)
            text(slide, x0 + Inches(j * 1.06), yy, Inches(1.05), Inches(0.28),
                 [(v, 11.5 if j else 11.5, c, j == 4, MONO if j else SANS)])
        yy += Inches(0.34)
    return yy


price_table(s, Inches(0.95), Inches(2.0), "12 小时档（档线 30 / 70 mm）", data12, MEASURE)
price_table(s, Inches(7.0), Inches(2.0), "24 小时档（档线 50 / 100 mm）", data24, MONEY)

text(s, Inches(0.95), Inches(5.75), Inches(11.4), Inches(0.35),
     [("单位：元 / 份。按「区域 × 时长 × 骑手类型 × 渠道 × 购买量」五维生成；"
       "11 年逐小时 ERA5 数据、97.5% 置信上界 + 固定成本 0.30 元反算。", 10.5, INK3, False, SANS)])
rect(s, Inches(0.95), Inches(6.22), Inches(11.43), Inches(0.66), color=SURF2)
text(s, Inches(1.2), Inches(6.34), Inches(10.95), Inches(0.45),
     [("价差不是拍脑袋：北京 12h 众包 3.6 元 vs 广州 5.9 元 —— 广州 12h 触发率 2.78%，"
       "北京 1.67%，差 1.67 倍。", 11.5, INK2, False, SANS)])
notes(s, "定价差异化是这页的重点：同样的雨，广州比北京贵 64%，因为历史上广州更爱下暴雨。"
         "这也回答了『你们凭什么说自己是精算驱动』——每一格背后都有 96,432 小时的样本。")

# ---------------------------------------------------------------- 08 商业模式
s = newslide(8, "07 / 谁付钱", "B2B2C：平台付费，骑手零成本")
steps = [
    ("平台 / 众包服务商", "批量采购，按骑手人数计价", MEASURE),
    ("骑手", "零成本参保，无需操作", OK),
    ("触发赔付", "钱直接进骑手账户", MONEY),
]
x = Inches(0.95)
for i, (h, b, c) in enumerate(steps):
    rect(s, x, Inches(2.05), Inches(3.35), Inches(1.5), color=SURF)
    rect(s, x, Inches(2.05), Emu(28575), Inches(1.5), color=c)
    text(s, x + Inches(0.28), Inches(2.3), Inches(2.9), Inches(0.4), [(h, 14, c, True, SANS)])
    text(s, x + Inches(0.28), Inches(2.82), Inches(2.85), Inches(0.6), [(b, 11, INK2, False, SANS)],
         line_spacing=1.45)
    if i < 2:
        text(s, x + Inches(3.42), Inches(2.6), Inches(0.5), Inches(0.4), [("→", 20, INK3, False, SANS)])
    x += Inches(3.92)

text(s, Inches(0.95), Inches(3.9), Inches(5.4), Inches(0.35),
     [("为什么是平台付，不是骑手付", 13, INK, True, SANS)])
pts = [
    "触达在平台手里：一次采购覆盖上万骑手，边际获客成本≈0",
    "平台有真实动机：恶劣天气的舆情、运力稳定性、骑手留存",
    "合规上更干净：对公采购，不面向个人销售保险产品",
    "骑手端仍保留自费通道（3.6–10 元），服务灵活用工场景",
]
y = Inches(4.32)
for p in pts:
    rect(s, Inches(0.98), y + Inches(0.09), Inches(0.09), Inches(0.09), color=MEASURE)
    text(s, Inches(1.28), y, Inches(10.9), Inches(0.4), [(p, 12, INK2, False, SANS)])
    y += Inches(0.46)

text(s, Inches(0.95), Inches(6.3), Inches(11.4), Inches(0.4),
     [("我们不卖保险 —— 我们给持牌机构提供定价、验真与自动理赔的技术底座。", 13, MONEY, True, SANS)])
notes(s, "被问牌照就答这句：不卖保险，做技术输出。这是合规路径，也是商业模式成立的前提。"
         "平台付费的真正理由不是『骑手没钱』，而是『平台一次决策能覆盖一万人』。")

# ---------------------------------------------------------------- 09 市场
s = newslide(9, "08 / 市场", "从 1.1 亿的可服务市场切入")
funnel = [
    ("TAM", "19–26 亿", "全国 500–700 万骑手 × 250 个工作日 × 1.5 元/份", MEASURE, 5.6),
    ("SAM", "3.6 亿", "20 个重点城市 × 120 万活跃骑手 × 250 天 × 1.5 元", EVI, 3.7),
    ("SOM", "1.1 亿", "首批 8 城 × 100 万在保 × 1.4 元（第 3 年）", MONEY, 1.9),
]
y = Inches(2.0)
for (k, v, d, c, w) in funnel:
    rect(s, Inches(0.95), y, Inches(w), Inches(1.05), color=SURF)
    rect(s, Inches(0.95), y, Emu(28575), Inches(1.05), color=c)
    text(s, Inches(1.25), y + Inches(0.14), Inches(1.2), Inches(0.3), [(k, 11, c, True, MONO)])
    text(s, Inches(1.25), y + Inches(0.42), Inches(2.4), Inches(0.45), [(v, 21, INK, True, MONO)])
    text(s, Inches(4.1), y + Inches(0.34), Inches(7.9), Inches(0.4), [(d, 11.5, INK2, False, SANS)])
    y += Inches(1.28)

rect(s, Inches(0.95), Inches(5.92), Inches(11.43), Inches(0.86), color=SURF2)
text(s, Inches(1.2), Inches(6.06), Inches(11.0), Inches(0.6),
     [("政策顺风：人社部等九部门 2025 年 7 月《关于扩大新就业形态人员职业伤害保障试点工作的通知》"
       "（人社部发〔2025〕24 号）已将即时配送纳入扩大范围、2026 年推广全国 —— 天气收入保障与职业伤害保障互补。",
       10.5, INK2, False, SANS)], line_spacing=1.45)
notes(s, "TAM 的 1.5 元是五城 24h 平台团体价的中位数，这是保守口径（不是零售价）。"
         "SOM 只算 8 个城市，是刻意的克制——评委更信一个能算清的小数字。")

# ---------------------------------------------------------------- 10 证据
s = newslide(10, "09 / 我们不是 PPT 项目", "系统在跑，而且你现在就能验")
img = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..",
                   "雨证·Rainproof", "08-截图存证", "v5核验台-8of8-2026-10-26.png")
if os.path.exists(img):
    s.shapes.add_picture(img, Inches(0.95), Inches(1.98), width=Inches(6.55))

ev = [
    ("22", "道自动化测试", "评委可现场复跑，全绿"),
    ("8 / 8", "核验台断言", "链上数据与本地报文逐条比对"),
    ("11 年", "逐小时降雨样本", "96,432 小时 × 5 城"),
    ("1", "张真实保单已闭环", "投保 → 取数 → 判定 → 留痕"),
]
y = Inches(2.05)
for (n, k, d) in ev:
    text(s, Inches(7.85), y, Inches(4.4), Inches(0.42), [(n, 19, MEASURE, True, MONO)])
    text(s, Inches(9.15), y + Inches(0.06), Inches(3.1), Inches(0.3), [(k, 11.5, INK, True, SANS)])
    text(s, Inches(9.15), y + Inches(0.36), Inches(3.1), Inches(0.3), [(d, 10, INK3, False, SANS)])
    y += Inches(1.02)

text(s, Inches(7.85), Inches(6.2), Inches(4.4), Inches(0.5),
     [("截图：核验台 8/8 全绿（2026-10-26）", 9.5, INK3, False, SANS)])
notes(s, "这一页的作用是让『我们真的做了』变成『你可以自己查』。"
         "如果现场网络好，直接打开核验台点一次；如果网络不好，就用这张截图 + 让他们自己复跑 npm test。")

# ---------------------------------------------------------------- 11 诚实页
s = newslide(11, "10 / 主动交代", "三个我们知道、但还没解决的问题")
items = [
    ("基差风险只解决了一半",
     "参数化赔付的是「雨量」，不是「他今天的流水」。雨下了但单没少，或单少了雨没下，都会有人觉得不公。"
     "二期接入平台订单数据后，可以按真实流水做二次校准。"),
    ("数据源目前是单一聚合商",
     "三家数值模式（ECMWF / GFS / ICON）确实独立，但都经同一个公开气象聚合接口取数。"
     "接国内合规源（如国家气象信息中心）是路线图里的下一项。"),
    ("治理仍由 2/3 多签的三个地址控制",
     "对演示系统足够，但真实运营需要引入独立第三方做第二个签名方 —— 这是我们不打算自己解决、"
     "要交给持牌伙伴的部分。"),
]
y = Inches(2.0)
for (h, b) in items:
    rect(s, Inches(0.95), y, Inches(11.43), Inches(1.42), color=SURF)
    rect(s, Inches(0.95), y, Emu(28575), Inches(1.42), color=BAD)
    text(s, Inches(1.25), y + Inches(0.16), Inches(10.9), Inches(0.34), [(h, 13.5, INK, True, SANS)])
    text(s, Inches(1.25), y + Inches(0.58), Inches(10.85), Inches(0.75), [(b, 10.5, INK2, False, SANS)],
         line_spacing=1.4)
    y += Inches(1.54)
notes(s, "这一页是加分页，不是减分页。评委见过太多只讲优点的项目；"
         "主动说出『基差风险只解决一半』，反而证明我们真的想过产品。"
         "注意语气：是「我们知道边界在哪」，不是「我们做不好」。")

# ---------------------------------------------------------------- 12 财务
s = newslide(12, "11 / 财务", "第三年 1.1 亿保费，净利 450–780 万")
fin = [
    ("", "第 1 年", "第 2 年", "第 3 年"),
    ("在保骑手", "2 万", "20 万", "80 万"),
    ("单价（元/份）", "1.2", "1.3", "1.4"),
    ("年有效天数", "60", "80", "100"),
    ("保费收入", "144 万", "2,080 万", "11,200 万"),
    ("科技服务费 12–15%", "18–22 万", "250–312 万", "1,344–1,680 万"),
    ("运营成本", "≈80 万", "≈350 万", "≈900 万"),
    ("净利", "−40~−60 万", "−40~−100 万", "450–780 万"),
]
x0, y0 = Inches(0.95), Inches(2.05)
colw = [Inches(2.6), Inches(2.6), Inches(2.6), Inches(2.6)]
for i, row in enumerate(fin):
    yy = y0 + Inches(i * 0.52)
    if i == 0:
        rect(s, x0, yy - Inches(0.05), Inches(10.4), Inches(0.44), color=SURF2)
    elif i == 4 or i == 7:
        rect(s, x0, yy - Inches(0.05), Inches(10.4), Inches(0.44), color=SURF)
    cx = x0
    for j, v in enumerate(row):
        c = INK3 if i == 0 else (MONEY if (i in (4, 7) and j > 0) else INK2 if j else INK3)
        bold = i == 0 or (i in (4, 7) and j > 0)
        text(s, cx, yy, colw[j], Inches(0.36),
             [(v, 11 if i else 10, c, bold, MONO if j and i else SANS)])
        cx += colw[j]

text(s, Inches(0.95), Inches(6.42), Inches(11.4), Inches(0.5),
     [("盈亏平衡点在 25–30 万在保骑手，第 3 年初达成。基准情形自留赔付率 52%（点估计 47% + 5% 转分保）。",
       10.5, INK2, False, SANS)])
notes(s, "第 2 年仍然是亏的，这一点不要藏——藏了评委一算就穿。"
         "我们讲的是『第 3 年靠规模过盈亏平衡』，而这个规模只占 SAM 的 1/3，不激进。")

# ---------------------------------------------------------------- 13 路线图
s = newslide(13, "12 / 路线图", "三步走：试点 → 六城 → 十五城")
phases = [
    ("2026 Q4 — 2027 Q1", "试点验证", ["与 1 家平台签试点协议", "六城（含县级市义乌）上线", "完成首轮再保安排"], MEASURE),
    ("2027 Q2 — 2028 Q1", "规模复制", ["扩至 15 城", "接入平台订单数据，做二次基差校准", "数据源接入国内合规源"], EVI),
    ("2028 起", "品类延展", ["高温津贴 / 台风停工 / 空气质素", "向物流、建筑、环卫延展", "城市级天气风险定价能力对外输出"], MONEY),
]
x = Inches(0.95)
for (t, h, pts, c) in phases:
    rect(s, x, Inches(2.0), Inches(3.6), Inches(3.55), color=SURF)
    rect(s, x, Inches(2.0), Inches(3.6), Emu(28575), color=c)
    text(s, x + Inches(0.28), Inches(2.26), Inches(3.1), Inches(0.3), [(t, 9.5, c, True, MONO)])
    text(s, x + Inches(0.28), Inches(2.62), Inches(3.1), Inches(0.4), [(h, 16, INK, True, SANS)])
    yy = Inches(3.2)
    for p in pts:
        text(s, x + Inches(0.28), yy, Inches(3.05), Inches(0.62), [("· " + p, 10.5, INK2, False, SANS)],
             line_spacing=1.4)
        yy += Inches(0.72)
    x += Inches(3.92)

rect(s, Inches(0.95), Inches(5.92), Inches(11.43), Inches(0.86), color=SURF2)
text(s, Inches(1.2), Inches(6.06), Inches(11.0), Inches(0.6),
     [("每一步的验收标准都是可验的：城市数、在保人数、赔付时效中位数、"
       "以及「任意第三方能否复算我们的判定」。", 11.5, INK2, False, SANS)], line_spacing=1.45)
notes(s, "路线图不吹时间表，只讲验收标准。评委最烦『三年上市』这种话。")

# ---------------------------------------------------------------- 14 团队 / 封底
s = newslide(14, "13 / 团队", "两个人，一套可复跑的工程")
text(s, Inches(0.95), Inches(1.95), Inches(5.5), Inches(2.4),
     [("成员 A　", 14, INK, True, SANS), ("〔待填：姓名 · 院系 · 年级〕", 13, INK3, False, SANS),
      ("\n链上工程与 AI 判定系统：合约、脚本、核验台、全部自动化测试", 11, INK2, False, SANS)],
     line_spacing=1.6)
text(s, Inches(0.95), Inches(3.35), Inches(5.5), Inches(2.4),
     [("成员 B　", 14, INK, True, SANS), ("〔待填：姓名 · 院系 · 年级〕", 13, INK3, False, SANS),
      ("\n精算定价与商业材料：11 年数据处理、40 格费率、计划书与叙事", 11, INK2, False, SANS)],
     line_spacing=1.6)
text(s, Inches(0.95), Inches(4.75), Inches(5.5), Inches(1.2),
     [("指导教师　", 14, INK, True, SANS), ("〔待填：姓名 · 职称〕", 13, INK3, False, SANS)],
     line_spacing=1.6)

rect(s, Inches(7.1), Inches(1.95), Inches(5.28), Inches(4.35), color=SURF)
text(s, Inches(7.42), Inches(2.2), Inches(4.7), Inches(0.35),
     [("协作方式本身就是个样本", 11, MEASURE, True, SANS)])
text(s, Inches(7.42), Inches(2.62), Inches(4.66), Inches(3.5),
     [("两人异地、全流程 AI 辅助：\n"
       "· 26 道自动化门禁，任何改动先过测试\n"
       "· 双人文档互审，所有数字可溯源到脚本输出\n"
       "· 每个链上动作都有 txHash 与留痕文件\n\n"
       "这套工程纪律，就是我们敢让评委现场复跑的原因。", 11, INK2, False, SANS)],
     line_spacing=1.55)

rect(s, Inches(0.95), Inches(6.35), Inches(11.43), Emu(28575), color=MONEY)
text(s, Inches(0.95), Inches(6.55), Inches(11.4), Inches(0.6),
     [("我们卖的不是保险，是可验证的自动理赔 —— 把「你信不信我」换成「你自己验」。", 15, INK, True, SANS)])
notes(s, "封底一句话要慢讲。讲完停两秒，等评委翻页。")

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "雨证-路演PPT-2026-10-26.pptx")
prs.save(out)
print("SAVED", out)
print("slides", len(prs.slides.__iter__.__self__._sldIdLst))
