# -*- coding: utf-8 -*-
"""
雨证 RainProof · 初赛答辩 PPT（18 页 / 15:00 / 含现场演示 2:50）
视觉体系参照 `神麻组-雨证-路演PPT1.pptx`：
  深色影院感 · 全幅照片压暗做底 · 青(#22D3EE)/蓝(#2D7FF9)/琥珀(#F5A524)
  左上青色竖条 + 白色粗标题 + 等宽英文副题 + 右上角章节标（带评审权重）
  真实产品截图与原生图表当插图；卡片 = 深蓝底 + 1px 描边
字体：微软雅黑（正文/标题）+ Consolas（标号/数字/英文）
字号下限：正文 12.5pt、标签 10.5pt、脚注 9.5pt —— 保证投影与会议软件压缩后仍可读
"""
import os
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from pptx.oxml.ns import qn
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE, XL_LABEL_POSITION, XL_TICK_MARK
from lxml import etree
from PIL import Image

# ---------- 令牌 ----------
BG     = RGBColor(0x0A, 0x12, 0x20)
BG2    = RGBColor(0x0D, 0x18, 0x28)
CARD   = RGBColor(0x10, 0x1B, 0x2C)
CARD2  = RGBColor(0x16, 0x24, 0x3A)
LINE   = RGBColor(0x1E, 0x2C, 0x40)
WHITE  = RGBColor(0xF2, 0xF6, 0xFA)
INK2   = RGBColor(0xA8, 0xB8, 0xC8)
INK3   = RGBColor(0x6E, 0x82, 0x96)
CYAN   = RGBColor(0x22, 0xD3, 0xEE)
BLUE   = RGBColor(0x2D, 0x7F, 0xF9)
AMBER  = RGBColor(0xF5, 0xA5, 0x24)
GREEN  = RGBColor(0x35, 0xD0, 0x9A)
RED    = RGBColor(0xEF, 0x6E, 0x5B)

CN, MONO = "微软雅黑", "Consolas"
W, H = 13.333, 7.5
M = 0.78
CW = W - 2 * M
TOTAL = 18

