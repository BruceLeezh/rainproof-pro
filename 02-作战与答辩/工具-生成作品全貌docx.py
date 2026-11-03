# -*- coding: utf-8 -*-
"""生成《雨证作品全貌》Word 总说明（python-docx 版）。
数据来源：运行时读取 10-金融与定价/ 的最新输出（.pe-live.json 为引擎进程内重算结果，
actuary-output.json/summary.json/conditional-risk.json 为 2026-11-03 最新生成），
链上事实为 2026-11-03 现场读数快照。
运行：python 02-作战与答辩/工具-生成作品全貌docx.py
"""
import json
import os
import pathlib

from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIN = ROOT / "10-金融与定价"
CN_FONT = "Microsoft YaHei"

# ---------------- 数据加载 ----------------
# 先让 v3 引擎在进程内重算并把最新 JSON 落到 .pe-live.json（保证"以最新版为准"）
import subprocess
_live = ROOT / "02-作战与答辩" / ".pe-live.json"
subprocess.run(
    ["node", "-e",
     "const {main}=require('./10-金融与定价/pricing_engine.js');"
     "require('fs').writeFileSync('02-作战与答辩/.pe-live.json',JSON.stringify(main({write:false})));"],
    cwd=str(ROOT), check=True,
)
pe = json.loads(_live.read_text(encoding="utf-8"))
v1 = json.loads((FIN / "actuary-output.json").read_text(encoding="utf-8"))
pn = json.loads((FIN / "pricing-next" / "summary.json").read_text(encoding="utf-8"))
cr = json.loads((FIN / "pricing-next" / "conditional-risk.json").read_text(encoding="utf-8"))

FIVE = [("beijing", "北京"), ("shanghai", "上海"), ("guangzhou", "广州"), ("chengdu", "成都"), ("wuhan", "武汉")]
SEG = {"t0c0": "众包自助（基准）", "t1c0": "认证骑手·自助", "t1c1": "认证骑手·平台代付", "t2c1": "平台团体"}

# ---------------- docx helpers ----------------
doc = Document()
sec = doc.sections[0]
sec.page_width, sec.page_height = Cm(21.0), Cm(29.7)
sec.top_margin = sec.bottom_margin = Cm(2.2)
sec.left_margin = sec.right_margin = Cm(2.2)

for st in ("Normal", "Heading 1", "Heading 2", "Heading 3", "List Bullet"):
    if st in doc.styles:
        s = doc.styles[st]
        s.font.name = CN_FONT
        rpr = s.element.get_or_add_rPr()
        rf = rpr.find(qn("w:rFonts"))
        if rf is None:
            rf = OxmlElement("w:rFonts")
            rpr.append(rf)
        rf.set(qn("w:eastAsia"), CN_FONT)
doc.styles["Normal"].font.size = Pt(10.5)


def _fmt(par, size=None, bold=None, color=None, italic=None):
    for run in par.runs:
        run.font.name = CN_FONT
        rpr = run._element.get_or_add_rPr()
        rf = rpr.find(qn("w:rFonts"))
        if rf is None:
            rf = OxmlElement("w:rFonts")
            rpr.append(rf)
        rf.set(qn("w:eastAsia"), CN_FONT)
        if size:
            run.font.size = Pt(size)
        if bold is not None:
            run.font.bold = bold
        if italic is not None:
            run.font.italic = italic
        if color:
            run.font.color.rgb = RGBColor.from_string(color)
    return par


def H1(t):
    p = doc.add_heading(t, level=1)
    _fmt(p, 16, True, "1F3864")
    p.paragraph_format.space_before = Pt(10)
    p.paragraph_format.space_after = Pt(6)


def H2(t):
    p = doc.add_heading(t, level=2)
    _fmt(p, 13, True, "2E5395")
    p.paragraph_format.space_after = Pt(4)


def H3(t):
    p = doc.add_heading(t, level=3)
    _fmt(p, 11.5, True, "444444")
    p.paragraph_format.space_after = Pt(3)


def P(t, size=10.5, bold=False, color=None, align=None, italic=False):
    p = doc.add_paragraph()
    r = p.add_run(t)
    _fmt(p, size, bold, color, italic)
    if align == "center":
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.line_spacing = 1.25
    return p


