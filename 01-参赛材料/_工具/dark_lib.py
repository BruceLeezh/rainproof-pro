# -*- coding: utf-8 -*-
"""雨证 · 深色路演稿 —— 样式库
复刻 神麻组-雨证-路演PPT1.pptx 的视觉体系：底色 #0A1422 / 蓝青渐变竖条 /
微软雅黑标题 27pt / Consolas 标签 / 白色 4% 圆角卡片。
"""

from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from pptx.oxml import parse_xml
from pptx.oxml.ns import qn, nsdecls
from lxml import etree

W, H = 13.333, 7.5

BG    = RGBColor(0x0A, 0x14, 0x22)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
CYAN  = RGBColor(0x22, 0xD3, 0xEE)
BLUE  = RGBColor(0x2D, 0x7F, 0xF9)
AMBER = RGBColor(0xF5, 0xA5, 0x24)

YAHEI = "微软雅黑"
MONO  = "Consolas"

LEFT, RIGHT, CENTER = PP_ALIGN.LEFT, PP_ALIGN.RIGHT, PP_ALIGN.CENTER
MID = MSO_ANCHOR.MIDDLE
TOP = MSO_ANCHOR.TOP


# ---------------------------------------------------------------- 基础图形
def _set_alpha(clr, alpha):
    for old in clr.findall(qn('a:alpha')):
        clr.remove(old)
    e = etree.SubElement(clr, qn('a:alpha'))
    e.set('val', str(int(alpha * 1000)))


def R(sl, x, y, w, h, fill=None, alpha=100, line=None, lw=1.0, radius=None):
    """矩形 / 圆角矩形。fill=None 为无填充。"""
    st = MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE
    sp = sl.shapes.add_shape(st, Inches(x), Inches(y), Inches(w), Inches(h))
    sp.shadow.inherit = False
    if radius:
        try:
            sp.adjustments[0] = radius
        except Exception:
            pass
    spPr = sp._element.spPr
    if fill is None:
        sp.fill.background()
    else:
        sp.fill.solid()
        sp.fill.fore_color.rgb = fill
        if alpha < 100:
            _set_alpha(spPr.find(qn('a:solidFill')).find(qn('a:srgbClr')), alpha)
    if line is None:
        sp.line.fill.background()
    else:
        sp.line.color.rgb = line
        sp.line.width = Pt(lw)
        if alpha < 100:
            ln = spPr.find(qn('a:ln'))
            _set_alpha(ln.find(qn('a:solidFill')).find(qn('a:srgbClr')), alpha)
    sp.text_frame.word_wrap = False
    return sp


def BAR(sl):
    """页眉的蓝→青渐变竖条（与母本一致：2D7FF9 → 22D3EE，45°）"""
    sp = sl.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.75), Inches(0.5732),
                             Inches(0.0417), Inches(0.3125))
    sp.shadow.inherit = False
    sp.line.fill.background()
    spPr = sp._element.spPr
    xml = ('<a:gradFill %s rotWithShape="1"><a:gsLst>'
           '<a:gs pos="0"><a:srgbClr val="2D7FF9"/></a:gs>'
           '<a:gs pos="100000"><a:srgbClr val="22D3EE"/></a:gs>'
           '</a:gsLst><a:lin ang="2700000" scaled="1"/></a:gradFill>') % nsdecls('a')
    new = parse_xml(xml)
    old = spPr.find(qn('a:solidFill'))
    if old is not None:
        old.addprevious(new)
        spPr.remove(old)
    else:
        spPr.append(new)
    return sp


def CARD(sl, x, y, w, h, fill=WHITE, alpha=4, line=WHITE, la=8, lw=1.0, radius=0.054):
    return R(sl, x, y, w, h, fill=fill, alpha=alpha, line=line, lw=lw, radius=radius)


def RULE(sl, x, y, w, a=10, h=0.008, color=WHITE):
    return R(sl, x, y, w, h, fill=color, alpha=a)


def VRULE(sl, x, y, h, a=12, w=0.008, color=WHITE):
    return R(sl, x, y, w, h, fill=color, alpha=a)


