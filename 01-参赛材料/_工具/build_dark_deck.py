# -*- coding: utf-8 -*-
"""在原稿 神麻组-雨证-路演PPT1.pptx 上直接增改：
   - 保留并修缮原有 12 页
   - 插入 7 页（路线 / 保单参数 / 创新 / 市场 / 合规 / 路线图 / 团队）
   - 统一重排章节标与页码（19 页 / 900 秒 / 现场演示 3′00″）
"""
import re, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from dark_lib import (W, H, BG, WHITE, CYAN, BLUE, AMBER, YAHEI, MONO,
                      LEFT, RIGHT, CENTER, MID, TOP,
                      R, BAR, CARD, RULE, VRULE, T, chrome, kicker, notes, retitle, _set_alpha)
from pptx.oxml.ns import qn
from lxml import etree

SRC = os.environ.get("RAINPROOF_DECK_TEMPLATE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "_归档", "神麻组-雨证-路演PPT1.pptx"))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "神麻组-雨证-路演PPT-答辩版-2026-10-28.pptx")

prs = Presentation(SRC)
TOTAL = 19


# ------------------------------------------------------------------ 工具
def shs(sl):
    return list(sl.shapes)

def by_text(sl, sub):
    for s in sl.shapes:
        if s.has_text_frame and sub in s.text_frame.text:
            return s
    raise KeyError(sub)

def kill(sh):
    sh._element.getparent().remove(sh._element)

def run_alpha(run, alpha, size=None):
    """安全设置 run 的透明度（缺 rPr / 缺 solidFill 时自动补）"""
    if size:
        run.font.size = Pt(size)
    rPr = run._r.get_or_add_rPr()
    sf = rPr.find(qn('a:solidFill'))
    if sf is None:
        run.font.color.rgb = WHITE
        sf = rPr.find(qn('a:solidFill'))
    _set_alpha(sf.find(qn('a:srgbClr')), alpha)

def new_slide():
    sl = prs.slides.add_slide(prs.slide_layouts[0])
    for sh in list(sl.shapes):
        kill(sh)
    return sl

sl = list(prs.slides)

# 原稿每页带逐元素入场动画（p:timing），其 spTgt 用形状 id 索引。
# 本次要删改部分形状，残留引用会让 PowerPoint 判定文件损坏 —— 统一移除动画，保留页面切换。
for _s in prs.slides:
    _t = _s._element.find(qn('p:timing'))
    if _t is not None:
        _s._element.remove(_t)

# ================================================================== P01 封面
s = sl[0]
ev = by_text(s, "汉客松 S1")
retitle(ev, "分子实验室 · 2026 大学生保险模拟创业大赛", size=12.25, bold=False, color=CYAN, spc=300)
ev.width = Inches(7.6)

en1 = by_text(s, "Verifiable AI parametric")
en1.top = Inches(3.93)
for p in en1.text_frame.paragraphs:
    for r in p.runs:
        run_alpha(r, 46, 11)

en2 = by_text(s, "Replace")
en2.top = Inches(4.97)
for p in en2.text_frame.paragraphs:
    for r in p.runs:
        run_alpha(r, 46, 11)

# 右下角补一行答辩信息（不压 TEAM）
T(s, 8.62, 6.36, 2.60, 0.20, "初赛答辩 · 15:00 · 演示 3′00″",
  size=9.5, font=MONO, align=RIGHT, wrap=False, alpha=55)

notes(s, "【0:00–0:20】20 秒。\n"
         "口播：各位评委下午好，我们是雨证团队。15 分钟，我只讲一件事 —— 为什么这门生意过去做不成，"
         "以及我们把它做成了可以当场验证的样子。\n"
         "动作：不要念标题，直接说「先看一个人」。停顿 1 秒再翻页。")

# ================================================================== P03 骑手（原 2 页）
s = sl[1]
fn = by_text(s, "美团 2025-06-26 官方口径")
fn.width = Inches(6.35)
for p in fn.text_frame.paragraphs:
    for r in p.runs:
        run_alpha(r, 46, 9.75)

notes(s, "【0:45–1:35】50 秒。\n"
         "口播：暴雨橙色预警那天，他还是出门了 —— 因为不出勤就没有收入。全平台 300 万骑手，"
         "暴雨日收入掉三成左右，而他拿到的赔偿是 0。不是没人愿意赔，是他不知道该找谁。\n"
         "动作：说「0」的时候指第三张卡片，停一秒。这一页不解释技术。")

# ================================================================== P04 账（原 3 页）
s = sl[2]
steps = [("报案", "骑手"), ("查勘", "人"), ("核损", "人"), ("核赔", "人")]
for i, (nm, who) in enumerate(steps):
    x = 0.75 + i * 1.93
    R(s, x, 4.78, 1.66, 0.54, fill=WHITE, alpha=4, line=WHITE, lw=1.0, radius=0.08)
    col = WHITE if i == 0 else AMBER
    T(s, x, 4.78, 1.66, 0.54,
      [(nm, {"size": 12.5, "bold": True, "color": col}),
       ("  " + who, {"size": 9, "color": WHITE, "alpha": 45})],
      align=CENTER, anchor=MID, wrap=False)
    if i < 3:
        T(s, x + 1.66, 4.92, 0.27, 0.24, "→", size=13, font=MONO, color=BLUE, align=CENTER, wrap=False)
T(s, 0.75, 5.42, 8.10, 0.24,
  "后三步都是人工 —— 这笔固定成本与赔款同量级，所以卖一单亏一单。", size=10.5, alpha=55)

notes(s, "【1:35–2:20】45 秒。\n"
         "口播：单次赔几十到几百，但人工报案、查勘、核赔这四步走完，固定成本跟赔款同量级。"
         "所以保险公司的理性选择是不卖 —— 这不是产品问题，是成本结构问题。\n"
         "动作：从左到右划一下这条链，落到「不卖」两个字上。")

# ================================================================== P05 行业（原 4 页）
s = sl[3]

notes(s, "【2:20–2:55】35 秒。\n"
         "口播：AI 加天气，行业里几乎所有人都在做预测 —— ECMWF、GFS、ICON。但预报越准，这款产品越难成立："
         "人人都挑下雨那天来买。所以门槛不在算得准，在谁敢按这个数付钱。\n"
         "动作：说 BUT 之前停半秒，这是全场唯一的转折点。")

T(s, 1.30, 6.10, 10.73, 0.30,
  "所以保单只能「先买、后下雨」—— 判定看的是买入之后的增量，不是当天累计。",
  size=12.5, align=CENTER, wrap=False, alpha=50)

# ================================================================== P06 不问损失（原 5 页）
s = sl[4]
VRULE(s, 4.60, 5.34, 1.28, a=10)
VRULE(s, 8.62, 5.34, 1.28, a=10)

notes(s, "【2:55–3:45】50 秒。\n"
         "口播：所以我们根本不问「你损失了多少」，只看一个公开数字：保单期内这个区域下了多少雨。"
         "五步：投保、喂价、判定、赔付、核验。定损这一环，成本是零。\n"
         "动作：五个 STEP 逐个点一下，说「定损成本接近零」时停一拍。")

# ================================================================== P08 证据（原 6 页）
notes(sl[5], "【4:20–5:05】45 秒。\n"
             "口播：这是链上三条真实事件。保单 #0 上海，链上增量 34 毫米，低于 50 毫米阈值 —— 判 DENY，不赔；"
             "保单 #1 成都模拟 120 毫米 —— PAY；历史回放上海 8 月 9 日，105 毫米 —— PAY。"
             "我们特意留了一条「不赔」在链上：连不赔都能被复算，才叫可验证。\n"
             "动作：先指 DENY 那一条。评委最容易记住的是我们没有藏起不赔的样本。")

# ================================================================== P09 演示（原 7 页）
s = sl[6]
demo_en = by_text(s, "Do not trust this deck")
demo_en.top = Inches(1.045)
live = by_text(s, "LIVE DEMO · BOT CHAIN 677")
live.top = Inches(1.32)
for p in live.text_frame.paragraphs:
    for r in p.runs:
        r.font.size = Pt(11.25)
        rPr = r._r.find(qn('a:rPr'))
        rPr.set('spc', '225')

# 三栏说明改为短句，避免在 0.52 高的框里溢出
for _t in ("五城雨量直读链上（2026-10-08）", "AI 判定与赔付逐条留痕", "武汉 24 小时：保费", "三个面板读的是同一份合约"):
    try:
        kill(by_text(s, _t))
    except KeyError:
        pass
for _x, _w, _d in ((0.75, 4.10, "五城雨量直读链上：北京 39 未到入场线，武汉 67 过第一档，上海 128、广州 162 越第二档；"
                                "成都三模型离散度超差被拒收，只留一条拒收事件。"),
                   (5.02, 3.88, "判定与赔付逐条留痕：968 上是 PAY 94 / 0.0075 BOT，677 是喂价与注池记录。"
                                "每条右侧都能点「核验」跳回链上。"),
                   (9.06, 3.46, "武汉 24 小时：保费 0.00105 BOT、档线 50 / 100 mm —— 三个数都是合约函数返回的。")):
    T(s, _x, 4.50, _w, 0.98, _d, size=10.5, alpha=82, ls=1.42)
T(s, 1.10, 5.88, 11.20, 0.62,
  "三个面板读的是同一份合约。纯静态 HTML，没有后端、没有数据库 —— 浏览器直接向 677 要数："
  "premiumOf(regionId, hours)、thresholdOf(hours, tier)，都不是页面算的。",
  size=11, alpha=84, ls=1.4)

notes(s, "【5:05–5:40】35 秒，然后切浏览器实跑 3 分钟。\n"
         "口播：接下来三分钟我不讲 PPT，请您跟我点三个地方。\n"
         "演示前 30 分钟必须完成：① 起本地服务（python -m http.server 8090，在 05-演示站点/）；"
         "② 预开四个标签页：verify-v5 → rider → console → index-v5；③ 钱包已解锁、网络为测试网、关掉全部通知弹窗；"
         "④ 喂价保鲜 < 24h，否则投保会 revert；⑤ 手机秒表，稿边标 5:40 / 8:40 两个锚点；"
         "⑥ 90 秒录屏已开在备用窗口，3 秒内可切。\n"
         "操作顺序：核验台 8 条断言（35″）→ 骑手端那张真保单与 DENY 记录（60″）→ 控制台账与偿付池（45″）→ "
         "现场投保一笔（30″）→ 停在同一份报文上收口（10″）。\n"
         "兜底：任何一步卡住，立刻切录屏，口播「这段我提前录了一遍，看结论」。绝不当场调试。")

# ================================================================== P10 精算（原 8 页）
notes(sl[7], "【8:40–9:35】55 秒。\n"
             "口播：统一定价是错的。11 年、每城 96,432 小时的历史回测下来，广州按统一价卖 72 小时保单，"
             "赔付率 115.7% —— 收 1 赔 1.16。链上现价从 0.00068 到 0.00105，差 1.5 倍以上。"
             "保费是脚本按公式算出来写进合约的，不是手填的。\n"
             "动作：先指 11.574% 那个数，再指右边那张价目表。这一页对应专业深度 20%。")

# ------------------------------------------------------------------ 谁付钱（原 9 页）
_s9 = sl[8]
for _sh in _s9.shapes:
    if _sh.has_text_frame and "骑手自己不付钱" in _sh.text_frame.text:
        _sh.width = Inches(4.55)
        for _p in _sh.text_frame.paragraphs:
            for _r in _p.runs:
                _r.font.size = Pt(18.5)
            _p.line_spacing = 1.35
    elif _sh.has_text_frame and "单均保费只有千分之几" in _sh.text_frame.text:
        for _p in _sh.text_frame.paragraphs:
            for _r in _p.runs:
                _r.font.size = Pt(11)

# ================================================================== P11 架构（原 11 页，重建）
s = sl[10]
for sh in list(s.shapes):
    kill(sh)
chrome(s, "五层架构与三条硬规则", "Five layers, three hard rules", "04 / ARCHITECTURE", "11 / 19")
kicker(s, 0.75, 1.50, "ARCHITECTURE · 接缝是「哈希」，不是「模型」", size=10.5, spc=180)

layers = [
    ("①", "外部数据层", "Open-Meteo Archive（ERA5 逐小时，11 年回测）· Forecast（ECMWF / GFS / ICON 三模型）",
     "气象灾害预警信号、GB/T 28592—2012 降水量等级 —— HTTP 直连，免费、无需密钥", CYAN),
    ("②", "AI 判定层", "ai-collect 取数 → canonical 确定性哈希 → ai-judge（R1–R5）→ submit-judgment 上链",
     "提交前重算哈希比对，提交后读回校验 6/6 字段一致", CYAN),
    ("③", "共识与结算层", "updateRainfall · rejectFeed · setUnderwriting · submitJudgment · claim · fundPool",
     "Solidity 合约：v1 上 Sepolia 实链（10,758 字节）；v2 在 BOT Chain 968 彩排通过", BLUE),
    ("④", "自动化与证据层", "keeper.js 轮询保单状态，发现可赔即触发；09-AI判定留痕/ 存档每张保单的输入与输出哈希",
     "五套自动化门禁共 229 项断言，含「每条留痕的哈希都能当场重算」", BLUE),
    ("⑤", "产品前端层", "index.html 投保 / 五城降雨看板 / 我的保单；verifier.html 粘交易哈希即解码事件",
     "单文件核验台零依赖，双击即开 —— 前端只读链，不读自家后端", AMBER),
]
for i, (no, name, main, sub, col) in enumerate(layers):
    y = 1.82 + i * 1.04
    CARD(s, 0.75, y, 7.30, 0.94)
    R(s, 0.75, y, 0.045, 0.94, fill=col, alpha=90)
    T(s, 0.98, y + 0.10, 0.34, 0.26, no, size=12, color=col, bold=True, wrap=False)
    T(s, 1.38, y + 0.09, 1.60, 0.28, name, size=13.5, bold=True, wrap=False)
    T(s, 1.38, y + 0.43, 6.45, 0.24, main, size=10, alpha=76, wrap=False)
    T(s, 1.38, y + 0.68, 6.45, 0.22, sub, size=9.0, alpha=48, wrap=False)

kicker(s, 8.30, 1.50, "THREE HARD RULES", size=10.5, spc=180)
rules = [("01", "数据来源单一化", "一个 Open-Meteo 账号体系覆盖降水、气温、风速、空气质量 —— 换险种不必换数据方。"),
         ("02", "哈希是唯一的跨层契约", "inputHash 锁输入、outputHash 锁判定，两者都不含任何会变的字段。"),
         ("03", "写链操作只有一个出口", "一张保单的判定只允许写一次，重复提交会被合约直接拒绝。")]
for i, (no, name, desc) in enumerate(rules):
    y = 1.86 + i * 1.24
    T(s, 8.30, y, 0.32, 0.22, no, size=9.5, font=MONO, color=CYAN, spc=60, wrap=False)
    T(s, 8.70, y - 0.02, 3.80, 0.26, name, size=13, bold=True, wrap=False)
    T(s, 8.70, y + 0.30, 3.86, 0.62, desc, size=10, alpha=62, ls=1.35)

CARD(s, 8.30, 5.06, 4.26, 1.24)
T(s, 8.30, 5.06, 4.26, 1.24,
  "精算与 AI 都可以被替换，只要它们的输入输出能落成同一个可复算的哈希。",
  size=10, alpha=80, ls=1.45, anchor=MID)

notes(s, "【9:35–10:25】50 秒。\n"
         "口播：架构只有一件事值得说 —— 层与层之间传递的不是数据，是哈希。五层里，数据层和 AI 层都可以被替换；"
         "只要输入和输出能落成同一个哈希，整条链路照样成立。右边三条硬规则里，最重要的是第 3 条："
         "一张保单的判定只能写一次。\n"
         "动作：只讲「接缝是哈希」这一句，别逐层念。评委关心的是责任边界，不是目录层级。")

# ================================================================== P19 收尾（原 12 页）
s = sl[11]
retitle(by_text(s, "汉客松 S1"), "分子实验室 · 2026 大学生保险模拟创业大赛", size=12.75,
        bold=False, color=CYAN, spc=300)

# 英文小字与大标题分离，避免叠字
_en = by_text(s, "Rain is data.")
_en.top = Inches(5.34)
for _p in _en.text_frame.paragraphs:
    for _r in _p.runs:
        run_alpha(_r, 36, 10.0)
try:
    kill(by_text(s, "The rules and the evidence"))
except KeyError:
    pass
for _sh in s.shapes:
    if _sh.height is not None and 0 < _sh.height < 30000 and abs(Emu(_sh.top).inches - 5.60) < 0.12:
        _sh.top = Inches(5.66)
by_text(s, "雨证 · RainProof").top = Inches(6.32)
by_text(s, "github.com/juice-butterfly").top = Inches(6.62)

notes(s, "【14:35–15:00】25 秒。\n"
         "口播：雨是数据，判定是代码，付款不需要我们点头。规则和证据都在链上 —— 您自己验。\n"
         "动作：说完这句停住，不要补充。留 2 秒空白再谢场。")

print("原页修订完成：", len(prs.slides))

# ================================================================== 新增 7 页
# ---------------------------------------------------------------- N1 路线
s = new_slide()
chrome(s, "这 15 分钟怎么走", "How the next 15 minutes are spent", "00 / RUN OF SHOW", "02 / 19")
kicker(s, 0.75, 1.52, "RUN OF SHOW · 900 SECONDS", size=10.5, spc=200)

rows = [("00", "开场与路线", "P01–P02", "0:00–0:45", 45, "先给出判断标准"),
        ("01", "问题：不是没人想保，是算不过来", "P03–P05", "0:45–2:55", 130, "可行性 25%"),
        ("02", "方案：把「定损」删掉", "P06–P08", "2:55–5:05", 130, "创新性 30%"),
        ("03", "现场演示", "P09 + 实跑", "5:05–8:40", 215, "展示与答辩 10%"),
        ("04", "技术与创新", "P10–P12", "8:40–11:20", 160, "专业深度 20%"),
        ("05", "商业与合规", "P13–P15", "11:20–13:15", 115, "可行性 25%"),
        ("06", "团队与收束", "P16–P19", "13:15–15:00", 105, "团队 15%")]
for i, (no, name, pages, span, sec, dim) in enumerate(rows):
    y = 1.86 + i * 0.66
    col = CYAN if no in ("03",) else WHITE
    T(s, 0.75, y + 0.03, 0.46, 0.22, no, size=10, font=MONO, color=col, spc=60, wrap=False)
    T(s, 1.28, y - 0.02, 3.30, 0.26, name, size=13, bold=True, wrap=False)
    T(s, 1.28, y + 0.28, 3.40, 0.22, dim, size=9.5, alpha=44, wrap=False)
    T(s, 4.78, y + 0.03, 1.02, 0.22, pages, size=9.0, font=MONO, alpha=38, wrap=False)
    T(s, 5.86, y + 0.02, 1.15, 0.24, span, size=10.5, font=MONO, color=col, wrap=False)
    R(s, 7.06, y + 0.09, sec / 215.0 * 1.34, 0.13, fill=(CYAN if no == "03" else BLUE),
      alpha=70 if no != "03" else 95)
    _lab = ("%d′%02d″" % (sec // 60, sec % 60)) if sec >= 60 else ("%d″" % sec)
    T(s, 8.52, y + 0.03, 0.72, 0.22, _lab, size=8.5, font=MONO, alpha=34, wrap=False)
    RULE(s, 0.75, y + 0.60, 8.39, a=7, h=0.006)

VRULE(s, 9.28, 1.86, 4.42, a=10)
kicker(s, 9.52, 1.86, "SCORING MAP · 100", size=10, spc=180, w=3.0)
sc = [("创新性", 30), ("可行性", 25), ("专业深度", 20), ("团队构成", 15), ("展示与答辩", 10)]
for i, (name, w) in enumerate(sc):
    y = 2.22 + i * 0.62
    T(s, 9.52, y, 1.70, 0.24, name, size=11, wrap=False)
    R(s, 11.18, y + 0.07, w / 30.0 * 0.86, 0.10, fill=CYAN, alpha=55)
    T(s, 12.14, y - 0.01, 0.44, 0.24, "%d" % w, size=11, font=MONO, color=CYAN, align=RIGHT, wrap=False)
T(s, 9.52, 5.62, 3.06, 0.66,
  "不按分数顺序讲：先把问题说清，分数自己会到。", size=10, alpha=52, ls=1.4)

notes(s, "【0:20–0:45】25 秒。\n"
         "口播：路线很简单。前两分半讲问题，两分钟讲方案，然后三分钟现场演示，最后五分钟讲技术与商业。"
         "您手里那张评分表，五个维度我逐项对应。\n"
         "动作：只说 5 个数字（2:10 / 2:10 / 3:35 / 2:40 / 3:35），不要逐行念。")

# ---------------------------------------------------------------- N2 保单六参数
s = new_slide()
chrome(s, "一张保单，六个参数", "One policy, six parameters", "02 / THE POLICY", "07 / 19")
kicker(s, 0.75, 1.50, "POLICY SPEC · 固定规则与可配置参数分别核验", size=10.5, spc=180)

spec = [("01", "城市 · CITY", "6 个区划码", "按城市独立定价，跨城不共享同一档线"),
        ("02", "时长 · WINDOW", "12 h / 24 h", "只用国标时段，不做更长时段的外推"),
        ("03", "档线 · THRESHOLD", "30 / 70 mm", "12h 档；24h 为 50 / 100 mm（GB/T 28592—2012）"),
        ("04", "给付 · PAYOUT", "50% / 75%", "越第一档赔一半，越第二档赔四分之三，单笔封顶"),
        ("05", "单价 · PREMIUM", "3.6–8.8 元", "40 格费率表，按城市 × 时长逐格算，不手填"),
        ("06", "结算 · SETTLE", "外部任务触发", "判定通过后由外部任务领取；无人工定损、无票据")]
for i, (no, name, val, note_) in enumerate(spec):
    x = 0.75 + (i % 3) * 4.19
    y = 1.90 + (i // 3) * 1.94
    CARD(s, x, y, 4.02, 1.78)
    T(s, x + 0.26, y + 0.18, 3.5, 0.20, no, size=9.0, font=MONO, color=CYAN, spc=60, wrap=False)
    T(s, x + 0.26, y + 0.42, 3.5, 0.24, name, size=10.5, alpha=52, spc=40, wrap=False)
    T(s, x + 0.26, y + 0.72, 3.6, 0.44, val, size=25, bold=True, wrap=False)
    T(s, x + 0.26, y + 1.26, 3.52, 0.44, note_, size=9.5, alpha=55, ls=1.35)

T(s, 0.75, 6.06, 8.4, 0.26,
  "价格、区域及运营参数可由多签调整；常量变更须重新部署。", size=15, bold=True, color=CYAN, wrap=False)
T(s, 0.75, 6.44, 8.4, 0.22, "冷静期、暂停与准入影响投保，须核对实时配置。", size=10, alpha=46, wrap=False)
T(s, 9.60, 6.10, 2.98, 0.52,
  "参数是产品的法律边界，不是营销话术。", size=10, alpha=48, align=RIGHT, ls=1.4)

notes(s, "【3:45–4:20】35 秒。\n"
         "口播：把产品拆到最小，就是六个参数：哪个城市、多长时间、雨下到多少、赔多少、卖多少钱、怎么结算。"
         "前五个里五个写死在合约，唯一能改的是价格，而每次改价都要上链并附一条依据哈希。\n"
         "动作：手指依次点 01→06，只说「六个参数」四个字，别逐个念值。")

# ---------------------------------------------------------------- N3 三个创新
s = new_slide()
chrome(s, "三个创新，一层叠一层", "Three layers of innovation, stacked", "04 / INNOVATION", "12 / 19")
kicker(s, 0.75, 1.50, "INNOVATION · 不是三个功能点，是一条因果链", size=10.5, spc=180)

inv = [("01", "产品层", "把「定损」删掉",
        "参数化早有先例。新的是场景：个人 / 小额 / 高频 / 无凭证的收入中断。",
        "传统险的成本结构在这里必亏 —— 删掉定损才有毛利。", CYAN),
       ("02", "技术层", "AI 只验真，不判赔",
        "行业里 AI 做核保评分，结论是概率、责任是模糊的。我们把它关进笼子。",
        "责任边界可审计，才进得了条款报备流程。", BLUE),
       ("03", "信任层", "结论可被第三方复算",
        "原始报文 → SHA-256 → 上链 → 规则 → outputHash，任何人重跑同一个结论。",
        "它要求前两层本来就是确定性、可复现的系统。", AMBER)]
for i, (no, layer, title, new_, hard, col) in enumerate(inv):
    x = 0.75 + i * 3.99
    T(s, x, 1.92, 0.44, 0.24, no, size=11, font=MONO, color=col, spc=60, wrap=False)
    T(s, x + 0.48, 1.94, 1.20, 0.22, layer, size=9.5, font=MONO, alpha=48, spc=120, wrap=False)
    T(s, x, 2.28, 3.62, 0.62, title, size=19, bold=True, ls=1.2, wrap=True)
    RULE(s, x, 3.06, 3.62, a=14)
    T(s, x, 3.22, 3.62, 0.94, new_, size=10.5, alpha=76, ls=1.5)
    T(s, x, 4.30, 3.62, 0.24, "为什么难复制", size=8.5, font=MONO, color=col, spc=150, wrap=False)
    T(s, x, 4.56, 3.62, 0.72, hard, size=10.5, color=col, ls=1.45)

CARD(s, 0.75, 5.52, 11.83, 0.66)
T(s, 0.99, 5.52, 11.35, 0.66,
  "第三条才是壁垒：一套靠「模型判断」的系统永远无法自证；只有确定性系统，才可能被第三方当场复算。",
  size=11.5, alpha=88, ls=1.35, anchor=MID)

notes(s, "【10:25–11:20】55 秒。\n"
         "口播：三个创新不是并列的功能，是一条因果链。第一，把定损删掉 —— 参数化不新，新的是用在个人、小额、"
         "高频、没有凭证的收入中断上；第二，AI 只验真不判赔 —— 因为删掉定损之后，判定必须是确定的；"
         "第三，结论可以被第三方复算 —— 因为判定确定，所以能复算。前两条决定了第三条成立，第三条才是壁垒。\n"
         "动作：讲第三条时手停在最右列，这是 30% 创新分落点。")

# ---------------------------------------------------------------- N4 市场
s = new_slide()
chrome(s, "把 TAM 说小，是故意的", "We keep the TAM deliberately small", "05 / MARKET", "13 / 19")
kicker(s, 0.75, 1.50, "MARKET · 单位：亿元／年 · 只算「会被暴雨打断收入」的那一群人", size=10.5, spc=150)

mkt = [("TAM", "19–26", "亿元／年", "500–700 万骑手 × 250 天 × 1.5 元", 4.30, BLUE),
       ("SAM", "3.6", "亿元／年", "200 万高频骑手 × 120 天 × 1.5 元", 1.72, CYAN),
       ("SOM · 第 3 年", "1.1", "亿元／年", "80 万骑手 × 100 天 × 1.4 元", 0.74, AMBER)]
for i, (k, v, unit, formula, bw, col) in enumerate(mkt):
    y = 1.88 + i * 1.30
    T(s, 0.75, y, 2.10, 0.20, k, size=9.0, font=MONO, alpha=44, spc=100, wrap=False)
    T(s, 0.75, y + 0.20, 1.95, 0.44, v, size=28, font=MONO, bold=True, color=col, wrap=False)
    R(s, 2.58, y + 0.29, bw, 0.16, fill=col, alpha=72)
    T(s, 0.75, y + 0.70, 7.20, 0.22, formula, size=9.5, font=MONO, alpha=40, wrap=False)

VRULE(s, 8.46, 1.86, 4.10, a=10)
kicker(s, 8.70, 1.86, "五条假设 · 全部可替换", size=10, spc=150, w=3.5)
asm = ["骑手规模 500–700 万（美团 300 万 ＋ 蜂鸟 400 万，口径并列不混算）",
       "每城每年因暴雨停工的时数：8–12 天",
       "客单价 1.4–1.5 元／单日",
       "第 3 年渗透率 12%",
       "单城在保规模上限由平台单量决定，不由我们的销售能力决定"]
for i, a in enumerate(asm):
    y = 2.24 + i * 0.64
    T(s, 8.70, y, 0.20, 0.22, "·", size=12, color=CYAN, wrap=False)
    T(s, 8.98, y - 0.02, 3.56, 0.60, a, size=10, alpha=62, ls=1.4)

T(s, 8.70, 5.52, 3.86, 0.66,
  "不给单点估值 —— 参数换一组，结论跟着变，这是这一页唯一的方法论。",
  size=9.5, alpha=42, ls=1.45)
T(s, 0.75, 5.98, 7.4, 0.24,
  "我们只算那一小群：收入会被暴雨打断，且损失能被一个公开数字代表。", size=11, alpha=66, wrap=False)

notes(s, "【11:20–11:55】35 秒。\n"
         "口播：市场我故意说小。全量骑手 500 到 700 万，但不是每个人都会买、也不是每天都下雨。"
         "能被参数化定价、又真的会被打断收入的，第一年只有 2 万人，第三年 80 万人、1.1 亿保费。"
         "五条假设都写在右边，换一组参数，结论跟着变 —— 我们不给单点估值。\n"
         "动作：先指 TAM 再指 SOM，强调「说小是故意的」，这句能加分。")

# ---------------------------------------------------------------- N5 合规
s = new_slide()
chrome(s, "三件必须先说清的事", "Three things to state before you ask", "05 / COMPLIANCE", "15 / 19")
kicker(s, 0.75, 1.50, "COMPLIANCE · 我们不做承保主体", size=10.5, spc=180)

comp = [("01", "谁承保", "我们不做承保主体。前期与持牌险企、保险经纪合作，保单法律关系在持牌方；我们收科技服务费（保费 12–15%）。"),
        ("02", "条款怎么过", "参数化产品的触发口径必须写进条款：城市、时段、档线、数据源、容差、拒收规则；按现行条款费率管理办法报备后销售。"),
        ("03", "算法怎么被检查", "规则确定性、可复现；AI 只生成解释，不进哈希、不改结论；原始报文与哈希留痕，可供监管与第三方抽查。")]
for i, (no, name, desc) in enumerate(comp):
    y = 1.84 + i * 1.02
    R(s, 0.75, y, 0.045, 0.88, fill=CYAN, alpha=85)
    T(s, 0.99, y + 0.04, 0.34, 0.24, no, size=9.5, font=MONO, color=CYAN, spc=60, wrap=False)
    T(s, 1.42, y + 0.02, 2.00, 0.28, name, size=15, bold=True, wrap=False, anchor=MID)
    R(s, 3.52, y, 0.008, 0.88, fill=WHITE, alpha=10)
    T(s, 3.76, y + 0.02, 8.82, 0.88, desc, size=11, alpha=78, ls=1.45)

CARD(s, 0.75, 5.10, 11.83, 1.18)
T(s, 0.99, 5.24, 3.2, 0.22, "还没解决的三个问题（不藏）", size=9.0, font=MONO, color=AMBER, spc=120, wrap=False)
probs = [("基差风险", "城市雨量 ≠ 骑手街道 → 区划码加权，再接订单数据"),
         ("数据源断供", "三模型 + 容差 + 拒收留痕；条款里先约定兜底口径"),
         ("身份核验", "保单绑定骑手地址，由平台批量签发，单骑手不可自证")]
for i, (k, v) in enumerate(probs):
    x = 0.99 + i * 3.92
    T(s, x, 5.50, 3.60, 0.22, k, size=10.5, bold=True, color=AMBER, wrap=False)
    T(s, x, 5.76, 3.62, 0.50, v, size=9.5, alpha=58, ls=1.35)

notes(s, "【12:40–13:15】35 秒。\n"
         "口播：合规我先说三件。第一，我们不做承保主体，保单法律关系在持牌方，我们收科技服务费；"
         "第二，参数化产品的触发口径必须写进条款 —— 城市、时段、档线、数据源、容差、拒收规则，一条都不能少；"
         "第三，AI 不进哈希、不改结论，所以算法责任是清晰的。下面三个问题我们还没完全解决，但都有处置方向。\n"
         "动作：主动念出「还没解决」，评委就不会拿它当杀手问题。")

# ---------------------------------------------------------------- N6 路线图
s = new_slide()
chrome(s, "三年三步，第一年只证一件事", "Three years, three steps", "06 / ROADMAP", "17 / 19")
kicker(s, 0.75, 1.50, "ROADMAP · 数字为假设口径的测算", size=10.5, spc=180)

road = [("试点", "0–12 月", "1 城 · 2 万骑手", "144 万", "签 1 家平台 + 1 家持牌险企，跑通首单闭环"),
        ("扩展", "12–24 月", "5 城 · 20 万骑手", "2,080 万", "复制模板；接平台订单数据补基差"),
        ("规模", "24–36 月", "15 城 · 80 万骑手", "1.12 亿", "加高温 / 台风品类；向险企输出定价系统")]
colw = [1.02, 1.34, 2.62, 1.16, 5.62]
for j, hdr in enumerate(["阶段", "时间", "规模", "年保费", "关键动作"]):
    T(s, 0.99 + sum(colw[:j]), 1.74, 1.8, 0.20, hdr, size=8.5, font=MONO,
      alpha=36, spc=100, wrap=False)
for i, row in enumerate(road):
    y = 1.98 + i * 1.00
    CARD(s, 0.75, y, 11.83, 0.88, alpha=(5 if i == 0 else 3))
    x = 0.99
    T(s, x, y + 0.16, 1.10, 0.28, row[0], size=15, bold=True, wrap=False)
    T(s, x + colw[0], y + 0.30, 1.30, 0.22, row[1], size=10, font=MONO, alpha=48, wrap=False)
    T(s, x + colw[0] + colw[1], y + 0.18, 2.60, 0.26, row[2], size=12, color=CYAN, bold=True, wrap=False)
    T(s, x + colw[0] + colw[1] + colw[2], y + 0.20, 1.20, 0.26, row[3], size=12, font=MONO, color=AMBER, wrap=False)
    T(s, x + sum(colw[:4]), y + 0.22, 5.56, 0.26, row[4], size=10, alpha=72, wrap=False)

kicker(s, 0.75, 5.18, "MILESTONES", size=9.5, spc=180)
ms = [("第 6 月", "首单「判定 → 赔付 → 复算」闭环"), ("第 12 月", "单城赔付率稳定在 60% 以下"), ("第 24 月", "第二险种上线，同一套引擎换参数")]
for i, (k, v) in enumerate(ms):
    x = 0.75 + i * 3.99
    R(s, x, 5.46, 0.032, 0.66, fill=CYAN, alpha=60)
    T(s, x + 0.22, 5.46, 3.30, 0.22, k, size=9.5, font=MONO, color=CYAN, spc=100, wrap=False)
    T(s, x + 0.22, 5.72, 3.52, 0.42, v, size=10.5, alpha=70, ls=1.35)

T(s, 0.75, 6.44, 11.6, 0.22,
  "盈亏平衡：在保骑手 25–30 万，第 3 年初达成。不碰承保利润，只收保费 12–15% 的科技服务费。",
  size=9.5, alpha=42, wrap=False)

notes(s, "【13:40–14:10】30 秒。\n"
         "口播：三年三步。第一年只证一件事 —— 单个城市跑通「判定、赔付、复算」这条闭环，赔付率稳在 60% 以下。"
         "这一步过了，后面只是复制。\n"
         "动作：指第一行的「1 城 · 2 万骑手」，别说 1.12 亿这个数。学生团队说小目标可信，说大目标扣分。")

# ---------------------------------------------------------------- N7 团队
s = new_slide()
chrome(s, "谁在做这件事", "Who is doing this", "06 / TEAM", "18 / 19")
kicker(s, 0.75, 1.50, "TEAM · 三个专业，一条链路", size=10.5, spc=180)

team = [("李卓昊", "中南财经政法大学 · 金融数学 2025", "产品与精算",
         "规则设计、40 格费率表、历史回测；答辩主讲"),
        ("【姓名】", "【学校 · 院系 · 年级】", "工程与合约",
         "合约 v1–v3、keeper 与门禁脚本、留痕体系"),
        ("【姓名】", "【学校 · 院系 · 年级】", "行业与合规",
         "条款口径、报备路径、平台侧商务与试点对接")]
for i, (name, school, role, work) in enumerate(team):
    x = 0.75 + i * 3.99
    CARD(s, x, 1.86, 3.80, 2.02)
    T(s, x + 0.26, 2.04, 3.3, 0.34, name, size=20, bold=True, wrap=False)
    T(s, x + 0.26, 2.44, 3.30, 0.22, school, size=9.5, alpha=50, wrap=False)
    T(s, x + 0.26, 2.80, 3.3, 0.22, role, size=9.0, font=MONO, color=CYAN, spc=150, wrap=False)
    T(s, x + 0.26, 3.10, 3.30, 0.60, work, size=10, alpha=66, ls=1.4)

RULE(s, 0.75, 4.14, 11.83, a=12)
kicker(s, 0.75, 4.24, "WHAT WE HAVE BUILT · 已完成的工程事实", size=9.5, spc=150)
facts = ["合约 v1–v3，Sepolia 与 BOT Chain 双链跑通", "5 个前端页面，纯静态、零后端、只读链",
         "229 项自动化断言，含每条哈希当场重算", "11 年 × 5 城逐小时回测，96,432 小时／城",
         "判定留痕可被第三方复跑，含「不赔」的样本", "从取数到赔付的链上闭环已跑通两条链"]
for i, f in enumerate(facts):
    x = 0.75 + (i % 2) * 6.05
    y = 4.56 + (i // 2) * 0.50
    T(s, x, y, 0.18, 0.22, "·", size=13, color=CYAN, wrap=False)
    T(s, x + 0.24, y + 0.02, 5.60, 0.26, f, size=10.5, alpha=74, wrap=False)

T(s, 0.75, 6.28, 11.6, 0.24,
  "指导教师：【姓名】·【职称】·【单位】　｜　队名：神麻　｜　联系方式：【手机 / 邮箱】",
  size=10, alpha=40, wrap=False)

notes(s, "【14:10–14:35】25 秒。\n"
         "口播：三个人，三个专业：金融数学做规则和定价，工程做合约和门禁，行业做条款和试点对接。"
         "下面这六行不是简历，是我们已经交出来的东西 —— 代码在跑，链上有交易，回测有数据。\n"
         "动作：不要念名字，念「三个专业」和「已经交出来的东西」。名字让评委自己看。")

print("新增页完成：", len(prs.slides))

# 补两条原稿缺备注的页
notes(sl[8], "【11:55–12:40】45 秒。\n"
             "口播：骑手自己不付钱。单均保费只有千分之几 BOT，靠逐单付费撑不起渠道成本。\n"
             "愿意付费的是有合规与舆情压力的一方 —— 平台：一次决策覆盖上万骑手，边际获客成本趋近于零。\n"
             "动作：指「平台 / 众包服务商」那行的「推荐」标；第二阶段保险公司那句一句带过。")
notes(sl[9], "【13:15–13:40】25 秒。\n"
             "口播：回到开头那个骑手。传统意外险看实际受伤与实际损失，要报案、要查勘；我们只看链上降雨量有没有越过档线。\n"
             "贵的不是赔付，是「查」。\n"
             "动作：最后一句放慢，说完立刻翻页，不要停下来解释。")

# ================================================================== 章节标统一
chap = {"02 / THE MATH": "01 / THE MATH",
        "03 / THE INDUSTRY": "01 / THE INDUSTRY",
        "04 / THE TURN": "02 / THE TURN",
        "05 / EVIDENCE": "02 / EVIDENCE",
        "06 / LIVE DEMO": "03 / LIVE DEMO",
        "07 / ACTUARY": "04 / ACTUARY",
        "08 / BUSINESS": "05 / BUSINESS",
        "09 / BACK TO HIM": "06 / BACK TO HIM"}
for _s in prs.slides:
    for _sh in _s.shapes:
        if not _sh.has_text_frame:
            continue
        _t = _sh.text_frame.text.strip()
        if _t in chap:
            _p = _sh.text_frame.paragraphs[0]
            if _p.runs:
                _p.runs[0].text = chap[_t]
                for _r in _p.runs[1:]:
                    _r.text = ""

# ================================================================== 重排顺序
order = [0, 12, 1, 2, 3, 4, 13, 5, 6, 7, 10, 14, 15, 8, 16, 9, 17, 18, 11]
sldIdLst = prs.slides._sldIdLst
ids = list(sldIdLst)
for e in ids:
    sldIdLst.remove(e)
for i in order:
    sldIdLst.append(ids[i])

# ================================================================== 页码统一
for idx, s in enumerate(prs.slides, 1):
    for sh in s.shapes:
        if not sh.has_text_frame:
            continue
        t = sh.text_frame.text.strip()
        if re.fullmatch(r"\d{2}\s*/\s*\d{2}", t):
            new = "%02d / %d" % (idx, TOTAL)
            for p in sh.text_frame.paragraphs:
                for r in p.runs:
                    r.text = new

prs.save(OUT)
print("saved ->", OUT)

# 校验
chk = Presentation(OUT)
print("slides =", len(chk.slides))
for i, s in enumerate(chk.slides, 1):
    ttl = ""
    for sh in s.shapes:
        if sh.has_text_frame and sh.text_frame.text.strip():
            cand = sh.text_frame.text.strip().split("\n")[0]
            if len(cand) > len(ttl) and sh.top is not None and sh.top < 914400:
                ttl = cand
    print("  %02d  %s" % (i, ttl[:40]))
