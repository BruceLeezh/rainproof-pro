# -*- coding: utf-8 -*-
"""口径统一到 B2B2C：报名简介、骑手端措辞、交接文档的批发价表述。"""
import io, re, os

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "雨证·Rainproof"))

def zishu(s):
    return len(re.sub(r"\s", "", s))

BRIEF = (
    "雨证 RainProof 是面向外卖骑手的参数化降雨收入保障：规则写进智能合约，降雨读数由链上预言机写入，"
    "累计雨量越过国标暴雨档线即自动赔付，骑手不报案、不举证，也没有定损员。"
    "判定不是\u201c问一下大模型\u201d：取证快照、三模型共识、赔或不赔由确定性规则 R1\u2013R5 计算，"
    "链上只存 32 字节哈希，任何人拿同一份快照可逐字节重跑出相同结论——把\u201c你信不信我\u201d换成\u201c你自己验\u201d。"
    "已在 BOT Chain 测试网 968 完成 v5 部署：六城区划码、2/3 多签治理，21 道自动化门禁全绿。"
    "商业模式是 B2B2C：平台或众包服务商批量采购、代骑手付费，骑手零元参保；平台侧已有批量代付与链上逐分对账。"
)
SHORT = (
    "雨证 RainProof 给外卖骑手做参数化降雨险：规则在合约里，降雨上链，越过国标暴雨档线自动赔付，不报案不举证。"
    "判定由确定性规则给出、链上只存哈希，任何人可重放同一份快照得到相同结论——把\u201c信我\u201d换成\u201c自己验\u201d。"
    "商业模式为 B2B2C：平台代骑手付费，骑手零元参保。"
)
n, ns = zishu(BRIEF), zishu(SHORT)
assert n <= 300, f"简介 {n} 字超 300"
assert ns <= 140, f"短版 {ns} 字过长"

# ---------- 1. 报名材料 ----------
P = "02-作战与答辩/报名材料-填写稿-2026-10-26.md"
t = io.open(P, encoding="utf-8").read()
blocks = re.findall(r"```text\n(.*?)\n```", t, re.S)
assert len(blocks) == 2, blocks
t = t.replace(blocks[0], BRIEF, 1).replace(blocks[1], SHORT, 1)
t = re.sub(r"字数：\*\*\d+ 字\*\*（去空白计）。", f"字数：**{n} 字**（去空白计）。", t)
t = re.sub(r"本稿 \d+ 字，留了 \d+ 字余量", f"本稿 {n} 字，留了 {300 - n} 字余量", t)
t = t.replace(
    "所有演示数据带 simulated 标记；RDROP 为演示计价单位，不构成任何真实保险要约。",
    "商业模式为 B2B2C：保费由平台/众包服务商批量采购后代理付费，骑手零成本参保；"
    "演示环境的每份保费按链上零售价结算（上海 12h 为 4.20 元），平台批发价为商业条款、未写入合约。\n"
    "所有演示数据带 simulated 标记；RDROP 为演示计价单位，不构成任何真实保险要约。",
)
io.open(P, "w", encoding="utf-8", newline="").write(t)

# ---------- 2. 骑手端措辞 ----------
R = "05-演示站点/rider.html"
r = io.open(R, encoding="utf-8").read()
old_h2 = '<h2>投保<em>免报案 · 免定损 · 触发即自动打款</em></h2>'
new_h2 = (old_h2 + '\n    <p class="note" style="margin-top:6px">这是<b>骑手端体验页</b>：真实业务里保费由平台/众包服务商批量采购后代付（B2B2C），'
          '骑手零成本；页面上的「连接钱包投保」是为了让你亲手把一笔保障跑通。</p>')
assert old_h2 in r
r = r.replace(old_h2, new_h2, 1)
old_btn = '<button class="btn primary block" id="buy">投保（连接钱包）</button>'
new_btn = '<button class="btn primary block" id="buy">投保（平台代付 · 连接钱包体验）</button>'
assert old_btn in r
r = r.replace(old_btn, new_btn, 1)
r = r.replace('content="雨证骑手端：选城市选时长、保费按链上价实时算，雨量过线赔付自动到账 —— 免报案、免定损。"',
              'content="雨证骑手端：选城市选时长、保费按链上价实时算，雨量过线赔付自动到账 —— 免报案、免定损；保费由平台代付，骑手零成本。"', 1)
io.open(R, "w", encoding="utf-8", newline="").write(r)

# ---------- 3. 交接文档：批发价是否上链 ----------
H = "02-作战与答辩/交接-项目全貌-给接手Agent-2026-10-26.md"
h = io.open(H, encoding="utf-8").read()
old = "人民币定价表：零售 1.1–8.8 元/份，平台团体批发 1 元级/份（`保险创业赛-2026/02-定价-人民币口径/`）。"
new = ("人民币定价表：零售 1.1–8.8 元/份，平台团体批发 1 元级/份（`保险创业赛-2026/02-定价-人民币口径/`）。\n"
       "**注意（2026-10-26 实测）**：v5 合约的 `premiumOf(regionId,hours,riderTier,channel,count)` 对 "
       "riderTier / channel / count 三个参数**一律忽略**，六种组合全部返回同一价（上海 12h=420 分、24h=530 分）；"
       "即「平台批发 1 元级/份」目前是**商业条款，未写入合约**（`MIN_PREMIUM=100 分` 是它的下限，但不是实现）。"
       "对外讲价时说清楚：演示按零售价结算，批发价需 v6 实现。")
assert old in h
io.open(H, "w", encoding="utf-8", newline="").write(h.replace(old, new, 1))

print(f"OK: 简介 {n} 字 / 短版 {ns} 字；rider.html 与交接文档已改")
