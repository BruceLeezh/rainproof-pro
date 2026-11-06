
from pathlib import Path
from datetime import datetime, timezone, timedelta
import json
from docx import Document
from docx.shared import Cm, Pt, RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

root=Path(__file__).resolve().parents[2]
archive=Path(__file__).resolve().parent
def read(p): return json.loads((root/p).read_text(encoding='utf-8-sig'))
audit=read('12-开发归档/2026-11-05-模型复核/复算结果.json')
historical=read('12-开发归档/2026-11-05-模型复核/历史模型复算.json')
summary=read('10-金融与定价/pricing-next/summary.json')
cond=read('10-金融与定价/pricing-next/conditional-risk.json')
chain=audit['chain']; research=audit['research']
assert len(chain['rates'])*2==244 and not chain['differences']
assert historical['v3']['rows']==40 and not historical['v3']['mismatches']
assert historical['hubei']['ok']==236 and not historical['hubei']['errors']
assert summary['totalCells']==research['cells']==11712
assert summary['annualIllustration']==research['after']['annualIllustration']
assert summary['test']==research['after']['test']
tz=timezone(timedelta(hours=8))
def time(t): return datetime.fromtimestamp(t,tz).strftime('%m-%d %H:%M:%S')
def money(f): return f'{f/100:,.2f}'
def pct(x): return f'{x*100:.4f}%'

d=Document()
d.core_properties.title='雨证 V6-T1｜精算、费率与保单模型复核'
d.core_properties.subject='测试网现行规则、费率复算与差异化研究模型'
d.core_properties.author='雨证项目'
sec=d.sections[0]
sec.page_width=Cm(21); sec.page_height=Cm(29.7)
sec.left_margin=sec.right_margin=Cm(2.15)
sec.top_margin=Cm(1.9); sec.bottom_margin=Cm(1.65)
for name,size,color in [('Normal',10.5,'223146'),('Title',32,'142A3D'),('Heading 1',22,'142A3D'),('Heading 2',13,'087E78')]:
    style=d.styles[name]
    style.font.name='Microsoft YaHei'
    style.font.size=Pt(size); style.font.color.rgb=RGBColor.from_string(color)
    style._element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'),'Microsoft YaHei')
normal=d.styles['Normal'].paragraph_format
normal.space_after=Pt(7); normal.line_spacing=1.25
hp=sec.header.paragraphs[0]; hp.text='雨证   /   RAINPROOF                                               保险创业赛 · 模型复核'
hp.runs[0].font.size=Pt(9); hp.runs[0].font.color.rgb=RGBColor.from_string('587181')
fp=sec.footer.paragraphs[0]; fp.add_run('V6-T1  ·  2026-11-05                                        ')
fp.add_run('第 ')
field=OxmlElement('w:fldSimple'); field.set(qn('w:instr'),'PAGE'); fp._p.append(field); fp.add_run(' 页')
for run in fp.runs: run.font.size=Pt(9)
def p(s): d.add_paragraph(s)
def h(s): d.add_heading(s,2)
def page(n,s):
    d.add_page_break()
    d.add_heading(f'{n:02d}  {s}',1)
def eq(s):
    pp=d.add_paragraph()
    rr=pp.add_run(s); rr.bold=True; rr.font.color.rgb=RGBColor.from_string('087E78')
    pp.paragraph_format.left_indent=Cm(.35)
def table(headers,rows,widths=None):
    t=d.add_table(rows=1,cols=len(headers)); t.style='Light Shading Accent 1'
    if widths:
        t.autofit=False
        for col,w in zip(t.columns,widths): col.width=Cm(w)
    for row_i,values in enumerate([headers,*rows]):
        row=t.rows[0] if row_i==0 else t.add_row()
        properties=row._tr.get_or_add_trPr()
        properties.append(OxmlElement('w:cantSplit'))
        if row_i==0: properties.append(OxmlElement('w:tblHeader'))
        for j,value in enumerate(values):
            cell=row.cells[j]
            if widths: cell.width=Cm(widths[j])
            cell.text=str(value)
            para=cell.paragraphs[0]; para.paragraph_format.space_after=Pt(3); para.paragraph_format.space_before=Pt(3)
            for run in para.runs:
                run.font.size=Pt(9.5); run.bold=row_i==0
    d.add_paragraph().paragraph_format.space_after=Pt(0)