def NOTE(t):
    P(t, 8.5, False, "777777", italic=True)


def FORMULA(t):
    P(t, 10.5, True, "1F3864", align="center")


def BUL(lead, rest):
    p = doc.add_paragraph(style="List Bullet")
    r1 = p.add_run(lead)
    r2 = p.add_run(rest)
    _fmt(p, 10.5)
    r1.font.bold = True
    p.paragraph_format.space_after = Pt(3)


def shade(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), fill)
    tc_pr.append(shd)


def TBL(headers, rows, widths_cm, size=8.5):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    for i, h in enumerate(headers):
        c = t.rows[0].cells[i]
        c.width = Cm(widths_cm[i])
        c.text = ""
        p = c.paragraphs[0]
        r = p.add_run(h)
        _fmt(p, size, True)
        shade(c, "DEEAF6")
    for row in rows:
        cells = t.add_row().cells
        for i, val in enumerate(row):
            cells[i].width = Cm(widths_cm[i])
            cells[i].text = ""
            p = cells[i].paragraphs[0]
            r = p.add_run(str(val))
            _fmt(p, size)
    P("", 4)
    return t


def KVP(pairs, w1=4.6, w2=11.4):
    TBL(["项目", "数值 / 说明"], pairs, [w1, w2])


# ================= 数据整理 =================
seg_rows = []
for key, cn in FIVE:
    rows = [c for c in pe["cells"] if c["regionKey"] == key and c["hours"] == 24][:4]
    for r in rows:
        seg_rows.append([cn, SEG.get(r["segKey"], r["segKey"]), f'{r["pointRatePct"]:.3f}%', f'{r["upperRatePct"]:.3f}%', str(r["premiumRetailEth"])])

band_rows = []
for b in pe["batchBands"][:6]:
    band_rows.append([b["bandIndex"], f'≤ {b["NMax"]}' if b.get("NMax") else "—", f'{b["discountBps"]/100:.2f}%'])

v1_rows = []
for key, cn in FIVE:
    w = v1["regions"][key]
    win = w["windows"]["24"]
    v1_rows.append([cn, f'{w["hours"]:,}', f'{win["windows"]:,}', win["hits"], f'{win["p"]*100:.4f}%', f'{win["maxMm"]} mm'])

cr_rows = []
for city in cr["cities"]:
    for p in city["products"]:
        cr_rows.append([city["name"], p["product"], f'{p["unconditionalPct"]}%', f'{p["legacyNoT1_multiplierVsUncond"]}×', f'{p["rainBuyMultiplierVsUncond"]}×', f'{p["t1RemovalPct"]}%'])

annual = pn.get("annualIllustration", {})
sc_rows = [[f'{s["policies"]:,} 单', f'{s["expectedProfitYuan"]:+.2f} 元'] for s in annual.get("scenarios", [])]

# ================= 正文 =================
P("雨证 RainProof · 作品全貌总说明", 24, True, "1F3864", align="center")
P("底层逻辑 · 区块链 · 精算与定价 —— 全部数字，全部可复核", 13, False, "555555", align="center")
P("版本：2026-11-03 ｜ 本文由脚本直接读取四个模型的最新输出与当日链上现场读数汇编", 8.5, False, "777777", align="center")
P("复核原则：文中每个数字都标注来源（命令 / 文件）。拿同一份输入重跑同一命令，应得到同一结果。", 8.5, False, "777777", align="center")
P("")