# ---------------------------------------------------------------- 文本
def T(sl, x, y, w, h, content, size=12, color=WHITE, font=YAHEI, bold=False,
      spc=None, align=LEFT, ls=1.25, anchor=TOP, wrap=True, alpha=None):
    """content: 字符串 / (文本, 选项) / [run,...]（单段） / [[run,...], ...]（多段）"""
    box = sl.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame
    tf.word_wrap = wrap
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    try:
        tf.auto_size = None
    except Exception:
        pass

    if isinstance(content, str):
        paras = [[(content, {})]]
    elif isinstance(content, tuple):
        paras = [[content]]
    elif isinstance(content, list) and content and isinstance(content[0], tuple):
        paras = [content]
    elif isinstance(content, list) and content and isinstance(content[0], list):
        paras = content
    else:
        paras = [[(str(content), {})]]

    for i, para in enumerate(paras):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.line_spacing = ls
        if align is not None:
            p.alignment = align
        for text, opt in para:
            r = p.add_run()
            r.text = text
            f = r.font
            f.size = Pt(opt.get('size', size))
            f.bold = opt.get('bold', bold)
            f.italic = opt.get('italic', False)
            f.color.rgb = opt.get('color', color)
            f.name = opt.get('font', font)
            rPr = r._r.get_or_add_rPr()
            rPr.set('lang', 'zh-CN')
            sp = opt.get('spc', spc)
            if sp is not None:
                rPr.set('spc', str(int(sp)))
            al = opt.get('alpha', alpha)
            if al is not None:
                clr = rPr.find(qn('a:solidFill')).find(qn('a:srgbClr'))
                _set_alpha(clr, al)
            latin = rPr.find(qn('a:latin'))
            ea = rPr.find(qn('a:ea'))
            if ea is None and latin is not None:
                ea = etree.SubElement(rPr, qn('a:ea'))
                latin.addnext(ea)
            if ea is not None:
                ea.set('typeface', f.name)
    return box


def retitle(sh, text, size=27, bold=True, color=WHITE, font=YAHEI, ls=1.15, spc=None, alpha=None):
    """原地替换文本框内容，保留原几何与层级"""
    tf = sh.text_frame
    for p in list(tf.paragraphs)[1:]:
        p._p.getparent().remove(p._p)
    p = tf.paragraphs[0]
    for r in list(p.runs):
        r._r.getparent().remove(r._r)
    p.line_spacing = ls
    box = tf
    x, y, w, h = sh.left, sh.top, sh.width, sh.height
    # 用统一接口重写，避免直接操作 run
    sl = None
    r = p.add_run()
    r.text = text
    f = r.font
    f.size = Pt(size)
    f.bold = bold
    f.color.rgb = color
    f.name = font
    rPr = r._r.get_or_add_rPr()
    rPr.set('lang', 'zh-CN')
    if spc is not None:
        rPr.set('spc', str(int(spc)))
    if alpha is not None:
        _set_alpha(rPr.find(qn('a:solidFill')).find(qn('a:srgbClr')), alpha)
    latin = rPr.find(qn('a:latin'))
    ea = etree.SubElement(rPr, qn('a:ea'))
    ea.set('typeface', font)
    latin.addnext(ea)
    return sh


# ---------------------------------------------------------------- 页框
def chrome(sl, title, en=None, chapter=None, num=None, title_size=27):
    R(sl, 0, 0, W, H, fill=BG)
    BAR(sl)
    T(sl, 1.00, 0.395, 10.6, 0.52, title, size=title_size, bold=True, wrap=False, ls=1.12)
    if en:
        T(sl, 1.00, 1.045, 9.4, 0.24, en, size=12, font=MONO, wrap=False, alpha=52)
    if chapter:
        T(sl, 9.30, 0.615, 3.03, 0.22, chapter, size=12, font=MONO,
          spc=150, align=RIGHT, wrap=False, alpha=34)
    if num:
        T(sl, 11.10, 6.99, 1.22, 0.20, num, size=11.25, font=MONO,
          align=RIGHT, wrap=False, alpha=40)


def kicker(sl, x, y, text, color=CYAN, size=11.25, spc=225, w=6.0):
    return T(sl, x, y, w, 0.20, text, size=size, font=MONO, color=color,
             spc=spc, wrap=False)


_NOTES_SP = (
    '<p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
    '<p:nvSpPr><p:cNvPr id="9" name="Notes Placeholder"/>'
    '<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>'
    '<p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>'
    '<p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>')


def notes(sl, text):
    """写入演讲者备注；母本没有备注占位符时先补一个 body 占位符"""
    ns = sl.notes_slide
    tf = ns.notes_text_frame
    if tf is None:
        ns.shapes._spTree.append(parse_xml(_NOTES_SP))
        for sh in ns.shapes:
            if sh.is_placeholder and sh.placeholder_format.idx == 1:
                tf = sh.text_frame
                break
    tf.text = text
    for p in tf.paragraphs:
        p.line_spacing = 1.35
        for r in p.runs:
            r.font.size = Pt(11)
            r.font.name = YAHEI