d.add_heading('雨证 V6-T1',0)
d.add_heading('精算、费率与保单模型复核',1)
p('供评委、答辩成员与复算人员阅读。所有金额明确区分测试网模拟金额、研究情景金额与旧版 ETH 参数。')
h('先分清这三套口径')
table(['模型','复核结论','适用范围'],[
    ['当前 V6-T1 保单与现行价','两档给付、T+1、准备金与已部署字节码核对通过。244 格报价与原公式逐格一致。','BOT Chain 测试网演示'],
    ['季节与时点差异化定价','122 个区划、11,712 格由原始缓存重算。已补计 T+1 的资金占用并重新跑留出期。','预承诺批次研究'],
    ['历史精算和产品备选','40 格 V3 及湖北 236 格离线重现。旧 ETH、48/72 小时、批量带和收入挂钩各有独立假设。','历史沿革或情景比较'],
],[4.2,8.1,4.4])
h('核验基准')
p(f"测试网链 ID 968。合约 {chain['address']}。链上快照区块 {chain['block']:,}，北京时间 2026-{time(chain['time'])}。本地基线提交 149044d，本文同时纳入 11 月 5 日工作区修正。")
p('阅读顺序：第 2—3 页讲实际保单与现行价，第 4—8 页从数据推到研究保费和收益，第 9 页给出版本适用性，第 10 页列复算步骤。')

page(2,'现行保单与给付')
p('投保人为自己或受益人支付测试代币 RDROP。RDROP 为两位小数，合约金额以模拟分记录。降雨累计的单位独立，是整毫米。')
eq('生效 = 买入 + 24 小时     到期 = 生效 + 12 或 24 小时')
table(['时长','不到首档','第一档','第二档'],[
    ['12 小时','不足 30 mm → 0','30 至不足 70 mm → 50','达到 70 mm → 75'],
    ['24 小时','不足 50 mm → 0','50 至不足 100 mm → 50','达到 100 mm → 75'],
],[3,4,4.9,4.8])
p('给付栏金额为模拟元。达到高档时只支付 75 元。两种时长的给付同额，阈值和费率可以不同。100 元是额度和未结清敞口基数。')
h('从购买到结束')
p('投保要求区划可用、未停保、最新链上数据在 24 小时内、池子容量充足。付款账户可在生效前申请原额退回。生效后任何地址可提交锚定，写入当时链上雨量。')
eq('判定增量 = 判定固定读数 − 生效锚定读数')
p('判定须在保障窗口内写入，每单一次，至少两来源并保存输入、输出哈希。给付还需 PAY、置信度至少 60、增量达到档线。已有合格判定可在到期后 7 天内领取；超过宽限期再释放未结清敞口。')
table(['演示单','实收保费','生效 / 到期（北京时间）','锚值 / 快照状态'],[
    [f"#{x['id']} {'武汉' if x['region']==420100 else '广州'} {x['h']}h",
     money(x['premium']),time(x['effective'])+' / '+time(x['end']),
     f"{x['anchor']} mm / {'生效中' if x['status']=='active' else '已到期'}"]
    for x in chain['policies']
],[3.6,2.4,6.1,4.6])
p('两单在复核区块均未写入赔付判定、未支付。锚值是区划累计账本读数，和单次保障期降雨量应分别显示。')