H1("0. 一页速览：十二个关键数字")
TBL(["#", "数字", "含义", "来源"], [
    ["1", "BOT Chain 968 · 合约 0xcDe1…C61F", "模拟链上唯一的保单与资金入口", "deployment.json + premiumOf 实读"],
    ["2", "122 区划 · 244 价格格", "湖北 122 个行政区划 × 12h/24h 两档，逐格定价", "regionCount() / PremiumSet 事件"],
    ["3", "池子 4,958.40 元 · 保单 0 张", "模拟资金、零真实保单（刻意保持的演示口径）", "poolBalance() / preflight.js"],
    ["4", "档线 12h 30/70 mm · 24h 50/100 mm", "国标 GB/T 28592—2012 唯二时段", "entryThresholdOf() / 合约常量"],
    ["5", "给付基数 100 元 · 50% / 75%", "越第一档赔 50 元，越第二档赔 75 元", "tierBps() / 合约常量"],
    ["6", "链上单价 1.8 – 10.5 元（极差 4.4×）", "244 格实测区间：竹山 1.8 → 汉南 10.5", "premiumOf 244 格全量扫描（当日）"],
    ["7", "ERA5 11 年 × 5 城 × 96,432 小时", "全部触发概率的数据底座（2015-10 → 2026-09）", "cache/*.json + audit_numbers"],
    ["8", "三模型喂价 · 30 分钟一轮", "ECMWF / GFS / ICON 交叉，容差 max(2.5, 5%×中位)", "push-rainfall-v6.js / 留痕 JSON"],
    ["9", "门禁 29 组 · 642 项断言全绿", "+精算自检 509 项 + 权威值 22 项", "npm test（当日 EXIT=0）"],
    ["10", "定价研究 11,712 单元 · 1.50–10.60 元", "122 区划 × 12 月 × 4 起保时点 × 2 时长", "pricing-next/summary.json"],
    ["11", "独立测试回放 711,748 窗口 · +1.1182 元/窗口", "近两年测试集按训练定价回放（含列明费用）", "方法与复算.md §7"],
    ["12", "雨中投保残余 ×1.7–4.2（T+1 削减 31.6–66%）", "时间维度逆选择的量化残余（11 年实算）", "conditional-risk.json"],
], [0.7, 4.2, 6.6, 4.5])
doc.add_page_break()

# ---------- 1 底层逻辑 ----------
H1("1. 底层逻辑：这个产品为什么成立")
H2("1.1 问题：不是没人想保，是算不过来")
P("外卖骑手在暴雨天照常出勤，因为停勤就没有收入；而传统保险对这类「个人 / 小额 / 高频 / 无凭证」的收入中断风险，查一次的成本与赔一次的钱同量级——保险公司的理性选择是不卖。这不是销售问题，是成本结构问题：报案（骑手）→ 查勘（人工）→ 核损（人工）→ 核赔（人工），后三步的固定成本吃掉全部保费。")
H2("1.2 参数化转身：不问「你损失了多少」，只问「你那里下了多少雨」")
P("雨证把赔付条件换成一个任何人都能独立读取的公开数字：保单生效后，这个区划在保障窗口内新增的累计降雨量。越过国标档线即按档赔付，不需要报案、查勘、核损、核赔。两个关键设计：")
BUL("增量判定：", "判定只看买入之后的增量，不看当天累计——已下过的雨不赔，保单只能「先买、后下雨」。")
BUL("确定性判定：", "AI 只负责验真（比对原始报文与哈希），不裁决赔不赔；规则写死在合约里，同一输入永远同一结论。")
H2("1.3 可验证性：把「你信不信我」换成「你自己验」")
P("每一步都有可独立重放的证据链：三模型原始报文（gzip + sha256）→ canonical 确定性哈希 → 上链 evidenceHash → 合约规则 → 判定 outputHash。任何人拿同一份原始报文重跑同一套规则，得到同一个结论；核验台粘一个地址或哈希就能读回全部过程，不依赖任何在线区块浏览器。")
H2("1.4 五层架构")
TBL(["层", "内容", "接缝"], [
    ["① 外部数据层", "Open-Meteo Archive（ERA5 逐小时，11 年回测）+ Forecast（ECMWF/GFS/ICON 三模型）", "HTTP 直连，免费、无密钥"],
    ["② AI 判定层", "ai-collect 取数 → canonical 确定性哈希 → ai-judge（R1–R5）→ submit-judgement 上链", "提交前重算哈希比对，提交后读回校验 6/6 字段"],
    ["③ 共识与结算层", "Solidity V6：registerRegion / updateRainfallBatch / buyPolicy / submitJudgement / claim / settleExpired", "BOT Chain 968 实链，2/3 多签"],
    ["④ 自动化与证据层", "push-rainfall（30 分钟喂价）+ keeper（30 分钟巡检领取）+ 09-AI判定留痕存档", "留痕含每张保单输入/输出哈希"],
    ["⑤ 产品前端层", "降雨看板 / 链上动态 / 投保入口 / 定价实验室 / 核验台——纯静态 HTML 直读链上", "premiumOf / thresholdOf 都是合约返回"],
], [3.0, 8.8, 4.2])
doc.add_page_break()