ASSET = os.environ.get("RAINPROOF_MEDIA_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets"))
SHOT = os.environ.get("RAINPROOF_SCREENSHOT_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "screenshots"))

prs = Presentation()
prs.slide_width = Inches(W)
prs.slide_height = Inches(H)
BLANK = prs.slide_layouts[6]
_n = {"v": 0}


def _no_autofit(tf):
    bodyPr = tf._txBody.find(qn('a:bodyPr'))
    for tag in ('a:normAutofit', 'a:spAutoFit', 'a:noAutofit'):
        el = bodyPr.find(qn(tag))
        if el is not None:
            bodyPr.remove(el)
    bodyPr.append(etree.SubElement(bodyPr, qn('a:noAutofit')))


def text(sl, x, y, w, h, s, size=12.5, color=WHITE, bold=False, font=CN,
         align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, spacing=1.0, cs=0):
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
            rPr = r.font._rPr
            rPr.set('lang', 'zh-CN')
            latin = rPr.find(qn('a:latin'))
            ea = rPr.find(qn('a:ea'))
            if ea is None:
                ea = etree.SubElement(rPr, qn('a:ea'))
                if latin is not None:
                    latin.addnext(ea)
            ea.set('typeface', ropt.get("font", font))
            if ropt.get("cs", cs):
                rPr.set('spc', str(int(ropt.get("cs", cs) * 100)))
    return tb


def _alpha(sp, pct):
    if pct >= 100:
        return
    fill = sp.fill._xPr.find(qn('a:solidFill'))
    if fill is None:
        return
    clr = fill[0]
    a = etree.SubElement(clr, qn('a:alpha'))
    a.set('val', str(int(pct * 1000)))


def rect(sl, x, y, w, h, fill=CARD, line=None, lw=1.0, alpha=100, shape=MSO_SHAPE.RECTANGLE):
    sp = sl.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
    if fill is None:
        sp.fill.background()
    else:
        sp.fill.solid()
        sp.fill.fore_color.rgb = fill
        _alpha(sp, alpha)
    if line is None:
        sp.line.fill.background()
    else:
        sp.line.color.rgb = line
        sp.line.width = Pt(lw)
    sp.shadow.inherit = False
    return sp


def pic_cover(sl, path, x, y, w, h, border=None):
    iw, ih = Image.open(path).size
    target = w / h
    src = iw / ih
    pic = sl.shapes.add_picture(path, Inches(x), Inches(y), Inches(w), Inches(h))
    if src > target:
        keep = target / src
        cut = (1 - keep) / 2
        pic.crop_left = cut
        pic.crop_right = cut
    elif src < target:
        keep = src / target
        cut = (1 - keep) / 2
        pic.crop_top = cut
        pic.crop_bottom = cut
    if border:
        pic.line.color.rgb = border
        pic.line.width = Pt(1)
    return pic


def pic_region(sl, path, x, y, w, h, cx=0.5, cy=0.5, zoom=1.0, border=LINE):
    """等比取景：从原图取一块与目标同比例的区域，不拉伸"""
    iw, ih = Image.open(path).size
    ar_t, ar_s = w / h, iw / ih
    if ar_s > ar_t:
        kw, kh = ar_t / ar_s, 1.0
    else:
        kw, kh = 1.0, ar_s / ar_t
    kw, kh = kw / zoom, kh / zoom
    cl = max(0.0, min(1 - kw, cx - kw / 2))
    ct = max(0.0, min(1 - kh, cy - kh / 2))
    pic = sl.shapes.add_picture(path, Inches(x), Inches(y), Inches(w), Inches(h))
    pic.crop_left, pic.crop_top = cl, ct
    pic.crop_right, pic.crop_bottom = 1 - kw - cl, 1 - kh - ct
    if border:
        pic.line.color.rgb = border
        pic.line.width = Pt(1)
    return pic


def pic_crop(sl, path, x, y, w, h, cl=0, ct=0, cr=0, cb=0, border=LINE):
    pic = sl.shapes.add_picture(path, Inches(x), Inches(y), Inches(w), Inches(h))
    pic.crop_left, pic.crop_top, pic.crop_right, pic.crop_bottom = cl, ct, cr, cb
    if border:
        pic.line.color.rgb = border
        pic.line.width = Pt(1)
    return pic


def grad(sl, x, y, w, h, color, a1, a2, angle=0):
    """线性渐变遮罩：a1 / a2 为两端不透明度（0-100），angle 0=左→右，90=上→下"""
    from pptx.oxml import parse_xml
    from pptx.oxml.ns import nsdecls
    sp = rect(sl, x, y, w, h, fill=color)
    spPr = sp._element.spPr
    hexv = '%02X%02X%02X' % (color[0], color[1], color[2])
    xml = (
        '<a:gradFill %s rotWithShape="1">'
        '<a:gsLst>'
        '<a:gs pos="0"><a:srgbClr val="%s"><a:alpha val="%d"/></a:srgbClr></a:gs>'
        '<a:gs pos="100000"><a:srgbClr val="%s"><a:alpha val="%d"/></a:srgbClr></a:gs>'
        '</a:gsLst>'
        '<a:lin ang="%d" scaled="0"/>'
        '</a:gradFill>'
    ) % (nsdecls('a'), hexv, int(a1 * 1000), hexv, int(a2 * 1000), int(angle * 60000))
    newel = parse_xml(xml)
    old = None
    for tag in ('a:solidFill', 'a:gradFill', 'a:noFill', 'a:pattFill'):
        old = spPr.find(qn(tag))
        if old is not None:
            break
    if old is not None:
        old.addprevious(newel)
        spPr.remove(old)
    else:
        ln = spPr.find(qn('a:ln'))
        if ln is not None:
            ln.addprevious(newel)
        else:
            spPr.append(newel)
    return sp


def page(photo=None, dim=45):
    sl = prs.slides.add_slide(BLANK)
    _n["v"] += 1
    rect(sl, 0, 0, W, H, fill=BG)
    if photo:
        pic_cover(sl, photo, 0, 0, W, H)
        rect(sl, 0, 0, W, H, fill=RGBColor(0x06, 0x0C, 0x16), alpha=dim)
    return sl


def foot(sl):
    text(sl, M, 7.06, 4.0, 0.22, "雨证 RainProof", size=9.5, color=INK3, font=MONO, cs=0.06)
    text(sl, 10.85, 7.02, 0.82, 0.26, "%02d" % _n["v"], size=11.5, color=INK2, bold=True,
         font=MONO, align=PP_ALIGN.RIGHT)
    text(sl, 11.72, 7.06, 0.60, 0.22, "/ %d" % TOTAL, size=9.5, color=INK3, font=MONO)


def head(sl, title, en=None, sec=None, tagcolor=INK3):
    rect(sl, M, 0.52, 0.048, 0.40, fill=CYAN)
    text(sl, M + 0.20, 0.50, 9.4, 0.44, title, size=26, color=WHITE, bold=True, spacing=1.04)
    if en:
        text(sl, M + 0.20, 0.98, 9.4, 0.24, en, size=9.5, color=INK3, font=MONO, cs=0.08)
    if sec:
        text(sl, 8.90, 0.58, 3.66, 0.24, sec, size=9.5, color=tagcolor, font=MONO,
             align=PP_ALIGN.RIGHT, cs=0.06)


def notes(sl, s):
    sl.notes_slide.notes_text_frame.text = s


# ==================================================================
# 01 封面
# ==================================================================
sl = page(os.path.join(ASSET, "image1.png"), dim=12)
grad(sl, 0, 0, W, H, RGBColor(0x03, 0x08, 0x12), 96, 18, angle=0)
grad(sl, 0, 5.30, W, 2.20, RGBColor(0x03, 0x08, 0x12), 0, 78, angle=90)
rect(sl, 0, 0, W, 0.06, fill=CYAN)
text(sl, M, 1.02, 8.0, 0.26, "2026 大学生保险模拟创业大赛 · 保险科技应用赛道",
     size=11.5, color=CYAN, font=MONO, cs=0.10)
text(sl, M, 1.44, 8.6, 1.10, "雨证 · RainProof", size=58, color=WHITE, bold=True)
text(sl, M, 2.64, 7.6, 0.40, "可复算的参数化降雨保障", size=21, color=WHITE)
text(sl, M, 3.10, 7.6, 0.24, "PARAMETRIC RAIN INSURANCE · VERIFIABLE BY ANYONE",
     size=9.5, color=INK3, font=MONO, cs=0.12)
rect(sl, M, 3.56, 2.10, 0.045, fill=CYAN)
text(sl, M, 3.80, 7.4, 0.38,
     [[("把「你信不信我」换成", {"size": 17, "color": WHITE}),
       ("「你自己验」", {"size": 17, "color": AMBER, "bold": True})]])
text(sl, M, 4.36, 6.8, 0.60,
     "降雨越过国标档线即触发判定；输入、输出与原始报文全部留痕，\n任何第三方可用同一份数据复算出同一个结论。",
     size=11.5, color=INK2, spacing=1.5)
text(sl, M, 6.36, 6.4, 0.24, "初赛线上答辩 · 15:00　|　现场演示 2:50", size=10, color=INK2, font=MONO)
text(sl, M, 6.68, 6.4, 0.24, "TEAM 神麻【院系待填】", size=10, color=INK2, font=MONO)
for i, (v, lab) in enumerate([("15:00", "TOTAL"), ("2:50", "LIVE DEMO"), ("18", "PAGES")]):
    x = 9.62 + i * 0.96
    text(sl, x, 1.02, 0.88, 0.34, v, size=17, color=CYAN, bold=True, font=MONO, align=PP_ALIGN.RIGHT)
    text(sl, x, 1.38, 0.88, 0.20, lab, size=8.5, color=INK3, font=MONO, cs=0.06, align=PP_ALIGN.RIGHT)
notes(sl, "【0:00–0:25】\n"
          "口播：各位评委好，我们是神麻队。今天 15 分钟讲一件事——暴雨天外卖骑手的收入会直接归零，"
          "而这个人群到今天没有一个能自动赔付的产品。我们做的，是把「定损」这个环节整个删掉。\n"
          "动作：说到「删掉」时才翻页。")

# ==================================================================
# 02 路线
# ==================================================================
sl = page()
head(sl, "这 15 分钟怎么走", "RUN OF SHOW · 900 SECONDS, FIXED", "00 / AGENDA")
rows = [("00", "开场与路线", "0:00–0:45", 45, "一句话说清我们做什么", INK3),
        ("01", "项目介绍", "0:45–4:20", 215, "痛点、产品、谁付钱", CYAN),
        ("02", "技术方案", "4:20–7:40", 200, "数据 · 验真 · 判定 · 存证", BLUE),
        ("03", "创新点", "7:40–9:45", 125, "三条叠加才是壁垒", AMBER),
        ("04", "现场演示", "9:45–13:35", 230, "评委自己点：8 条断言 · 真保单 · 台账", GREEN),
        ("05", "总结与展望", "13:35–15:00", 85, "路线图与一句收尾", INK2)]
for i, (no, name, span, sec, desc, col) in enumerate(rows):
    y = 1.52 + i * 0.88
    text(sl, M, y + 0.06, 0.55, 0.30, no, size=13, color=col, bold=True, font=MONO)
    text(sl, M + 0.62, y - 0.02, 2.50, 0.34, name, size=16.5, color=WHITE, bold=True)
    text(sl, M + 0.62, y + 0.36, 1.30, 0.24, span, size=10, color=INK3, font=MONO)
    bw = sec / 230.0 * 3.05
    rect(sl, 4.42, y + 0.10, bw, 0.17, fill=col, alpha=85)
    text(sl, 4.42 + bw + 0.10, y + 0.04, 0.88, 0.26, "%d′%02d″" % (sec // 60, sec % 60),
         size=13, color=col, bold=True, font=MONO)
    text(sl, 8.58, y + 0.04, 3.96, 0.30, desc, size=11.5, color=INK2)
    rect(sl, M, y + 0.72, CW, 0.008, fill=LINE)
text(sl, M, 6.90, 6.4, 0.22, "合计 900 秒 · 不含评委提问", size=10, color=INK3, font=MONO)
text(sl, 7.40, 6.90, 5.15, 0.22, "超时：先砍 P13 → 再砍 P04 → 演示不压缩", size=10, color=AMBER,
     font=MONO, align=PP_ALIGN.RIGHT)
notes(sl, "【0:25–0:45】20 秒。让评委第一时间确认「这人控得住时间」。\n"
          "口播：我按四段讲——项目、技术、创新，然后留两分五十秒请您自己点一遍系统，最后是路线图。\n"
          "每段我都标了页码和秒数，超时我会自己砍，不会占您的提问时间。")

# ==================================================================
# 03 痛点
# ==================================================================
sl = page()
head(sl, "暴雨天，他的收入是按单算的", "PAID BY THE ORDER — A RAIN DAY IS A ZERO DAY",
     "01 / 项目介绍 · 可行性 25%")
pic_cover(sl, os.path.join(ASSET, "image3.png"), M, 1.52, 4.42, 4.62)
text(sl, 5.55, 1.52, 7.02, 0.66,
     "暴雨橙色预警。他穿上雨衣，骑上车，跑了 12 个小时 —— 因为当天不出勤，就没有收入。",
     size=13.5, color=WHITE, spacing=1.5)
cards = [("336", "万人", "月均有单骑手", "美团 2024；蜂鸟约 400 万活跃", CYAN),
         ("-45", "%", "暴雨日流水落差", "210 元 vs 同城均值 385 元", AMBER),
         ("0", "款", "他能买到的天气险", "没有产品，也不知道找谁", AMBER)]
for i, (v, u, lab, note_, col) in enumerate(cards):
    y = 2.36 + i * 1.02
    rect(sl, 5.55, y, 7.02, 0.90, fill=CARD, line=(col if i == 2 else LINE), lw=(1.4 if i == 2 else 1))
    text(sl, 5.78, y + 0.18, 1.80, 0.52, [[(v, {"size": 30, "color": col, "bold": True}),
                                           (" " + u, {"size": 11, "color": INK2})]])
    text(sl, 7.72, y + 0.20, 2.60, 0.26, lab, size=12.5, color=WHITE, bold=True)
    text(sl, 7.72, y + 0.50, 4.60, 0.26, note_, size=10, color=INK3)
text(sl, 5.55, 5.62, 7.02, 0.34, "不是没人亏，是没人能证明自己亏了。", size=17, color=WHITE, bold=True)
text(sl, 5.55, 6.04, 7.02, 0.46,
     "收入在平台侧、损失没票据、单笔赔款几十元 —— 传统理赔链条在这类人群身上不具备经济性。",
     size=10.5, color=INK2, spacing=1.35)
foot(sl)
notes(sl, "【0:45–1:35】50 秒。先把人立起来，再讲成本。\n"
          "口播：这不是「保险太贵」的故事。他一天流水 385，暴雨天掉到 210，掉的那 175 块没有任何凭证。"
          "保险公司要派人证明「他真的少挣了 175」，这一步的成本和赔款是同一个量级。\n"
          "口径：336 万是美团月均有单，400 万是蜂鸟活跃，不要加总。")

# ==================================================================
# 04 成本结构
# ==================================================================
sl = page()
head(sl, "不是没人想保，是这笔账算不过来", "THE MATH DOES NOT CLOSE",
     "01 / 项目介绍 · 可行性 25%")
text(sl, M, 1.62, 3.10, 0.44, "查一次的成本", size=19, color=WHITE, bold=True)
text(sl, 3.72, 1.55, 0.55, 0.50, "≈", size=24, color=AMBER, bold=True)
text(sl, 4.32, 1.62, 2.80, 0.44, "赔一次的钱", size=19, color=AMBER, bold=True)
pts = [("两档模拟给付 50 / 75 元", "客单价极低，容不下人工环节"),
       ("报案、查勘、核损、核赔", "每一步都与赔款同量级"),
       ("理性选择：不卖", "用平台补贴代替保险，成本中心化")]
for i, (t, d) in enumerate(pts):
    y = 2.44 + i * 0.78
    rect(sl, M, y + 0.09, 0.10, 0.10, fill=CYAN)
    text(sl, M + 0.30, y - 0.04, 3.20, 0.30, t, size=13, color=WHITE, bold=True)
    text(sl, M + 0.30, y + 0.28, 6.20, 0.26, d, size=11.5, color=INK2)
rect(sl, M, 4.86, 7.10, 1.10, fill=CARD, line=LINE)
text(sl, M + 0.24, 5.02, 6.6, 0.24, "下游三个结果 —— 同一个原因，不是三个问题", size=10, color=CYAN, font=MONO)
text(sl, M + 0.24, 5.34, 6.62, 0.44, "损失核不了　·　逆选择与骗赔无解　·　众包身份无凭据",
     size=13, color=WHITE, bold=True)
text(sl, M, 6.16, 7.10, 0.34, "所以我们删掉的不是价格，是最贵的那个环节。", size=13, color=AMBER, bold=True)
text(sl, 8.10, 1.62, 4.4, 0.24, "市场（假设全部公开，可复核）", size=10, color=INK3, font=MONO, cs=0.04)
mkt = [("TAM", "19–26", "亿元 / 年", "500–700 万骑手 × 250 天 × 1.5 元", 3.00, CYAN),
       ("SAM", "3.6", "亿元 / 年", "200 万高频 × 120 天 × 1.5 元", 2.10, BLUE),
       ("SOM 第 3 年", "1.1", "亿元 / 年", "80 万骑手 × 100 天 × 1.4 元", 1.35, INK2)]
for i, (k, v, u, d, bw, col) in enumerate(mkt):
    y = 1.96 + i * 1.50
    text(sl, 8.10, y, 1.30, 0.24, k, size=10, color=INK3, font=MONO, cs=0.04)
    text(sl, 9.86, y - 0.10, 2.68, 0.40, [[(v, {"size": 24, "color": col, "bold": True}),
                                           ("  " + u, {"size": 10, "color": INK3})]], align=PP_ALIGN.RIGHT)
    rect(sl, 8.10, y + 0.36, bw, 0.12, fill=col, alpha=80)
    text(sl, 8.10, y + 0.58, 4.42, 0.24, d, size=10, color=INK2)
text(sl, 8.10, 6.42, 4.42, 0.42, "只算会被暴雨打断收入、且能被参数化定价的那一小群人。",
     size=9.5, color=INK3, spacing=1.3)
foot(sl)
notes(sl, "【1:35–2:30】55 秒。承重「可行性与商业价值」25%。\n"
          "口播：不是需求不存在，是成本结构不允许。查一次的钱和赔一次的钱是同一个量级，"
          "所以理性选择是不做这个人群，用补贴代替保险。\n"
          "预判追问：「19 亿怎么算」→ 公式就在页上，乘一遍即可。")

# ==================================================================
# 05 产品
# ==================================================================
sl = page()
head(sl, "一张保单长什么样", "WHAT A POLICY LOOKS LIKE",
     "01 / 项目介绍 · 专业深度 20%")
spec = [("保障对象", "外卖 / 即时配送骑手，可由平台整批代投"),
        ("保障窗口", "12 小时 / 24 小时（GB/T 28592—2012 两个时段）"),
        ("触发", "窗口内「新增累计降雨量」越过档线，不看总雨量"),
        ("给付", "额度基数 100 元，实际给付 50 / 75 元 / 份"),
        ("价格", "骑手自付 3.6–8.8 元；平台批发 1.1–2.2 元")]
for i, (k, v) in enumerate(spec):
    y = 1.54 + i * 0.86
    text(sl, M, y + 0.06, 1.26, 0.24, k, size=10.5, color=CYAN, font=MONO, cs=0.04)
    text(sl, M + 1.34, y - 0.02, 5.30, 0.44, v, size=13, color=WHITE, spacing=1.3)
    rect(sl, M, y + 0.66, 6.70, 0.008, fill=LINE)
rect(sl, M, 5.94, 6.70, 0.74, fill=CARD, line=LINE)
text(sl, M + 0.22, 6.10, 6.30, 0.44,
     "赔付额是定值 —— 这是参数化的代价，也是免人工定损的原因。",
     size=11.5, color=AMBER, bold=True)
text(sl, 7.86, 1.42, 4.6, 0.24, "骑手端 · 投保卡实拍（现网读数）", size=10, color=INK3, font=MONO, cs=0.04)
pic_region(sl, os.path.join(SHOT, "rider.png"), 7.86, 1.70, 4.62, 3.86, cx=0.50, cy=0.40, zoom=1.42)
text(sl, 7.86, 5.68, 4.62, 0.24, "现网读数，非设计稿", size=10, color=CYAN, bold=True, font=MONO, cs=0.04)
text(sl, 7.86, 5.98, 4.62, 0.74,
     "上海 12h：保费 4.20 元／份，档线 30/70mm，当前城市累计 172mm —— 全部现读链上，改不了。",
     size=10.5, color=INK2, spacing=1.4)
foot(sl)
notes(sl, "【2:30–3:20】50 秒。产品一页讲完，不留悬念。\n"
          "口播：窗口只有两档，不是偷懒，是国标只定义了 12 小时和 24 小时；档线也抄国标。"
          "满额 100 元约四分之一个工作日收入——刻意压低，赔太多会诱导逆选择。\n"
          "被问 48/72 小时：实测保费涨 4 倍、触发率掉一半，这种产品不该存在。")

# ==================================================================
# 06 商业
# ==================================================================
sl = page()
head(sl, "谁付钱，钱又去哪了", "WHO PAYS, AND WHERE EVERY YUAN GOES",
     "01 / 项目介绍 · 可行性 25%")
buyers = [("主攻", "平台 / 众包服务商", "有合规与舆情压力，一次决策覆盖上万骑手", CYAN),
          ("补充", "骑手自付", "价格敏感、获客贵，只作自助渠道", INK2),
          ("分成", "持牌保险公司", "承保主体；我们输出定价与自动理赔系统", BLUE)]
for i, (t, name, desc, col) in enumerate(buyers):
    y = 1.52 + i * 1.42
    text(sl, M, y + 0.10, 0.62, 0.24, t, size=10.5, color=col, bold=True, font=MONO, cs=0.06)
    text(sl, M + 0.70, y, 4.9, 0.32, name, size=16, color=WHITE, bold=True)
    text(sl, M + 0.70, y + 0.44, 4.9, 0.30, desc, size=11, color=INK2)
    rect(sl, M, y + 1.00, 5.55, 0.008, fill=LINE)
rect(sl, M, 5.82, 5.55, 0.90, fill=CARD, line=LINE)
text(sl, M + 0.22, 5.96, 5.10, 0.62,
     "旁证：美团 2025 年为 300 万骑手全额出资投防暑险 —— 平台付费已被验证。",
     size=10, color=INK2, spacing=1.35)
text(sl, 6.60, 1.46, 5.6, 0.24, "一张 2.2 元的平台保单 · 广州 24h · 额度基数 100 元",
     size=10, color=INK3, font=MONO, cs=0.04)
segs = [("期望赔付", 34, GREEN), ("固定成本", 14, INK3), ("再保", 15, BLUE),
        ("渠道", 25, CYAN), ("毛利", 12, AMBER)]
bx, bwall = 6.60, 5.92
acc = 0.0
for name, pct, col in segs:
    w = pct / 100.0 * bwall
    rect(sl, bx + acc, 1.74, w, 0.46, fill=col, alpha=90)
    acc += w
for i, (name, pct, col) in enumerate(segs):
    x = bx + i * 1.19
    text(sl, x, 2.30, 1.10, 0.32, "%d%%" % pct, size=16, color=col, bold=True, font=MONO)
    text(sl, x, 2.64, 1.14, 0.24, name, size=10, color=INK2)
text(sl, bx, 3.04, 5.92, 0.32, "免人工定损；仍有数据、复核与服务成本。", size=13.5, color=AMBER, bold=True)
rect(sl, bx, 3.56, bwall, 0.010, fill=LINE)
text(sl, bx, 3.68, 4.0, 0.24, "三年三情形（保费 / 净利）", size=10, color=INK3, font=MONO, cs=0.04)
yrs = [("第 1 年", "144 万", "-40 ~ -60 万", INK2), ("第 2 年", "2,080 万", "-40 ~ -100 万", CYAN),
       ("第 3 年", "1.12 亿", "+450 ~ 780 万", GREEN)]
for i, (k, rev, prof, col) in enumerate(yrs):
    x = bx + i * 2.00
    text(sl, x, 4.02, 1.90, 0.24, k, size=10, color=INK3, font=MONO)
    text(sl, x, 4.28, 1.90, 0.40, rev, size=21, color=col, bold=True)
    text(sl, x, 4.74, 1.90, 0.24, prof, size=10, color=INK3, font=MONO)
text(sl, bx, 5.24, 5.92, 0.62,
     "盈亏平衡：在保骑手 25–30 万，第 3 年初达成。不碰承保利润，只收科技服务费。",
     size=10, color=INK2, spacing=1.35)
foot(sl)
notes(sl, "【3:20–4:20】60 秒。回答「怎么赚钱」。\n"
          "口播：谁付钱？不是骑手，是平台——它们有合规和舆情压力，一次决策覆盖上万人，边际获客成本趋近于零。"
          "美团今年给 300 万骑手免费投了防暑险，付费习惯已经存在。\n"
          "钱去哪了看这条横条：34% 期望赔付、14% 固定成本，注意这里——定损成本是 0。")

# ==================================================================
# 07 架构
# ==================================================================
sl = page()
head(sl, "四层：数据进来，结论出去，每一步都留痕", "FOUR LAYERS — EVERY STEP LEAVES A TRACE",
     "02 / 技术方案 · 专业深度 20%")
layers = [("L1", "数据层", "公开气象数据（三套数值模式）+ 11 年逐小时历史库",
           "五城 × 96,432 小时 / 城 · 2015-10 → 2026-09", INK2),
          ("L2", "验真层", "跨机构交叉核验，离散度超容差即拒收，拒收本身留痕",
           "±max(2.5mm, 5%) · 至少 2 / 3 同意才认这份读数", CYAN),
          ("L3", "判定层", "五条确定性规则给出赔或不赔；大模型只翻译，不决策",
           "R1–R5 · AI 只写解释，不进哈希、不改结论", AMBER),
          ("L4", "存证层", "规则部署即不可改；输入 / 输出哈希留痕，第三方可复算",
           "2/3 多签治理 · 任何人可拿原始报文重算", GREEN)]
for i, (no, name, main, sub, col) in enumerate(layers):
    y = 1.52 + i * 1.16
    rect(sl, M, y, 7.55, 1.00, fill=CARD, line=LINE)
    rect(sl, M, y, 0.05, 1.00, fill=col)
    text(sl, M + 0.22, y + 0.10, 0.50, 0.24, no, size=10, color=col, bold=True, font=MONO, cs=0.06)
    text(sl, M + 0.86, y + 0.28, 1.45, 0.34, name, size=16, color=WHITE, bold=True)
    text(sl, M + 2.42, y + 0.14, 5.00, 0.26, main, size=11.5, color=INK2)
    text(sl, M + 2.42, y + 0.54, 5.00, 0.26, sub, size=9.5, color=INK3)
text(sl, 8.72, 1.44, 3.6, 0.24, "三条设计决策", size=10, color=INK3, font=MONO, cs=0.06)
dec = [("赔不赔由规则决定，不由模型决定", "责任边界可审计"),
       ("判定快照钉死在同一区块", "窗口滚动不磨掉应赔保单"),
       ("治理是 2/3 多签", "喂价、判定、调价都要两把钥匙")]
for i, (t1, t2) in enumerate(dec):
    y = 1.76 + i * 1.20
    text(sl, 8.72, y, 0.40, 0.24, "0%d" % (i + 1), size=10.5, color=CYAN, bold=True, font=MONO)
    text(sl, 9.14, y - 0.06, 3.50, 0.54, t1, size=12.5, color=WHITE, bold=True, spacing=1.25)
    text(sl, 9.14, y + 0.52, 3.50, 0.30, t2, size=10.5, color=INK3)
rect(sl, 8.72, 5.44, 3.62, 1.14, fill=CARD2, line=None)
text(sl, 8.94, 5.58, 3.2, 0.24, "为什么不是纯中心化", size=10, color=AMBER, bold=True, font=MONO, cs=0.04)
text(sl, 8.94, 5.86, 3.34, 0.60, "链只承重两件事：规则改了查得到、结论重算得出。",
     size=10.5, color=WHITE, spacing=1.35)
foot(sl)
notes(sl, "【4:20–5:10】50 秒。架构页不要逐层念，只讲「哪一层最容易被问倒」。\n"
          "口播：四层，每一层都留痕。验真层是最容易被忽略、也最容易被攻击的一层。\n"
          "右下这句一定要主动说：链不是必需的，纯中心化也能跑。")

# ==================================================================
# 08 验真
# ==================================================================
sl = page()
head(sl, "三个模型互相作证，离群的不上系统", "THREE MODELS CROSS-CHECK — OUTLIERS NEVER GET IN",
     "02 / 技术方案 · 专业深度 20%")
flow = [("STEP 01", "拉取", "三套数值模式逐小时降水\nECMWF / GFS / ICON", INK2),
        ("STEP 02", "对齐", "只在公共日期上比\n「自起点起的累计值」", INK2),
        ("STEP 03", "判一致", "中位数 ± 容差\n至少 2 个同意", CYAN),
        ("STEP 04", "分流", "一致才写入系统\n不一致只留拒收", CYAN)]
for i, (k, name, desc, col) in enumerate(flow):
    x = M + i * 3.00
    rect(sl, x, 1.56, 2.74, 1.50, fill=CARD, line=(col if i >= 2 else LINE), lw=(1.4 if i >= 2 else 1))
    text(sl, x + 0.22, 1.72, 1.4, 0.22, k, size=9, color=col, font=MONO, cs=0.12)
    text(sl, x + 0.22, 1.98, 2.3, 0.32, name, size=15, color=WHITE, bold=True)
    text(sl, x + 0.22, 2.38, 2.34, 0.56, desc, size=10, color=INK2, spacing=1.35)
    if i < 3:
        text(sl, x + 2.76, 2.06, 0.24, 0.26, "›", size=15, color=CYAN, bold=True, font=MONO)
rect(sl, M, 3.26, 5.72, 1.42, fill=CARD, line=LINE)
text(sl, M + 0.24, 3.42, 5.2, 0.22, "容差口径", size=9.5, color=INK3, font=MONO, cs=0.08)
text(sl, M + 0.24, 3.70, 5.24, 0.40, [[("± max( 2.5 mm , 5% × 中位数 )",
                                        {"size": 15, "color": CYAN, "bold": True, "font": MONO})]])
text(sl, M + 0.24, 4.16, 5.24, 0.34, "小量级用绝对容差，大量级用相对容差。", size=10.5, color=INK2)
rect(sl, 6.78, 3.26, 5.74, 1.42, fill=CARD, line=AMBER, lw=1.4)
text(sl, 7.02, 3.42, 5.2, 0.22, "真实发生过：成都那份读数被拒收", size=9.5, color=AMBER, bold=True, font=MONO, cs=0.04)
text(sl, 7.02, 3.72, 5.26, 0.80,
     "三模型离散度超容差 → 不进入系统，只留一条拒收事件。\n「没认这份数据」和「赔了」一样，都可查。",
     size=11, color=WHITE, spacing=1.4)
text(sl, M, 4.98, 5.4, 0.24, "三条必须自己先说的边界", size=10, color=INK3, font=MONO, cs=0.06)
bnd = ["拒收也是动作：不认的数据必须说得出为什么",
       "三模型同经一个聚合接口 —— 是同一供应商下的三套数值模式",
       "落地按《气象信息服务管理办法》换国内已备案源"]
for i, s in enumerate(bnd):
    y = 5.30 + i * 0.50
    rect(sl, M, y + 0.09, 0.08, 0.08, fill=CYAN)
    text(sl, M + 0.24, y, 11.2, 0.40, s, size=11.5, color=INK2)
foot(sl)
notes(sl, "【5:10–6:00】50 秒。技术方案的第一颗钉子。\n"
          "口播：参数化保险最大的风险不是赔多了，是数据本身不可信。三个模型各自算累计值，"
          "只有两个以上落在中位数容差内才认；不认就不上系统。\n"
          "最后三条边界一定要自己说，尤其第二条。")

# ==================================================================
# 09 判定
# ==================================================================
sl = page()
head(sl, "AI 只写解释，赔不赔由规则说了算", "THE LLM EXPLAINS; FIVE RULES DECIDE",
     "02 / 技术方案 · 专业深度 20%")
rules = [("R1", "未达档线", "新增雨量 < 档线", "DENY", INK2),
         ("R2", "数据背离", "与三模型中位数偏离 > 60%", "DENY", INK2),
         ("R3", "支持不足", "落在容差内的模型 < 2 个", "DENY", INK2),
         ("R4", "离散度超标", "模型极差超出容差", "压 confidence", AMBER),
         ("R5", "其余", "以上全部通过", "按档给付", GREEN)]
text(sl, M, 1.44, 0.60, 0.22, "规则", size=9.5, color=INK3, font=MONO, cs=0.04)
text(sl, M + 0.68, 1.44, 1.8, 0.22, "含义", size=9.5, color=INK3, font=MONO, cs=0.04)
text(sl, M + 2.52, 1.44, 2.4, 0.22, "触发条件", size=9.5, color=INK3, font=MONO, cs=0.04)
text(sl, M + 5.30, 1.44, 2.10, 0.22, "结论", size=9.5, color=INK3, font=MONO, cs=0.04, align=PP_ALIGN.RIGHT)
rect(sl, M, 1.70, 7.40, 0.010, fill=LINE)
for i, (no, name, cond, concl, col) in enumerate(rules):
    y = 1.84 + i * 0.80
    text(sl, M, y + 0.04, 0.55, 0.26, no, size=12, color=CYAN, bold=True, font=MONO)
    text(sl, M + 0.68, y, 1.80, 0.30, name, size=12.5, color=WHITE, bold=True)
    text(sl, M + 2.52, y + 0.04, 2.70, 0.26, cond, size=10.5, color=INK2)
    text(sl, M + 5.30, y, 2.10, 0.28, concl, size=11.5, color=col, bold=True, align=PP_ALIGN.RIGHT)
    rect(sl, M, y + 0.62, 7.40, 0.008, fill=LINE)
text(sl, M, 5.98, 7.40, 0.24, "五条规则写在开源代码里，任何一条都能被单独复现。", size=10.5, color=INK3)
rect(sl, 8.62, 1.70, 3.90, 1.52, fill=CARD, line=CYAN, lw=1.4)
text(sl, 8.86, 1.84, 3.4, 0.22, "AI 在这套系统里的位置", size=9.5, color=CYAN, bold=True, font=MONO, cs=0.04)
text(sl, 8.86, 2.12, 3.44, 0.96,
     "只把规则结论翻译成人话。\n不改结论、不进哈希、不承担判定责任，\n也拿不到保单与赔付金额。",
     size=11.5, color=WHITE, spacing=1.42)
rect(sl, 8.62, 3.40, 3.90, 1.26, fill=CARD, line=LINE)
text(sl, 8.86, 3.54, 3.4, 0.22, "confidence 不是统计置信区间", size=9.5, color=AMBER, bold=True, font=MONO, cs=0.04)
text(sl, 8.86, 3.82, 3.44, 0.72,
     "多源一致性自评：模型落在容差内的比例 + 与链上读数的相符度，门槛 60。",
     size=10, color=INK2, spacing=1.35)
rect(sl, 8.62, 4.84, 3.90, 1.02, fill=CARD2, line=None)
text(sl, 8.86, 4.96, 3.4, 0.22, "监管视角", size=9.5, color=AMBER, bold=True, font=MONO, cs=0.04)
text(sl, 8.86, 5.24, 3.44, 0.50, "AI 不做黑箱决策，责任边界清晰、可追溯。", size=11, color=WHITE, spacing=1.3)
foot(sl)
notes(sl, "【6:00–6:45】45 秒。专业深度与合规的交汇点。\n"
          "口播：我们的 AI 不决定赔不赔。赔不赔由这五条规则决定，规则开源，同一份输入永远同一个输出。"
          "AI 只做一件事：把结论翻译成人话。\n"
          "被问「到底用了 AI 吗」→ 用了两处：多源验真、解释文案；绝不用于判定。")

# ==================================================================
# 10 精算
# ==================================================================
sl = page()
head(sl, "统一定价是错的 —— 这是算出来的", "FLAT PRICING IS WRONG, AND WE CAN PROVE IT",
     "02 / 技术方案 · 专业深度 20%")
text(sl, M, 1.42, 7.2, 0.24, "11 年 · 每城 96,432 小时 · 24h 档位加权条件触发率（%）",
     size=9.5, color=INK3, font=MONO, cs=0.04)
cd = CategoryChartData()
cd.categories = ["武汉", "成都", "广州", "上海", "北京"]
cd.add_series("24h 档条件触发率", (4.18, 3.99, 3.81, 2.64, 2.49))
gf = sl.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(M), Inches(1.70),
                         Inches(7.30), Inches(3.10), cd)
ch = gf.chart
ch.has_title = False
ch.has_legend = False
ch.font.size = Pt(10)
ch.font.color.rgb = INK2
ch.font.name = CN
_cs = ch._chartSpace
_chart_el = _cs.find(qn('c:chart'))
_spPr = _cs.find(qn('c:spPr'))
if _spPr is None:
    _spPr = etree.SubElement(_cs, qn('c:spPr'))
    _chart_el.addnext(_spPr)
for _tag in ('a:noFill', 'a:ln'):
    _el = _spPr.find(qn(_tag))
    if _el is not None:
        _spPr.remove(_el)
etree.SubElement(_spPr, qn('a:noFill'))
_ln = etree.SubElement(_spPr, qn('a:ln'))
etree.SubElement(_ln, qn('a:noFill'))
pl = ch.plots[0]
pl.gap_width = 68
pl.has_data_labels = True
dl = pl.data_labels
dl.number_format = '0.00"%"'
dl.number_format_is_linked = False
dl.position = XL_LABEL_POSITION.OUTSIDE_END
dl.font.size = Pt(11)
dl.font.bold = True
dl.font.name = MONO
dl.font.color.rgb = CYAN
sr = pl.series[0]
sr.format.fill.solid()
sr.format.fill.fore_color.rgb = BLUE
sr.format.line.fill.background()
for pi, col in [(0, AMBER), (3, CYAN)]:
    p = sr.points[pi]
    p.format.fill.solid()
    p.format.fill.fore_color.rgb = col
_pa = ch._chartSpace.find(qn('c:chart')).find(qn('c:plotArea'))
_pasp = etree.SubElement(_pa, qn('c:spPr'))
etree.SubElement(_pasp, qn('a:noFill'))
_paln = etree.SubElement(_pasp, qn('a:ln'))
etree.SubElement(_paln, qn('a:noFill'))
va = ch.value_axis
va.maximum_scale = 5.0
va.minimum_scale = 0.0
va.major_unit = 1.0
va.has_major_gridlines = True
va.major_gridlines.format.line.color.rgb = LINE
va.major_gridlines.format.line.width = Pt(0.75)
va.format.line.color.rgb = LINE
va.tick_labels.font.size = Pt(9.5)
va.tick_labels.font.color.rgb = INK3
va.tick_labels.font.name = MONO
ca = ch.category_axis
ca.format.line.color.rgb = LINE
ca.tick_labels.font.size = Pt(10.5)
ca.tick_labels.font.color.rgb = INK2
ca.tick_labels.font.name = CN
ca.major_tick_mark = XL_TICK_MARK.NONE
text(sl, M, 4.92, 7.30, 0.34, "最高与最低差 1.68 倍 —— 统一价必然有一半城市收错钱。",
     size=14, color=WHITE, bold=True)
rect(sl, M, 5.42, 7.30, 1.24, fill=CARD, line=LINE)
text(sl, M + 0.24, 5.56, 6.8, 0.22, "反例实证（口径必须带全）", size=9.5, color=AMBER, bold=True, font=MONO, cs=0.04)
text(sl, M + 0.24, 5.84, 6.80, 0.70,
     "统一价下广州 72h 档赔付率 115.7%。但那是 72h 档、且 95% 下界 9.35% 贴近保本线 —— "
     "只用它证明统一定价会失衡，不当「已经亏了」。",
     size=10, color=INK2, spacing=1.35)
text(sl, 8.42, 1.42, 4.1, 0.24, "定价式", size=9.5, color=INK3, font=MONO, cs=0.04)
rect(sl, 8.42, 1.68, 4.06, 0.78, fill=CARD2, line=None)
text(sl, 8.62, 1.80, 3.70, 0.28,
     [[("P = ⌈(97.5% 上界赔付 + 0.30) ÷ 60%⌉", {"size": 10.5, "color": CYAN, "bold": True, "font": MONO})]])
text(sl, 8.62, 2.14, 3.72, 0.22, "不低于 max(固定成本×1.25, 1.0 元)", size=9, color=INK3)
text(sl, 8.42, 2.62, 4.1, 0.24, "24h 档费率（元 / 份）", size=9.5, color=INK3, font=MONO, cs=0.04)
fee = [["", "平台", "认证", "众包"],
       ["武汉", "1.6", "5.8", "8.8"], ["上海", "1.5", "3.7", "5.3"],
       ["北京", "1.2", "3.5", "5.1"], ["广州", "2.2", "5.5", "7.9"],
       ["成都", "1.4", "5.3", "8.2"]]
cwid = [0.78, 0.92, 1.10, 1.10]
for j, h in enumerate(fee[0]):
    text(sl, 8.42 + sum(cwid[:j]) + 0.02, 2.88, cwid[j] - 0.04, 0.22, h, size=9, color=INK3,
         font=MONO, align=(PP_ALIGN.LEFT if j == 0 else PP_ALIGN.RIGHT))
rect(sl, 8.42, 3.12, sum(cwid), 0.010, fill=LINE)
for i, row in enumerate(fee[1:]):
    yy = 3.20 + i * 0.40
    for j, v in enumerate(row):
        text(sl, 8.42 + sum(cwid[:j]) + 0.02, yy, cwid[j] - 0.04, 0.26, v, size=11,
             color=(INK2 if j == 0 else (AMBER if j == 3 else WHITE)), bold=(j > 0),
             font=(CN if j == 0 else MONO),
             align=(PP_ALIGN.LEFT if j == 0 else PP_ALIGN.RIGHT))
    rect(sl, 8.42, yy + 0.34, sum(cwid), 0.006, fill=LINE)
text(sl, 8.42, 5.42, 4.06, 0.90,
     "40 格 = 5 城 × 2 窗口 × 4 档身份渠道，同城价差 1.9–3.2 倍。义乌暂无样本，兜底 10 元。",
     size=9.5, color=INK3, spacing=1.35)
foot(sl)
notes(sl, "【6:45–7:40】55 秒。专业深度 20% 的主战场。\n"
          "口播：五个城市十一年逐小时降雨，每城 96,432 小时。24 小时档触发率武汉 4.18%、北京 2.49%，"
          "差 1.68 倍——统一价必然有一半城市收错钱。\n"
          "定价式在右上：用 97.5% 上界而不是点估计，除以 60% 赔付率上限，再向上取整。")

# ==================================================================
# 11 创新
# ==================================================================
sl = page(os.path.join(ASSET, "image1.png"), dim=40)
grad(sl, 0, 0, W, 2.40, RGBColor(0x04, 0x0A, 0x14), 88, 0, angle=90)
grad(sl, 0, 5.10, W, 2.40, RGBColor(0x04, 0x0A, 0x14), 0, 82, angle=90)
head(sl, "三个创新，一层叠一层", "THREE LAYERS OF NOVELTY",
     "03 / 创新点 · 创新性 30%")
inv = [("01", "产品层", "把「定损」删掉",
        "参数化早有先例。新的是场景：个人、小额、高频、无凭证的收入中断。",
        "此前的即配骑手收入中断场景，无产品", CYAN),
       ("02", "技术层", "AI 只验真，不判赔",
        "行业里 AI 做核保评分，结论是概率、责任模糊。我们把它关进笼子。",
        "判定 100% 确定性，责任可审计", BLUE),
       ("03", "信任层", "结论可被第三方复算",
        "软肋是「数据你说了算」。我们把原始报文 / 输入 / 输出哈希一起留痕。",
        "把「你信不信我」换成「你自己验」", GREEN)]
for i, (no, tag, title, desc, kick, col) in enumerate(inv):
    x = M + i * 3.96
    rect(sl, x, 1.50, 3.66, 3.90, fill=CARD, line=LINE)
    text(sl, x + 0.26, 1.66, 0.62, 0.30, no, size=12, color=col, bold=True, font=MONO, cs=0.08)
    text(sl, x + 0.86, 1.70, 2.4, 0.24, tag, size=10, color=INK3, font=MONO, cs=0.08)
    text(sl, x + 0.26, 2.06, 3.14, 0.62, title, size=16, color=WHITE, bold=True, spacing=1.2)
    rect(sl, x + 0.26, 2.78, 3.10, 0.008, fill=LINE)
    text(sl, x + 0.26, 2.94, 3.14, 1.10, desc, size=10.5, color=INK2, spacing=1.5)
    text(sl, x + 0.26, 4.18, 0.24, 0.24, "›", size=12, color=col, bold=True, font=MONO)
    text(sl, x + 0.50, 4.16, 2.92, 0.70, kick, size=10.5, color=col, bold=True, spacing=1.35)
    rect(sl, x + 0.26, 5.00, 3.10, 0.008, fill=col)
text(sl, M, 5.66, 11.78, 0.62,
     [[("单看每一条都有先例；三条叠在一起才构成壁垒 —— ", {"size": 15, "color": WHITE, "bold": True}),
       ("因为第三条要求前两条本来就是确定性、可复现的。", {"size": 15, "color": AMBER, "bold": True})]],
     spacing=1.3)
foot(sl)
notes(sl, "【7:40–8:20】40 秒。创新性 30%，这一页是评委的记分卡。\n"
          "口播：我们不主张每条都是原创。但三条之间有因果关系：想做到可复算，就必须先做到判定确定性；"
          "想判定确定，就必须把 AI 从决策位撤下来。\n"
          "禁语：不要说「国内首创」「全球领先」。")

# ==================================================================
# 12 可复算
# ==================================================================
sl = page()
head(sl, "同一份报文，任何人算出来都是同一个结论", "SAME INPUT, SAME HASH — ANYONE, ANYTIME",
     "03 / 创新点 · 创新性 30%")
chain = [("原始报文", "接口返回的 JSON，原样归档"),
         ("SHA-256", "浏览器现算，不经我们的服务器"),
         ("inputHash", "写入时存证，事后改不了"),
         ("R1–R5", "确定性规则，同输入同输出"),
         ("outputHash", "与判定理由分离，各自留痕")]
for i, (t, d) in enumerate(chain):
    y = 1.46 + i * 0.64
    text(sl, M, y + 0.04, 0.44, 0.22, "%02d" % (i + 1), size=9.5, color=CYAN, bold=True, font=MONO, cs=0.06)
    text(sl, M + 0.50, y, 2.02, 0.28, t, size=13, color=(CYAN if i >= 2 else WHITE), bold=True)
    text(sl, M + 2.62, y + 0.03, 2.86, 0.26, d, size=10, color=INK3)
    if i < 4:
        rect(sl, M + 0.50, y + 0.54, 5.00, 0.008, fill=LINE)
text(sl, M, 4.86, 5.66, 0.22, "武汉 84mm 哈希 0xd9c9…4799 = 链上 inputHash",
     size=9, color=INK3, font=MONO, cs=0.02)
rect(sl, M, 5.16, 5.66, 0.008, fill=LINE)
text(sl, M, 5.28, 4.2, 0.22, "名场面：真实数据判「不赔」", size=9.5, color=AMBER, bold=True, font=MONO, cs=0.04)
text(sl, M, 5.54, 5.66, 0.32, "上海 12h：窗口内新增 0 mm，档线 30 mm → 判不赔。", size=12, color=WHITE, bold=True)
text(sl, M, 5.94, 5.66, 0.30, "连「不赔」都能被复算，这才叫可验证。", size=12, color=AMBER, bold=True)
text(sl, 6.66, 1.42, 5.9, 0.24, "v5 核验台 · 8 条断言逐条自证（现网实拍）", size=9.5, color=INK3, font=MONO, cs=0.04)
pic_region(sl, os.path.join(SHOT, "verify.png"), 6.66, 1.68, 5.86, 3.18, cx=0.50, cy=0.45, zoom=1.0)
asserts = ["① 链号 968", "② 字节码 19,864 B", "③ 2/3 多签未暂停", "④ 冷却期 0 秒",
           "⑤ 六个区划码可用", "⑥ 84mm 哈希现算", "⑦ 保单 #0 上海 12h", "⑧ 台账 = 池子"]
for i, a1 in enumerate(asserts):
    x = 6.66 + (i % 2) * 2.94
    y = 5.02 + (i // 2) * 0.34
    text(sl, x, y, 2.84, 0.24, a1, size=9.5, color=INK2)
text(sl, 6.66, 6.48, 5.86, 0.50,
     "第 6 条把原始报文现算成哈希，与链上一致；第 7 条就是那张真保单 —— 全绿，可现场复跑。",
     size=10, color=INK2, spacing=1.35)
foot(sl)
notes(sl, "【8:20–9:05】45 秒。全项目最硬的一页，也是演示环节的入口。\n"
          "口播：参数化最容易被问的是「数据是你们自己的，凭什么信」。我们把原始报文、输入哈希、"
          "输出哈希全部留痕，任何人能重算。我们自己每天也重跑一遍，25 项断言，差一个字节就红。\n"
          "右边这张图是现网实拍，不是设计稿——8 条断言全绿。")

# ==================================================================
# 13 竞争
# ==================================================================
sl = page()
head(sl, "四类玩家，我们站在中间那个空位", "FOUR KINDS OF PLAYERS — WE SIT IN THE GAP",
     "03 / 创新点 · 创新性 30%")
comp = [("传统骑手险", "平台合作意外险 / 三者险", "意外伤害、医疗", "不保收入中断，仍要报案定损"),
        ("平台自保障", "恶劣天气补贴、关怀金", "补贴，不是保险", "无精算、无定价、不可审计"),
        ("国内参数化先例", "广东巨灾险、农业天气指数险", "政企 / 财政", "证明参数触发被监管接受，无个人场景"),
        ("国际参数化玩家", "Arbol / Raincoat / FloodFlash", "B 端资产基建", "赛道有先例，细分需求仍需客户验证")]
for i, (a, b, c, d) in enumerate(comp):
    y = 1.52 + i * 0.90
    rect(sl, M, y, CW, 0.80, fill=(CARD if i % 2 == 0 else None), line=None)
    text(sl, M + 0.22, y + 0.14, 1.95, 0.30, a, size=12.5, color=WHITE, bold=True)
    text(sl, M + 2.26, y + 0.16, 2.95, 0.30, b, size=10.5, color=INK2)
    text(sl, M + 5.34, y + 0.16, 1.95, 0.30, c, size=10.5, color=INK2)
    text(sl, M + 7.42, y + 0.10, 4.34, 0.58, d, size=11, color=(AMBER if i == 2 else WHITE), spacing=1.25)
text(sl, M, 5.46, 3.4, 0.24, "壁垒（按可复制难度）", size=9.5, color=CYAN, bold=True, font=MONO, cs=0.04)
bl = ["11 年城市级精算数据资产", "验真层的工程实现", "可复算的存证体系", "系统已跑通"]
for i, s in enumerate(bl):
    x = M + i * 2.96
    text(sl, x, 5.78, 0.42, 0.24, "0%d" % (i + 1), size=10, color=INK3, bold=True, font=MONO)
    text(sl, x + 0.44, 5.76, 2.46, 0.34, s, size=11.5, color=WHITE, bold=True)
foot(sl)
notes(sl, "【9:05–9:45】40 秒。如果超时，这一页是第一顺位被砍的。\n"
          "口播：传统险不保收入中断，平台补贴不是保险，国内参数化先例都是政企客户，国际玩家做 B 端。"
          "中间这个空位：个人、小额、高频、可自动理赔，目前没人站。")

# ==================================================================
# 14 演示总览
# ==================================================================
sl = page()
head(sl, "接下来 2 分 50 秒，请评委跟我点四下", "2 MIN 50 SEC — FOUR CLICKS, YOU DRIVE",
     "04 / 现场演示 · 展示与答辩 10%")
steps = [("01", "0:00–0:35", "核验台 · 8 条断言", "这八条是它自己从链上读出来算的", CYAN),
         ("02", "0:35–1:40", "骑手端 · 那张真保单", "它判了不赔，理由和哈希都在下面", AMBER),
         ("03", "1:40–2:15", "平台端 · 喂价与台账", "每一分钱对得上，池子够不够赔", BLUE),
         ("04", "2:15–2:40", "现场投保一笔", "价格是链上算出来的，不是我报的", GREEN),
         ("05", "2:40–2:50", "收口 · 回到哈希", "同一份报文，算出来都是这个结论", INK2)]
for i, (no, span, title, line, col) in enumerate(steps):
    y = 1.50 + i * 0.92
    text(sl, M, y + 0.04, 0.50, 0.26, no, size=11.5, color=col, bold=True, font=MONO, cs=0.06)
    text(sl, M + 0.54, y + 0.02, 1.28, 0.24, span, size=9.5, color=INK3, font=MONO)
    text(sl, M + 1.94, y - 0.04, 3.30, 0.32, title, size=14.5, color=WHITE, bold=True)
    text(sl, M + 0.54, y + 0.36, 5.30, 0.26, "「" + line + "」", size=10.5, color=INK2)
    rect(sl, M, y + 0.74, 7.00, 0.008, fill=LINE)
text(sl, 8.15, 1.42, 4.4, 0.24, "四个必须展示的功能", size=9.5, color=CYAN, bold=True, font=MONO, cs=0.04)
feats = [("链上事实自证", "字节码 19,864 B · 2/3 多签 · 6 个区划码，全部现读"),
         ("证据哈希现算", "武汉 84mm 的报文，浏览器现算 = 链上 inputHash"),
         ("真实保单的 DENY", "上海 12h、档线 30mm、基线 172mm、保费 4.20 元"),
         ("台账逐分对齐", "台账合计 = 池子余额 4,958.40 元")]
for i, (t1, t2) in enumerate(feats):
    y = 1.74 + i * 1.02
    rect(sl, 8.15, y, 0.048, 0.72, fill=(CYAN if i % 2 == 0 else BLUE))
    text(sl, 8.40, y - 0.04, 3.90, 0.30, t1, size=12.5, color=WHITE, bold=True)
    text(sl, 8.40, y + 0.28, 3.95, 0.44, t2, size=10.5, color=INK2, spacing=1.3)
text(sl, 8.15, 5.92, 4.30, 0.24, "verify-v5 · rider · console", size=9, color=INK3, font=MONO, cs=0.04)
text(sl, 8.15, 6.20, 4.30, 0.40, "全部是「评委能自己点出来」的。", size=11.5, color=AMBER, bold=True)
foot(sl)
notes(sl, "【9:45–10:10】25 秒。演示前先给地图，评委才知道该看哪里。\n"
          "口播：接下来两分五十秒我不讲 PPT，请您跟我点四个地方。第一个核验台——八条断言它自己读、自己算；"
          "第二个骑手端，看那张真保单和它的不赔记录；第三个平台端，看喂价和台账；最后我现场买一张。")

# ==================================================================
# 15 准备
# ==================================================================
sl = page()
head(sl, "演示前 30 分钟：把不确定性前置", "T-MINUS 30 · REMOVE EVERY UNKNOWN",
     "04 / 现场演示 · 展示与答辩 10%")
prep = ["起本地服务 python -m http.server 8090（终端一关就停）",
        "预开 4 页并各刷新：verify-v5 → rider → console → index-v5",
        "钱包已解锁、网络 968、RDROP 够用、通知弹窗全关",
        "喂价保鲜 < 24h，否则投保 revert「stale feed」",
        "计时器 + 90 秒录屏兜底已打开在备用窗口",
        "1920×1080、浏览器 100%、退出微信与 QQ、共享前试一次"]
for i, s in enumerate(prep):
    y = 1.60 + i * 0.78
    rect(sl, M, y + 0.04, 0.19, 0.19, fill=None, line=CYAN, lw=1.5)
    text(sl, M + 0.36, y - 0.04, 5.40, 0.60, s, size=11.5, color=WHITE, spacing=1.3)
text(sl, 6.95, 1.42, 4.6, 0.24, "逐分钟操作卡", size=9.5, color=INK3, font=MONO, cs=0.06)
ops = [("0:00–0:35", "verify-v5　点「重新核验」"),
       ("0:35–1:40", "rider.html　我的保单 → 理赔记录"),
       ("1:40–2:15", "console.html　六城 / 台账 / 偿付"),
       ("2:15–2:40", "rider.html　投保 12h 一单"),
       ("2:40–2:50", "留在保单页，不切页")]
for i, (t, act) in enumerate(ops):
    y = 1.74 + i * 0.92
    text(sl, 6.95, y, 1.20, 0.24, t, size=9.5, color=CYAN, bold=True, font=MONO)
    text(sl, 8.20, y - 0.06, 4.20, 0.56, act, size=12, color=WHITE, bold=True, spacing=1.3)
    rect(sl, 6.95, y + 0.62, 5.45, 0.008, fill=LINE)
text(sl, 6.95, 6.36, 5.45, 0.30, "全程不念数字，只指位置。", size=11, color=AMBER, bold=True)
foot(sl)
notes(sl, "【10:10–10:25】15 秒，一句话带过。\n"
          "口播：这是演示前的检查单，六项，缺一项我宁可改讲录屏。\n"
          "最容易翻车的是喂价保鲜：MAX_FEED_AGE 是 24 小时，超时投保会直接 revert。")

# ==================================================================
# 16 兜底
# ==================================================================
sl = page()
head(sl, "如果现场出问题，有三级退路", "THREE FALLBACKS, DECLARED UP FRONT",
     "04 / 现场演示 · 展示与答辩 10%")
lv = [("L1", "现场真跑", "正常情况", "按操作卡逐页点", "0 损失", GREEN),
      ("L2", "90 秒录屏", "RPC 超时 / 页面白屏", "3 秒内切备用窗口", "失去「现算」说服力", BLUE),
      ("L3", "静态存证", "断网 / 共享失败", "翻到 P12 讲已存证哈希", "只讲不演", AMBER)]
for i, (no, name, trig, act, cost, col) in enumerate(lv):
    x = M + i * 3.96
    rect(sl, x, 1.50, 3.66, 1.82, fill=CARD, line=(col if i == 0 else LINE), lw=(1.4 if i == 0 else 1))
    text(sl, x + 0.24, 1.64, 0.62, 0.30, no, size=12, color=col, bold=True, font=MONO, cs=0.08)
    text(sl, x + 0.86, 1.66, 2.6, 0.28, name, size=14.5, color=WHITE, bold=True)
    text(sl, x + 0.24, 2.04, 3.20, 0.24, "触发：" + trig, size=9.5, color=INK3)
    text(sl, x + 0.24, 2.32, 3.20, 0.28, act, size=11.5, color=WHITE, bold=True)
    text(sl, x + 0.24, 2.70, 3.20, 0.24, "代价：" + cost, size=9.5, color=col)
    rect(sl, x, 3.30, 3.66, 0.008, fill=col)
rect(sl, M, 3.62, CW, 0.010, fill=LINE)
text(sl, M, 3.76, 5.4, 0.24, "高频故障对照（都是真踩过的）", size=9.5, color=INK3, font=MONO, cs=0.04)
fault = [("页面全白、报 $ 未定义", "本地服务被关掉了", "重开 http.server 刷新"),
         ("数值全是「—」", "RPC 限流或网络抖动", "切热点，只刷新一次"),
         ("投保按钮没反应", "喂价过期超 24 小时", "跳过投保，改讲保单 #0"),
         ("8 条里有 1 条变红", "喂价正在过期", "如实说「这条在过期」")]
for i, (a, b, c) in enumerate(fault):
    y = 4.08 + i * 0.52
    text(sl, M, y, 2.70, 0.28, a, size=10.5, color=WHITE)
    text(sl, M + 2.86, y, 2.55, 0.28, b, size=10.5, color=INK2)
    text(sl, M + 5.55, y, 3.20, 0.28, c, size=10.5, color=AMBER, bold=True)
    rect(sl, M, y + 0.40, 8.75, 0.006, fill=LINE)
rect(sl, 9.86, 3.62, 2.70, 2.44, fill=CARD2, line=None)
text(sl, 10.06, 3.78, 2.34, 0.22, "唯一原则", size=9.5, color=CYAN, bold=True, font=MONO, cs=0.06)
text(sl, 10.06, 4.08, 2.32, 1.80,
     "任何降级都在第一句话里说清：\n「现在网络不稳，我改用录屏，这是同一套系统」。",
     size=10.5, color=WHITE, spacing=1.45)
foot(sl)
notes(sl, "【13:15–13:35】20 秒。建议真的投出来。\n"
          "口播：如果现场网络出问题，我有三级退路：录屏、静态存证，以及直接告诉您「这条正在过期」。"
          "演示失败不扣分，掩饰失败才扣分。")

# ==================================================================
# 17 展望
# ==================================================================
sl = page()
head(sl, "接下来 12 个月：一城跑通，再复制", "NEXT 12 MONTHS — ONE CITY, THEN COPY",
     "05 / 总结与展望")
road = [("试点", "0–12 月", "1 城 · 2 万骑手 · 144 万", "签 1 家平台 + 1 家持牌险企"),
        ("扩展", "12–24 月", "5 城 · 20 万骑手 · 2,080 万", "复制模板；接订单数据补基差"),
        ("规模", "24–36 月", "15 城 · 80 万骑手 · 1.12 亿", "高温 / 台风品类；输出定价系统")]
colw = [1.15, 1.30, 3.30, 6.00]
for i, (a1, b1, c1, d1) in enumerate(road):
    y = 1.50 + i * 0.86
    rect(sl, M, y, CW, 0.78, fill=(CARD if i % 2 == 0 else None), line=None)
    text(sl, M + 0.22, y + 0.10, colw[0], 0.30, a1, size=14, color=WHITE, bold=True)
    text(sl, M + sum(colw[:1]) + 0.20, y + 0.14, colw[1], 0.24, b1, size=10, color=INK3, font=MONO)
    text(sl, M + sum(colw[:2]) + 0.22, y + 0.10, colw[2], 0.30, c1, size=12, color=AMBER, bold=True)
    text(sl, M + sum(colw[:3]) + 0.22, y + 0.14, colw[3], 0.30, d1, size=10.5, color=INK2)
text(sl, M, 4.18, 6.0, 0.24, "同一套引擎，换参数就是新品类", size=9.5, color=INK3, font=MONO, cs=0.04)
cats = ["高温津贴", "台风停工", "空气质量", "物流 / 建筑 / 环卫"]
for i, c in enumerate(cats):
    x = M + i * 1.62
    rect(sl, x, 4.46, 1.50, 0.36, fill=CARD, line=LINE)
    text(sl, x, 4.53, 1.50, 0.24, c, size=9.5, color=WHITE, align=PP_ALIGN.CENTER)
text(sl, M, 5.02, 6.30, 0.56,
     "政策顺风：即时配送已纳入职业伤害保障扩围、2026 年推广全国，与收入保障互补。",
     size=10, color=INK2, spacing=1.35)
rect(sl, 7.10, 4.14, 0.014, 1.56, fill=LINE)
text(sl, 7.36, 4.14, 3.0, 0.24, "三个数收口", size=9.5, color=CYAN, bold=True, font=MONO, cs=0.04)
figs = [("11", "年逐小时回测", CYAN), ("40", "格人民币费率", BLUE), ("0", "次人工定损", AMBER)]
for i, (v, d1, col) in enumerate(figs):
    x = 7.36 + i * 1.66
    text(sl, x, 4.44, 1.50, 0.52, v, size=26, color=col, bold=True, font=MONO)
    text(sl, x, 5.00, 1.54, 0.44, d1, size=9.5, color=INK2, spacing=1.2)
text(sl, 7.36, 5.62, 5.10, 0.70,
     "前两个是护城河；第三个才是这门生意成立的原因 —— 传统险每单要花一次「查」的钱。",
     size=10, color=INK3, spacing=1.4)
foot(sl)
notes(sl, "【13:35–14:30】55 秒。展望不要吹，要给「可验证的下一步」。\n"
          "口播：第一年一个城市两万骑手，把一整个雨季跑完；第二年复制五城；第三年十五城。\n"
          "收口三个数：十一年数据、四十格费率、零次人工定损。")

# ==================================================================
# 18 收尾
# ==================================================================
sl = page(os.path.join(ASSET, "image9.png"), dim=30)
grad(sl, 0, 0, W, H, RGBColor(0x03, 0x08, 0x12), 92, 12, angle=0)
grad(sl, 0, 4.60, W, 2.90, RGBColor(0x03, 0x08, 0x12), 0, 86, angle=90)
text(sl, M, 1.10, 6.4, 0.24, "06 / 团队 · 团队构成与协作 15%", size=9.5, color=CYAN, font=MONO, cs=0.08)
text(sl, M, 1.50, 8.4, 2.30, "下雨这件事，\n不该需要谁来批准才赔。",
     size=38, color=WHITE, bold=True, spacing=1.32)
rect(sl, M, 3.94, 1.80, 0.05, fill=CYAN)
text(sl, M, 4.16, 7.4, 0.34, "把判定、证据和结算，放到任何人可复算的地方。", size=14, color=CYAN, bold=True)
text(sl, M, 4.64, 7.4, 0.70,
     "我们卖的不是保险，是可验证的自动理赔。\n谢谢各位评委；接下来的提问，我可以现场打开系统配合验证。",
     size=11, color=INK2, spacing=1.5)
text(sl, M, 6.52, 6.6, 0.22, "雨证 RainProof · 2026 大学生保险模拟创业大赛 · 保险科技应用赛道",
     size=9, color=INK3, font=MONO)
text(sl, M, 6.80, 6.6, 0.22, "联系人【待填】· 手机【待填】· 邮箱【待填】", size=9, color=INK3, font=MONO)
rect(sl, 8.60, 1.54, 4.04, 4.94, fill=RGBColor(0x05, 0x0B, 0x14), line=LINE, alpha=88)
text(sl, 8.84, 1.74, 3.6, 0.22, "TEAM 神麻", size=9.5, color=CYAN, bold=True, font=MONO, cs=0.10)
team = [("成员 A", "产品定义与系统实现"), ("成员 B", "精算定价与商业测算"), ("成员 C", "保险条款与合规路径")]
for i, (role, duty) in enumerate(team):
    y = 2.10 + i * 1.08
    text(sl, 8.84, y, 0.86, 0.22, role, size=9, color=INK3, font=MONO)
    text(sl, 8.84, y + 0.26, 3.55, 0.28, "【待填姓名 · 院系】", size=12.5, color=WHITE, bold=True)
    text(sl, 8.84, y + 0.62, 3.55, 0.24, duty, size=10, color=INK2)
    rect(sl, 8.84, y + 0.94, 3.56, 0.008, fill=LINE)
text(sl, 8.84, 5.36, 0.86, 0.22, "指导教师", size=9, color=INK3, font=MONO)
text(sl, 8.84, 5.62, 3.55, 0.28, "【待填姓名 · 职称】", size=12.5, color=WHITE, bold=True)
text(sl, 8.84, 5.98, 3.56, 0.40, "跨学科：金融数学 · 计算机 · 保险 / 社保", size=9.5, color=INK2)
notes(sl, "【14:30–15:00】收尾 30 秒，语速放慢，不要赶。\n"
          "口播：最后一句——下雨这件事，不该需要谁来批准才赔。谢谢各位评委。\n"
          "动作：说完停住，不要再补话。团队必须在答辩前换成真人真名。")

prs.save(os.path.join(os.path.dirname(os.path.abspath(__file__)), "雨证-初赛答辩PPT-15min-2026-10-28.pptx"))
print("saved. slides=%d" % len(prs.slides))