page(3,'现行保费怎么计算')
p('现行 V6-T1 的定价模块为空地址，钱包端读 premiumOf(区划, 时长)。合约按网格、承保备选价、10.00 模拟元兜底的顺序取值，并检查 1.00 元地板；核查时 244 格全部命中网格。')
h('原费率是怎样产生的')
p('对每个区划、每种时长，把历史逐小时降水按窗口累加。每个窗口按 0、0.50、0.75 记录赔付比例。按窗口结束所在月份汇总每个自然月的平均比例 rₘ。')
eq('月份权重 wₘ = rₘ / Σrₘ（现行费率来源采用 κ=1；全零时等权）')
p('按 wₘ 抽整月共 4,000 次自举。每次抽与原样本相同数量的月份并求均值，取均值分布的 97.5% 分位 u。这里 u 是相对 100 元基数的加权赔付比例。')
eq('保费 = max{1.00，向上取到 0.10[(100u + 0.30) / 0.60]，向上取到 0.10[0.30 × 1.25]}')
p('0.30 元为费用假设。按这个公式，在所设压力赔付与费用条件下，两者合计不超过保费的 60%。余下比例仍须覆盖其他经营费用、资本和利润。')
h('武汉 24 小时，逐步复算')
p('u = 4.935469%。压力赔付 = 100 × 4.935469% = 4.935469 元。加 0.30 元后除以 0.60 得 8.725782 元，向上取至 8.80 元。武汉 #0 的保费字段为 880 分。')
order=['武汉','上海','北京','广州','成都']
rates={r['name']:r for r in chain['rates']}
table(['区划','12h 现行价','24h 现行价'],[[name,*[money(x['price']) for x in rates[name]['p']]] for name in order],[5.7,5.5,5.5])
p('来源链为五城人民币换算表与湖北区划表 → 上一版网格 → V6-T1 迁移。湖北表包含武汉市级，118 区划与其余四城合成 122 区划。244/244 实读与原公式一致。')

page(4,'研究模型如何从雨量得到概率')
p('研究单元由区划、起保月份、北京时间起保时点（0、6、12、18 时）和时长（12 或 24 小时）共同决定，共 122 × 12 × 4 × 2 = 11,712 格。时点指生效时点。')
h('先把逐小时数据变成窗口结果')
p('逐小时降水乘 1,000 后取整。时间戳对应前一小时累计，窗口从 s 起保、h 小时结束，纳入 (s, s+h] 内的小时标签。窗口遇到缺测或断点就排除，不能填 0。')
eq('窗口雨量 = 前缀和(s+h) − 前缀和(s)；计数为 n、k₁、k₂')
p('n 是完整窗口数，k₁ 是达到首档的窗口数，k₂ 是达到次档的窗口数。两个事件嵌套，k₂ 已包含在 k₁ 内。用起保时点匹配格子。')
h('用同月全时点对小样本做平滑')
eq('Z = n / (n + 120)     qⱼ = Z × kⱼ/n + (1−Z) × 同区划同月全时点命中率ⱼ')
p('武汉 7 月 12:00 起保的 24h 档，时点样本 248 个、命中 10 和 3 个。同月全时点为 5,952 个、命中 203 和 62 个。Z=67.3913%，得到 q₁=3.8295%，q₂=1.1549%。')
h('为报价设压力情景')
p('用固定种子抽取完整水文年块（每年 10 月至次年 9 月）1,500 次，每次重新计算两档 q。取 97.5% 分位与点估计及风险地板的最大值，乘 1.25 后封顶于 1。两档地板分别为 0.5%、0.1%，乘压力系数后最低为 0.625%、0.125%。')
table(['数据用途','窗口年份（北京时间）','用途'],[
    ['训练','2015-10 至 2023-09','估计概率、收缩、自举'],
    ['验证','2023-10 至 2024-09','留出验证'],
    ['测试','2024-10 至 2026-09','冻结参数后的历史重放'],
],[3.7,6,7])
p('跨切分边界的窗口排除。122 份缓存哈希一致，未发现缺测或断点，但源模型未显式锁定。该序列为网格历史产品，不能描述为单一 ERA5 或实地站点观测。')