# ---------- 2 区块链 ----------
H1("2. 区块链部分")
H2("2.1 链与合约身份")
KVP([
    ["链", "BOT Chain 测试网，chainId 968（rpc.bohr.life）"],
    ["合约", "RainDeliveryInsuranceV6 @ 0xcDe1Bb9b8d61E55e194f18B6836fF1DBd49bC61F"],
    ["部署区块", "28,460,066"],
    ["运行时", "22,012 字节，keccak 0xeb7f…4100（EIP-170 限额 24,576 之内）"],
    ["运营权", "2/3 多签 0x21C8…0d98（任何参数变更需两票，每次留 reasonHash）"],
    ["代币", "模拟 RDROP（不可兑换人民币，仅作经济情景单位）"],
])
H2("2.2 保单六参数与关键常量（写死在合约或由多签管理）")
TBL(["参数", "取值", "说明"], [
    ["城市/区划", "122 个喂价区划", "按区划独立定价；区划码 = 6 位行政区码"],
    ["时长", "12h / 24h", "只用国标时段，不做更长时段外推"],
    ["档线", "12h 30/70 mm；24h 50/100 mm", "GB/T 28592—2012 降水量等级"],
    ["给付", "第一档 50%（50 元）/ 第二档 75%（75 元）", "基数 100 元，单笔封顶"],
    ["单价", "链上 244 格 1.8–10.5 元", "premiumOf(regionId, hours) 逐格可读"],
    ["结算", "外部任务触发；claim() 无权限修饰符", "任何人可替骑手领取，钱只进保单登记地址"],
    ["领取宽限", "CLAIM_GRACE = 7 天", "过期未领由 settleExpired 结算敞口"],
    ["喂价时效", "MAX_FEED_AGE = 24h", "超龄区划拒保新单（feed before buying）"],
    ["单骑手敞口", "在保 ≤ N 张、累计 ≤ MAX_OPEN_EXPOSURE_PER_RIDER", "防止单一骑手挤兑池子"],
    ["容量守卫", "新敞口不得超过已注资容量", "buyPolicy 内置检查"],
], [3.4, 6.0, 6.6])
H2("2.3 喂价闸门（防数据污染）")
P("每 30 分钟一轮：对有增量的区划，取 ECMWF(IFS 025) / GFS(seamless) / ICON(seamless) 三模型同一窗口的累计降水，要求三值互相在容差 max(2.5 mm, 5%×中位数) 内才上链；分歧则链下拒收、留痕不喂。evidenceHash 由原始报文 sha256 与窗口边界确定性推导：")
FORMULA('evidenceHash = keccak256("v6-feed ${code} ${target}mm window(${from}→${to}) raw-sha256=${sha256} models=ECMWF+GFS+ICON")')
P("留痕：09-AI判定留痕/v6-feed-trace-*.json 保存每城每轮的原始报文 sha256 与决策，任何人可重算。")
H2("2.4 判定与赔付流")
P("投保（buyPolicy，写入 effectiveFrom 与 rainfallAtBuy 基线）→ 喂价（updateRainfallBatch，三模型门槛）→ 判定（submitJudgement，operator 提交当前读数，合约校验单调性与窗口）→ 赔付（claim 无权限，档位 tierOf(增量, 时长) 决定 50/75 元）→ 结算（settleExpired 释放敞口）。")
H2("2.5 链上账本现状（2026-11-03 快照）")
KVP([
    ["注册区划", "122（RegionRegistered 122 条）"],
    ["价格设定", "244 条 PremiumSet（=122×2，部署后从未改价）"],
    ["累计喂价", "1,111 条 RainfallUpdated（自部署至 11-02 全量审计）"],
    ["保单", "0 张（刻意保持的零保单演示口径）"],
    ["资金池", "4,958.40 元（注资 + 保费 − 赔付，逐分对账差额 0）"],
    ["实时读数", "武汉 10.8mm（0.5h 前）· 上海 18.1mm（8.6h）· 北京 6.4mm（8.6h）· 广州 6.0mm（2.2h）· 成都 2.5mm（12.3h）· 鹤峰 19.5mm（64.8h，分歧 hold 中）"],
])
NOTE("读数采集时刻：2026-11-03 16:2x（rainfall/lastFeedAt/poolBalance 实读）。鹤峰因 6 模型无收敛按证据保守拒喂，等 ERA5 回填复核。")
H2("2.6 权限表（谁能做什么）")
TBL(["操作", "权限", "说明"], [
    ["喂价 / 改价 / 判定 / 暂停", "仅 operator（2/3 多签两票执行）", "每次留 reasonHash / evidenceHash"],
    ["claim()", "任何人", "无权限修饰符——有意设计，keeper 只是其中一双手"],
    ["anchorEffective()（T+1 锚定）", "任何人", "骑手自己最有动机第一时间钉，钉晚只让自己少赔"],
    ["部署 / 合约常量变更", "重新部署", "档线、给付、容差是常量，改=换地址（红线）"],
], [4.4, 5.2, 6.4])
doc.add_page_break()

