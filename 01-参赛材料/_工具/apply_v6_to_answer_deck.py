# -*- coding: utf-8 -*-
"""把答辩版 PPT 从 v5 口径更新到 V6（2026-10-29 已部署的实链状态）。

数据全部来自链上实测（2026-10-30 00:00）与 V6 验收文档：
  合约 0xcDe1Bb9b8d61E55e194f18B6836fF1DBd49bC61F · 968
  122 区划 / 244 格价目 / 池子 4,958.40 元 / 保单 0 张 / 领取宽限 604800s
  运行时 22,012 字节 · grid 12h 1.80–6.70、24h 2.40–10.50
  核验台 8/8 · `npm test` 28 组入口 / 596 项断言
只改文本与两张过期截图，版式、字体、配色一律不动。
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.oxml.ns import qn
from dark_lib import T, CARD, R, kicker, RULE, CYAN, BLUE, AMBER, WHITE, YAHEI, MONO, LEFT

HERE = os.path.dirname(os.path.abspath(__file__))
DECK = os.path.join(HERE, "神麻组-雨证-路演PPT-答辩版-2026-10-28.pptx")
IMG_P07 = os.path.join(os.environ["TEMP"], "shot2", "p07_verify.png")
IMG_P08 = os.path.join(os.environ["TEMP"], "shot2", "p08_triple.png")

prs = Presentation(DECK)
assert len(prs.slides) == 19, len(prs.slides)

# (页, 形状序号, 原文, 新文) —— 精确子串替换，命中不到就报错，绝不静默跳过
EDITS = [
    # P06 六参数
    (6, 31, "236 格费率表，按区划 × 时长逐格算，不手填",
            "244 格费率表（122 区划 × 2 档），逐格算，不手填"),

    # P07 三条链上证据
    (7, 7,  "链上成本按 BOT 计价，批量摊薄后每单不足一元",
            "gas 摊薄后每单不足一元"),
    (7, 11, "真实气象数据", "判定留痕 · V5 合约"),
    (7, 12, "买入 172 mm，判定 172 mm；增量 0 mm",
            "买入 172 mm、窗口内增量 0 mm、档线 30 mm"),
    (7, 17, "湖北 118 区划 · 逐条开通", "V6 合约 · 122 区划全量迁移"),
    (7, 18, "118 条注册事件 + 118 条首笔喂价，全部可核验",
            "122 个喂价区划 + 244 格价目逐格可读；迁移基线哈希已上链"),
    (7, 19, "118", "122"),
    (7, 20, "已开通", "已注册"),
    (7, 23, "全池快照 · 2026-10-27", "资金台账 · 2026-10-29"),
    (7, 24, "资金池余额 4,958.40 元，累计赔付 0 笔",
            "注资 + 保费 − 赔付 = 池子 4,958.40 元，逐分对账"),
    (7, 26, "赔付", "差额"),
    (7, 27, "TWO CHAINS · ONE PROCESS", "BOT CHAIN 968 · V6"),
    (7, 30, "不依赖任何在线区块浏览器。",
            "不依赖任何在线区块浏览器 —— V6 八条断言现场全绿。"),

    # P08 现场演示
    (8, 4,  "LIVE DEMO · BOT CHAIN 968 · v5", "LIVE DEMO · BOT CHAIN 968 · V6"),
    (8, 8,  "03 · 投保面板", "03 · 投保入口"),
    (8, 13, "上海 172、武汉 84", "上海 173、武汉 88"),
    (8, 14, "968 上 1 张保单、0 笔赔付，123 个区划每次喂价都可核验。",
            "968 上 0 张保单、0 笔赔付，122 个区划每次喂价都可核验。"),
    (8, 16, "premiumOf(regionId, hours, 0, 0, 1)、entryThresholdOf(hours)",
            "premiumOf(regionId, hours)、thresholdOf(hours, 0)"),

    # P09 定价
    (9, 4,  "11 YEARS · 118 REGIONS", "11 YEARS · 122 REGIONS"),
    (9, 11, "968 v5 · 24h 档", "968 V6 · 24h 档"),

    # P10 架构
    (10, 24, "Solidity 合约：v5 在 BOT Chain 968 实链运行，123 个区划全部开通",
             "Solidity 合约：V6 在 BOT Chain 968 实链运行，122 个区划全部开通"),
    (10, 30, "24 组自动化门禁，含「每条留痕的哈希都能当场重算」",
             "28 组门禁、596 项断言，含「每条留痕的哈希都能当场重算」"),
    (10, 35, "index-v5.html 投保与看板 / rider.html 保单 / console.html 台账 / verify-v5.html 核验",
             "insurance.html 落地 / index-v6.html 看板 / console.html 台账 / verify-v6.html 核验"),

    # P13 付费方（该段被拆成三个 run，"BOT" 单独一段）
    (13, 7, "单均保费只有千分之几", "单均保费只有几元"),
    (13, 7, " BOT", ""),

    # P15 对比
    (15, 11, "（v5 · 24h 档 50 / 100 mm）", "（V6 · 24h 档 50 / 100 mm）"),

    # P17 团队
    (17, 11, "规则设计、236 格费率表、历史回测；答辩主讲",
             "规则设计、244 格费率表、历史回测；答辩主讲"),
    (17, 16, "合约 v1–v5、keeper 与门禁脚本、留痕体系",
             "合约 v1–V6、keeper 与门禁脚本、留痕体系"),
    (17, 25, "合约 v1–v5，Sepolia 与 BOT Chain 968 跑通",
             "合约 v1–V6，BOT Chain 968 跑通"),
    (17, 27, "保险赛导览 + v5 页面，模拟资金、只读核验",
             "保险赛导览 + V6 页面，模拟资金、只读核验"),
    (17, 29, "24 组自动化门禁，含每条哈希当场重算",
             "28 组门禁、596 项断言，含每条哈希当场重算"),
    (17, 31, "11 年逐小时回测：5 城各 96,432 小时；湖北 118 区划全量定价",
             "11 年逐小时回测：5 城各 96,432 小时；122 区划 244 格全量定价"),

    # P18 收尾
    (18, 10, "演示站默认读 BOT Chain 968 · v5", "演示站默认读 BOT Chain 968 · V6"),
]

fails = []
for pi, si, old, new in EDITS:
    sh = prs.slides[pi].shapes[si]
    hit = False
    for p in sh.text_frame.paragraphs:
        for r in p.runs:
            if old in r.text:
                r.text = r.text.replace(old, new)
                hit = True
    if not hit:
        fails.append((pi, si, old))

if fails:
    print("!! 未命中，终止：")
    for f in fails:
        print("   ", f)
    raise SystemExit(1)
print(f"文本替换完成：{len(EDITS)} 处")


# ---------------------------------------------------------------- 换图
def swap_image(slide, idx, path):
    pic = None
    for sh in slide.shapes:
        try:
            if sh.shape_type == 13 and sh.name == idx:
                pic = sh
        except Exception:
            pass
    assert pic is not None, f"找不到图片 {idx}"
    blip = pic._element.blipFill.blip
    rId = blip.rEmbed if hasattr(blip, "rEmbed") else blip.get(qn("r:embed"))
    part = slide.part.related_part(rId)
    part._blob = open(path, "rb").read()
    print("  换图:", idx, "->", os.path.basename(path), f"{os.path.getsize(path)//1024}KB")


swap_image(prs.slides[7], "图片 273", IMG_P07)
swap_image(prs.slides[8], "image9.png", IMG_P08)


# ---------------------------------------------------------------- P13 单位经济
# 右侧三张买家卡片在 y=302 结束，下方 315–495 是空白带
sl13 = prs.slides[13]
kicker(sl13, 5.20, 4.40, "UNIT ECONOMICS · 每一元保费的去向（平台团体价口径）", color=CYAN, size=10.5)

UNITS = [
    ("34%", "期望赔付", "0.742 ÷ 2.2", AMBER),
    ("14%", "固定成本", "出单/结算/存证", WHITE),
    ("15%", "再保 + 准备", "雨季前前置", WHITE),
    ("25%", "渠道与运营", "平台通道费", WHITE),
    ("12%", "科技毛利", "不碰承保利润", CYAN),
]
x0, step = 5.20, 1.44
for i, (val, label, note, color) in enumerate(UNITS):
    x = x0 + i * step
    T(sl13, x, 4.66, 1.36, 0.20, label, size=10, color=WHITE, alpha=55, wrap=False)
    T(sl13, x, 4.86, 1.36, 0.40, val, size=25, color=color, font=MONO, bold=True, wrap=False)
    T(sl13, x, 5.28, 1.36, 0.18, note, size=8.5, color=WHITE, alpha=42, wrap=False)

RULE(sl13, 5.20, 5.55, 7.20, a=8)
T(sl13, 5.20, 5.66, 7.30, 0.20,
  "三条安全边际：97.5% 上界（不是点估计）· 向上取整 · 赔付率红线 60%　｜　"
  "Y3 覆盖 80 万骑手时保费约 1.1 亿元",
  size=9.5, color=WHITE, alpha=55, wrap=False)

# ---------------------------------------------------------------- P12 竞争位形
# 底部 y=455 以后空白（正文末行在 431–448）
sl12 = prs.slides[12]
T(sl12, 0.75, 6.32, 11.85, 0.22, [
    ("竞争位形　", {"color": CYAN, "font": MONO, "size": 9.5}),
    ("传统骑手意外险不保收入中断　·　平台恶劣天气补贴不是保险（无精算、不可审计）　·　"
     "广东巨灾指数保险证明参数触发已被监管接受，但没有个人小额高频场景　·　"
     "Arbol / Raincoat / FloodFlash 佐证赛道成熟　→　", {"color": WHITE, "size": 9.5, "alpha": 55}),
    ("空白就在我们这一格", {"color": AMBER, "size": 9.5, "bold": True}),
], wrap=False)

prs.save(DECK)
print("已保存:", DECK)