page(5,'研究报价：把概率换成金额')
h('从两个超越概率算纯保费')
eq('期望给付 L = 50(q₁−q₂) + 75q₂ = 50q₁ + 25q₂')
p('三种状态依次是 0 元、50 元、75 元。式中 q₂ 只额外增加 25 元，防止对同一次大暴雨支付两档。把 q 换成压力概率得到压力期望给付 Lᵤ。')
table(['费用项','默认值或公式'],[
    ['每份与批次费用','0.30 + 0.30 ÷ 100 = 0.303 元'],
    ['分摊年度固定费','60,000 ÷ 200,000 = 0.30 元/单'],
    ['资本占用','100 × 8% × (24 + h + 168) ÷ 8,760 元/单'],
    ['理赔处理','每次 0.20 元，期望为 0.20 × 压力 q₁'],
    ['按保费比例计费','变动费用率 8%，目标利润率 15%'],
],[5.1,11.6])
eq('压力成本 Cᵤ = 上表前四项相加')
eq('未取整费率 = (Lᵤ + Cᵤ) ÷ (1−8%−15%)')
p('再向上取到 0.10 元，并执行 1.00 元最低保费。样本不足 8 个训练年、费率超过 25 元或达到最高给付、即时择时投保未校准时，研究模型停止报价。')
h('武汉 7 月、12:00 起保，24h 档')
p('压力概率为 11.5215% 与 4.3308%。压力给付 = 50×0.1152152 + 25×0.0433084 = 6.8435 元。压力成本 = 0.3030 + 0.3000 + 0.1973 + 0.0230 = 0.8233 元。')
eq('P = 向上取到 0.10[(6.8435 + 0.8233) ÷ 0.77] = 10.00 元')
p('点估计给付 2.2035 元。压力情景贡献扣除列明全部费用后为 10 × 0.92 − 6.8435 − 0.8233 = 1.5332 元。该场景价用于提前锁定排班的研究，武汉 24h 链上现价仍为 8.80。')

page(6,'差异化报价与历史重放')
p('资金从投保付款时即占用。修正后，12h 档的保守占用时长为 204 小时，24h 档为 216 小时。与原试算相比有 1,493 格因取整变价，全部 11,712 格在默认假设下满足报价门槛。')
table(['区划','1 月 12h / 24h','7 月 12h / 24h'],[
    [name,*[' / '.join(f"{e['premiumYuan']:.2f}" for e in summary['examples'] if e['name']==name and e['month']==m) for m in [1,7]]]
    for name in order
],[4.4,6.1,6.2])
p(f"上表均为北京时间 12:00 起保的研究金额。全模型范围 {summary['minPremiumYuan']:.2f}—{summary['maxPremiumYuan']:.2f} 元。季节变化来自分组数据，12h 与 24h 费率由各自概率计算。")
h('留出期怎么验证')
p('训练结束后锁定各格价格。对留出期逐窗确定区划、时点和档线，累计保费 nP，赔付 50k₁+25k₂，再按窗口数扣除费用、资本和固定费用分摊，并按 k₁ 扣理赔处理费。')
test=summary['test']
table(['测试期重放指标','结果'],[
    ['2024-10 至 2026-09 完整窗口',f"{test['policies']:,}"],
    ['保费合计（研究元）',money(test['premiumFen'])],
    ['给付合计（研究元）',money(test['claimsFen'])],
    ['费用合计（含资本与固定费用分摊，研究元）',money(test['costFen'])],
    ['模拟净结果 / 每窗均值',f"{money(test['profitFen'])} / {test['averageProfitYuan']:.4f} 元"],
],[10.3,6.4])
p('同一场雨可能同时落在两个时长、多个起保点和邻近区划。重放窗口数只表示历史场景的规模，统计不确定性应按时间块和区域相关性处理。')