# ---------- 3 精算与定价 ----------
H1("3. 精算与定价：四代模型，各答一个问题")
TBL(["模型", "回答的问题", "状态"], [
    ["v1 actuary（2026-10-07）", "这些城市下雨超标的基础频率是多少？", "历史基线（只读保留）"],
    ["v3 五维引擎 pricing_engine.js", "考虑投保时点选择性与批量的零售价是多少？", "现行方法论，509 项自检"],
    ["audit_numbers.js", "跨机器复现的零浮点权威值是多少？", "22 项断言（当日重算）"],
    ["pricing-next 差异化模型", "按月 × 起保时点的整年经济账是否为正？", "研究方案（未上链）"],
    ["conditional-risk.js", "雨中投保的残余风险有多大？", "当日新增（内部仪表）"],
], [4.2, 6.8, 5.0])
H2("3.1 v1 基线：无条件触发频率（ERA5 全样本）")
TBL(["城市", "小时数", "24h 有效窗口", "命中数", "p(≥50mm/24h)", "样本最大 24h 雨量"], v1_rows, [2.2, 2.6, 3.0, 2.0, 3.2, 2.6])
NOTE("来源：actuary-output.json（2026-11-03 18:42 重新生成）。阈值 50mm/24h；窗口为滑动小时窗。")
H2("3.2 v3 五维引擎：把「投保时点的选择性」算进价格")
P("五维 = 地区 × 时长 × 用户类型 × 使用场景 × 购买量。核心思想：平台整批投保的期望赔付是无条件概率 p，雨季想起来的骑手是「雨季的 p」，预警后追加的是「明知道要下」的 p——差异化定价不是打折，是把择时选择性参数化：")
FORMULA("月投保权重 w_m = (1−κ)/nM + κ·rate_m/Σrate，κ∈[0,1]（κ=1 是纯气候学择时的上限）")
FORMULA("P_net(N) = ⌈(E₉₇.₅ + C(N,q)) / 60%⌉（费率闸）　F(N) = ⌈C(N,q)×1.25⌉（成本地板）　P(N) = max(P_net, F)")
P("P_net 与 F 取大是最重要的一行：微保险里固定成本常大于风险保费，只按风险定价卖一份亏一份，只按成本定价会在大灾城市赔穿。临灾条件率实测 5.5–17.2×、季节 4.1–12.5×，只作诊断量、不进报价。")
H3("五城 24h 四段位：点估计 / 97.5% 上界（月块自举 4,000 次）")
TBL(["城市", "段位", "点估计", "97.5% 上界", "零售价（引擎内部计量）"], seg_rows, [1.6, 4.4, 2.4, 2.4, 3.0])
NOTE("来源：pricing-engine.json cells（引擎当日运行时输出，40 单元 = 5 城 × 2 时长 × 4 段位）；零售价单位为引擎内部计量，完整元价表见 定价体系-v3-数表.md（40 格零售 + 120 格批量带，当日重生成）。")
H3("批量档位（一次判定覆盖 N 份的摊薄折扣）")
TBL(["档", "购买量 N", "折扣"], band_rows, [1.2, 3.0, 3.0])
H3("准备金规则")
KVP([
    ["规则", f'准备金 ≥ 在保总份数 × VaR99/份（取全格最差 segment 的 VaR99 = {pe["reserve"]["var99PerPolicyEth"]}）'],
    ["最差格", pe["reserve"]["worstCell"]],
    ["含义", "无论实际渠道组合如何，都按最坏单元格计提，不做相关性假设"],
])
NOTE("自检：node pricing_engine.js --self-check → 509 项断言（2026-11-03 通过）。")
doc.add_page_break()

H2("3.3 audit_numbers：零浮点权威值")
P("全部降水按整数十分位（0.1mm→1）累加、按整数阈值比较，杜绝浮点边界漏判；audit_numbers --self-check 22 项断言锁定跨机器复现的权威值（例：广州 24h 档位计数 [1247,122,0,95040]、期望赔付 0.00741632）。这是「可复核」的技术底座：任何人在任何机器上重跑，得到逐位相同的结果。")
H2("3.4 pricing-next 差异化模型：月 × 起保时点的全年经济账")
P("研究方案（未上链）：122 地区 × 12 月 × 4 起保时点 × 2 时长 = 11,712 个统计单元。训练 2015-10→2023-09（8 个水文年），验证 2023-10→2024-09 单独报告，独立测试 2024-10→2026-09 固定训练定价回放、不反向调参。")
H3("概率 → 期望赔付")
FORMULA("qⱼ(r,m,s,h) = P(窗口新增累计雨量 ≥ tⱼ(h))，q₂ ≤ q₁　→　L = 50·q₁ + 25·q₂（不能写成 50q₁+75q₂——那会把大暴雨重复算赔）")
H3("不确定性 → 压力概率")
FORMULA("可信度加权：q̂ = z·(时点率) + (1−z)·(同月全时点率)，z = n/(n+120)；每单元 1,500 次水文年块自举取 97.5% 分位 b；正压力地板 ε₁=0.005、ε₂=0.001；气候压力 γ=1.25：q̃ = min(1, 1.25·max(q̂, b, ε))")
H3("费用与保费")
KVP([
    ["单份基础费用 c", "0.30 元；批量分摊 0.30 元/100 份；年度固定 60,000 元 / 200,000 份"],
    ["理赔处理费 s_c", "0.20 元 × 压力触发率；变动费用 v = 8%；目标利润 m = 15%"],
    ["资本占用 k", "100 元 × 8% × (h+168)/8760（按 100 元基数计提，不是 75）"],
])
FORMULA("P = max(P_min, ⌈(L_U + C_U) / (1 − v − m)⌉₀.₁)　—— 三条安全边际：97.5% 上界（不是点估计）、向上取整、赔付率红线 60%")
H3("完整算例：武汉 · 7 月 · 12:00 起保")
TBL(["项目", "12h", "24h"], [
    ["点估计 q₁ / q₂", "2.6221% / 0.1863%", "3.8295% / 1.1549%"],
    ["L = 50q₁+25q₂", "1.3576 元", "2.2035 元"],
    ["压力概率 q̃₁ / q̃₂", "6.9729% / 0.6985%", "11.5215% / 4.3308%"],
    ["取整后研究保费", "5.80 元", "10.00 元"],
    ["压力情景单份期望利润", "+0.8936 元", "+1.5551 元"],
], [4.6, 5.0, 5.0])
NOTE("24h 展开：L_U≈6.8435，费用合计 C_U≈0.8014，(6.8435+0.8014)/(1−0.08−0.15)≈9.9284 → 向上取整 10.00 元。")
H3("同为 7 月、12:00 起保，五城研究保费（月×时点差异的直观展示）")
TBL(["地区", "12h", "24h"], [["武汉", "5.80", "10.00"], ["上海", "4.10", "5.60"], ["北京", "5.10", "6.50"], ["广州", "3.20", "4.10"], ["成都", "4.00", "6.60"]], [3.6, 4.4, 4.4])
NOTE(f'这不是链上现价，不能替换现行保费表；冬季与雨季不同，广州也不是每个月都比武汉贵。modelId：{pn.get("modelId", "")}。')
H3("全年经济账（保持已报费率不变的模型情景）")
TBL(["年销量假设", "模型年度期望结果"], sc_rows, [5.6, 6.8])
KVP([
    ["盈亏平衡", f'{annual.get("minimumPoliciesForStrictlyPositiveProfit", 43180):,} 单/年（严格正期望最低量）'],
    ["组合均值", f'平均保费 {annual.get("meanPremiumYuan", 2.3702):.4f} 元 · 扣年度固定费前贡献 {annual.get("meanContributionBeforeAnnualFixedCostYuan", 1.3896):.4f} 元'],
    ["独立测试回放", "711,748 个完整研究窗口，按训练定价结算，平均窗口 +1.1182 元（含列明分摊费用；窗口数≠独立样本数）"],
])
H2("3.5 conditional-risk：时间维度残余风险（T+1 之后还剩多少）")
P("问题：骑手看着窗外下雨立即投保，进行中降雨事件的尾巴会落进保单窗口。用 11 年逐小时缓存实算「雨中买（前 24h 有雨）」的条件触发概率相对随手买的倍数：")
TBL(["城市", "档", "无条件", "雨中买（无 T+1 旧锚）", "雨中买（T+1 后残余）", "T+1 削减"], cr_rows, [1.8, 1.4, 2.2, 3.4, 3.4, 2.0])
NOTE("来源：conditional-risk.json（当日生成，窗口 [t+24h, t+24h+时长)，条件=前 24h ≥10mm；脚本 conditional-risk.js 可重跑）。残余由月度定价 + 极端天气暂停 + v7 antecedent loading 吸收；单笔 50/75 元封顶与容量守卫保证总伤害有上限。")
H2("3.6 口径边界：链上 244 格 ≠ 研究费率")
P("链上 244 格是部署时按当期数表经两票多签写入的现行价（1.8–10.5 元，PremiumSet 244 条带依据哈希，部署后未改价）；pricing-next 的 1.50–10.60 元是月×时点研究费率（未上链）；v3 引擎 40 单元是段位×批量研究层。三者不可互相替换——材料若引用研究价必须标「研究」，链上价必须与 premiumOf 实测逐个一致。")
doc.add_page_break()