page(7,'盈利边界与偿付约束')
h('年度正期望来自哪些条件')
eq('单份贡献 g = P(1−v) − L − 每份与批次费用 − 资本费用 − 期望理赔处理费')
eq('年度期望 Π = N × Σ(wᵢgᵢ) − F')
p('wᵢ 是各格在销售中的占比，F 是年度固定费。模型用训练窗口数作示例组合。保持这组费率和组合不变，严格正期望需要 N > F/平均贡献；最低整数单量是 floor(F/g)+1。')
annual=summary['annualIllustration']
p(f"本例平均保费 {annual['meanPremiumYuan']:.4f} 元，固定费前平均贡献 {annual['meanContributionBeforeAnnualFixedCostYuan']:.5f} 元。F=60,000 元，对应严格正期望至少 {annual['minimumPoliciesForStrictlyPositiveProfit']:,} 单/年。")
table(['年单量假设','年度期望结果（研究元）'],[
    [f"{row['policies']:,}",f"{row['expectedProfitYuan']:+,.2f}"] for row in annual['scenarios']
],[7,9.7])
p('前提包括实际风险未超压力假设、费用可控制、承诺批次机制成立且销售结构接近假设。改变费用、销量、分布或售价，都要重算。两张演示单无法验证商业收益。')
h('测试网怎么约束资金池')
eq('准备金 = max(人工设定储备，100 × 未结清保单数)')
eq('新单准入：资金池余额 + 新保费 ≥ 当前准备金 + 100')
p(f"核查区块资金池 {money(chain['pool'])} 模拟元，未结清敞口和有效准备金均为 {money(chain['reserve'])} 模拟元。每名骑手同时受 3 张保单数限制和 200 元敞口限制，按单份 100 元时实际最多 2 张未结清保单。")
p('组合灾害风险需按共同时间块分析同时触发和集中投保。旧 VaR 样例使用旧 ETH 保费、窗口与赔付，城市独立抽样会漏掉共同暴雨风险。')

page(8,'T+1、双轨和备选产品')
h('用条件概率复核等待期')
p('以投保时刻 t 为基点，若前 24 小时累计降雨 ≥10 mm 则记 A。T+0 比较 (t,t+h]，T+1 比较 (t+24,t+24+h]。分别计算 P(达首档|A) ÷ P(达首档)，两个版本分别使用自身的无条件分母。')
table(['武汉','T+0 雨中买倍率','T+1 雨中买倍率','条件触发频率降幅'],[
    [c['product'],str(c['legacyNoT1_multiplierVsUncond'])+'×',str(c['rainBuyMultiplierVsUncond'])+'×',str(c['t1RemovalPct'])+'%']
    for city in cond['cities'] if city['name']=='武汉' for c in city['products']
],[3.8,4.2,4.2,4.5])
p('五城两档的倍率从 3.3–11.6 倍降至 1.7–4.2 倍，条件触发频率降低 31.6%–66.0%。这是首档气象触发频率，不直接等于期望给付倍数或实时定价因子。前 24 小时 ≥30 mm 的敏感性另列于条件研究输出。')
h('产品路径')
p('骑手自购已可走 buyPolicy。平台代付可用 buyFor 为一个受益人签发，合约每次 count=1；平台事先锁定整月排班、每天逐份签发次日保障是运营方案。现行网格未按渠道、身份、购买量折扣。')
p('备选收入挂钩：额度基数 = 时薪 × 约定工作小时 × 收入替代比例。按示例时薪 20 元、替代率 50%、12h/24h 约定工作 6/10 小时，得到额度基数 60/100 元，两档给付为 30/45 元与 50/75 元。上线前需要工作时间、收入损失验证及合约支持。')
h('移植到新区划')
p('固定地点坐标、数据模型和时区，保存原始报文及 SHA-256。按同样的时段、阈值、缺测规则做训练和留出测试。使用本地实际成本、渠道承诺和目标单量；缺样本时拒报。')