# ---------- 4 时间维度攻防 ----------
H1("4. 时间维度攻防与双轨设计（数字版）")
TBL(["闸门", "挡住什么", "对雨中骑手的影响"], [
    ["T+1 绑定延迟（已实现待发布）", "「当场买、把进行中降雨的尾巴算进去」——生效=买入+24h，anchorEffective 把生效时刻雨量钉进保单，钉晚只让自己少赔", "门不锁：任何时候都能买，从明天开始保"],
    ["月 × 起保时点定价（研究层已有）", "挑雨季/挑雨时：价签本就更高（武汉 12h：1 月 1.50 → 7 月 5.80 元）", "正常价，无歧视"],
    ["极端天气暂停（合约开关现成）", "预警级停 toC 新投保；灾难级 setPaused 全停；已生效保单照常判定赔付", "在册骑手（toB 每日签发）保障不断"],
], [4.2, 8.4, 4.4])
P("双轨：toB 订阅 = 平台每日 00:05 批量 buyFor 签发次日单（登记一次整月安心，骑手雨中无需任何操作）；toC 自购 = T+1 即时投保（补充保障 + 演示通道）。两轨共用同一全局 24h 冷却参数与同一张价目表。")

# ---------- 5 工程与测试 ----------
H1("5. 工程与测试：数字清单")
KVP([
    ["门禁", "29 组 · 642 项断言（npm test EXIT=0，2026-11-03）"],
    ["精算自检", "pricing_engine 509 项 + audit_numbers 22 项"],
    ["V6 隔离链 e2e", "33 项（含 T+1 生效锚定与雨中投保排除的直接证明）"],
    ["V6 部署核验", "9 项离线 + --onchain 4 项链上逐字节"],
    ["历史回放", "2024-06 武汉三天 230mm · 2026-08 上海全闭环；拒赔样本留痕可复算"],
    ["事件审计", "1,111 RainfallUpdated · 122 RegionRegistered · 244 PremiumSet · 0 保单事件（全量 eth_getLogs）"],
])

# ---------- 6 商业与风险 ----------
H1("6. 商业与风险")
KVP([
    ["TAM", "19–26 亿元/年（500–700 万骑手 × 250 天 × 1.5 元；口径并列不混算）"],
    ["SAM / SOM·第 3 年", "3.6 亿（200 万高频骑手 × 120 天 × 1.5 元）/ 1.1 亿（80 万 × 100 天 × 1.4 元）"],
    ["每元保费去向（平台团体价口径）", "期望赔付 34% · 固定成本 14% · 再保与准备 15% · 渠道运营 25% · 科技毛利 12%"],
    ["风险登记", "基差风险（已量化）· 逆选择（已产品化）· 同城集中（准备金规则）· 数据源故障（三模型+拒收留痕）· 极端年份尾部（二期超赔）· 运营方单点（部分实现，独立托管未落实——不粉饰）"],
])

# ---------- 7 复核指南 ----------
H1("7. 复核指南：每一条命令与预期输出")
TBL(["复核项", "命令", "预期"], [
    ["全量门禁", "cd 07-测试工具 && npm test", "29 组全过，EXIT=0（V6 E2E 33 项）"],
    ["v3 引擎自检", "node 10-金融与定价/pricing_engine.js --self-check", "509 项断言全部通过"],
    ["零浮点权威值", "node 10-金融与定价/audit_numbers.js --self-check", "22 项通过"],
    ["差异化模型重建", "node 10-金融与定价/pricing-next/build-model.js && node …/summarize.js", "modelId 与 summary.json 一致（确定性复现）"],
    ["模型回归", "node 07-测试工具/check-pricing-next.js", "20 项通过"],
    ["残余风险量化", "node 10-金融与定价/pricing-next/conditional-risk.js", "输出五城×两档表与 conditional-risk.json"],
    ["链上价格实读", "核验台粘合约地址后读 premiumOf(regionId, hours)", "与 §2.2 / §3.6 数字一致"],
    ["喂价留痕", "09-AI判定留痕/v6-feed-trace-*.json", "每城每轮原始报文 sha256 可重算"],
], [2.8, 7.2, 6.4])

# ---------- 8 边界 ----------
H1("8. 边界与诚实声明")
BUL("模拟口径：", "模拟 RDROP 不可兑换人民币；4,958.40 元池子是经济情景，不是营业收入；零真实保单。")
BUL("赔付时效：", "赔付到账为外部任务触发，不承诺分钟级；gas 摊薄后每单不足一元。")
BUL("压力概率：", "是设计假设（自举分位 + 地板 + γ=1.25），不是严格覆盖率保证；气候变化与再分析偏差可能使真实风险更高。")
BUL("独立托管：", "未落实，现在靠 2/3 多签与同机密钥约束——已知短板，写进风险登记不粉饰。")
BUL("对外三不说：", "不说「无人值守自动赔付」（判定需 operator 提交）、不把研究费率当链上现价、不把回测窗口数当独立样本。")

# ---------- 附录 ----------
H1("附录 · 数据与留痕文件索引")
KVP([
    ["actuary-output.json", "v1 基线：五城 6 档窗口命中率与 p 值（当日重新生成）"],
    ["pricing-engine.json / 定价体系-v3-数表.md", "v3 五维 40 零售格 + 120 批量带（数表当日重生成）"],
    ["pricing-next/{model.json, summary.json}", "11,712 单元差异化模型与全年经济账（modelId 锁定）"],
    ["pricing-next/conditional-risk.json", "雨中投保残余风险量化（当日生成）"],
    ["pricing-next/方法与复算.md", "全部公式、假设与复核命令的权威文本（含 §12 T+1）"],
    ["09-AI判定留痕/", "喂价/判定留痕、7 城裁决证据包、申诉目录"],
    ["12-开发归档/", "全部验收日志与复盘"],
], 6.0, 12.0)
P("—— 全文完。任何一个数字有疑问，按 §7 的命令重跑；结果不一致请当成 bug 报告给维护者。", 9, False, "777777", align="center", italic=True)

out = ROOT / "02-作战与答辩" / "雨证作品全貌-底层逻辑·区块链·精算定价总说明-2026-11-03.docx"
doc.save(str(out))
print("written:", out, out.stat().st_size, "bytes")