page(9,'适用性与修正记录')
table(['模型或实现','当前用途及边界'],[
    ['早期触发率、72h 测算与 VaR','历史对照。24/48/72h 的阈值外推、ETH 金额和单档赔付不能套用 V6-T1。早期浮点阈值计数用整数审计输出复核。'],
    ['V3 五维、人民币批量与 B 端档位','V3 四合法分群（κ=0/0.15/0.55/1）和批次摊薄属于设计；N 越大越低的固定成本是经营假设。旧 ETH 费用和第 3 给付档均不适用。'],
    ['班次、雨强与研究备选','班次内雨量、峰值强度和收入挂钩可做敏感性；V6 触发仍为两档累计量。尚无数据支持将积水或订单量纳入当前定价。'],
    ['T+1 条件风险研究','已修正前一小时窗口和旧/新各自无条件分母。可量化等待期残余风险，适配性限于回放与设计比较。'],
],[5,11.7])
h('旧方案的可复算公式')
p('V3 用 wₘ=(1−κ)/月数+κrₘ/Σrₘ 加权月份。旧 ETH 模型的成本为判定费用/N 加上赔付处理费用×加权比例，原模型以该比例近似出险频率。压力赔付与费用相加后除以 0.60，再按旧 ETH 价格步长、地板、上限和渠道约束处理。人民币批量敏感性用 0.30/N 四舍五入到分且最低 0.01 元和 0.10 元价格步长。两者保留用于解释批量摊薄，不作为实际出险频率或 V6-T1 渠道价。')
h('本次修正')
p('理赔取证按有效起保至最近链上更新所对应的完整小时取数，采用当前保单区划表，缺测拒绝。首小时如跨生效时刻按覆盖秒数折算，并保留原小时量及覆盖秒数。提交前核对同一合约、保单、锚值、读数和取证窗口。')
p('资本占用补计买入到生效的 24 小时，已同步研究源码、报价页数据、回测摘要与武汉案例。链上保费来自迁移价表。演示材料中两张保单锚值已更正为 126 / 60 mm。')
h('仍须留意的边界')
p('锚定采样取交易执行时的链上累计；锚定延迟、喂价覆盖截止与上链时间跨小时、人工补报和整毫米量化都可能造成基差，须查喂价原始留痕。判定一单一次，仍在保障期且未达线的演练结果不能作为最终拒赔。')
p('技术修正已发布 v6（3b11b52），远端门禁与部署通过。提交工具仅接收可赔判定，第二票前复查状态。');

page(10,'复算与数据出处')
table(['复核目标','从项目根目录复现'],[
    ['部署合约和公开页面 ABI','node 07-测试工具/check-v6-deployment.js --onchain'],
    ['旧 V3 费率、人民币网格','node 07-测试工具/check-pricing-grid.js\\nnode 07-测试工具/check-rmb-grid.js'.replace('\\n','\n')],
    ['研究模型完整重建','node 10-金融与定价/pricing-next/build-model.js\\nnode 10-金融与定价/pricing-next/summarize.js'.replace('\\n','\n')],
    ['T+1 条件研究','node 10-金融与定价/pricing-next/conditional-risk.js'],
    ['研究模型与保单生命周期回归','node 07-测试工具/check-pricing-next.js\\nnode 07-测试工具/check-ai.js\\nnode 07-测试工具/e2e_v6_review.js'.replace('\\n','\n')],
    ['独立核对和同一输入重复计算','12-开发归档/2026-11-05-模型复核/复算结果.json、历史模型复算.json、理赔取证实测/'],
],[6,10.7])
h('项目内的依据')
p('保单与敞口：03-合约/RainDeliveryInsuranceV6.sol。旧费率：10-金融与定价/pricing-engine.json、hubei-pricing.json。研究价：pricing-next/config.json、core.js、build-model.js、model.json、summary.json。')
p('研究模型 ID：'+summary['modelId'])
h('外部出处')
p('降水数据由 Open-Meteo 提供。历史 API 的 precipitation 采用前一小时累计。https://open-meteo.com/en/docs/historical-weather-api')
p('降水档线参照 GB/T 28592—2012《降水量等级》。国家标准信息公共服务平台：https://std.samr.gov.cn/search/stdPage?q=GB%2FT28592')
p('未来赔付、费用及风险成本的建模方法参考 ASOP 53。https://www.actuarialstandardsboard.org/asops/estimating-future-costs-prospective-propertycasualty-risk-transfer-risk-retention/')
out=root/'01-参赛材料/交付物/模型/雨证-V6-T1-精算定价与保单模型复核-2026-11-05.docx'
section_nine = False
for paragraph in d.paragraphs:
    if paragraph.text.startswith('09  '):
        section_nine = True
    if paragraph.text.startswith('10  '):
        section_nine = False
    if section_nine and paragraph.style.name == 'Normal':
        paragraph.paragraph_format.line_spacing = 1.1
        paragraph.paragraph_format.space_after = Pt(4)
        for run in paragraph.runs:
            run.font.size = Pt(10)
d.save(out)
loaded=Document(out)
assert len(loaded.tables)==12 and any('4.935469%' in paragraph.text for paragraph in loaded.paragraphs)
print(out)

