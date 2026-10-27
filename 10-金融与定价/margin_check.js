// 期望收益为正的独立校验：不复用 pricing_engine.js 的断言路径，
// 直接读它落盘的 pricing-engine.json，按定义**逐格重算**：
//   期望净收益/份 = 保费 − 固定成本 − 期望赔付
//   期望赔付 = E[f] × PAYOUT_MAX          （E[f] = pointRatePct/100，档位加权期望赔付比例）
//   上界赔付 = 97.5% 上界 × PAYOUT_MAX     （upperRatePct/100）
// 用法：cd 10-金融与定价 && node margin_check.js
const fs = require('fs');
const path = require('path');
const A = require('./audit_numbers.js');   // 借 gas 口径（用量/单价/取整），不另抄一份

const rep = JSON.parse(fs.readFileSync(path.join(__dirname, 'pricing-engine.json'), 'utf8'));
const E = rep.meta.economics;
const PAYOUT = E.payoutMaxEth;
const R = E.targetLossRatio;

const num = (v) => Number(v);
const eth = (v) => v.toFixed(8);
const sgn = (v) => (v >= 0 ? '+' : '') + v.toFixed(8);
const pct = (v) => `${num(v).toFixed(6)}%`;

const cells = rep.cells;
let worst = null, cheapest = null, neg = 0;
const rows = [];

for (const c of cells) {
  const q = num(c.pointRatePct) / 100;          // E[f]
  const qUp = num(c.upperRatePct) / 100;        // 97.5% 上界
  const prem = num(c.premiumRetailEth);
  const cost1 = num(c.costPerPolicyEth);
  const cost1000 = num((c.batch.find((b) => b.N === 1000) || c.batch[c.batch.length - 1]).costPerPolicyEth);
  const expPay = q * PAYOUT;
  const upPay = qUp * PAYOUT;
  const marginExp1 = prem - cost1 - expPay;
  const marginUp1 = prem - cost1 - upPay;
  const marginExp1000 = prem - cost1000 - expPay;
  rows.push({ c, q, qUp, prem, cost1, cost1000, expPay, upPay, marginExp1, marginUp1, marginExp1000 });
  if (marginExp1 <= 0 || marginUp1 <= 0) neg++;
  if (!worst || marginExp1 < worst.marginExp1) worst = { marginExp1, key: `${c.regionName} ${c.hours}h ${c.segKey}` };
  if (!cheapest || prem < cheapest.prem) cheapest = { prem, key: `${c.regionName} ${c.hours}h ${c.segKey}` };
}

console.log('== 参数（全部来自 pricing-engine.json 的 meta.economics，不手抄）==');
console.log(JSON.stringify(E, null, 0));
console.log(`PAYOUT_MAX=${PAYOUT}  目标赔付率 R*=${R}  最小成本加成 M=${E.minCostMarkup}  地板=${E.minPremiumAbsEth}  上限=${E.premiumCapEth}  网格=${E.ceilTickEth}`);
console.log(`判定 gas=${E.judgeGasEth}  赔付 gas=${E.payoutGasEth}  档线=${JSON.stringify(rep.meta.thresholdsMm)}  档位=${JSON.stringify(rep.meta.tierBps)}`);
console.log(`E[f] 口径下注：pointRatePct = 档位加权期望赔付比例；uncondPointRatePct 是同格无择时版\n`);

console.log('== 40 格逐格期望收益（N=1 零售价）==');
console.log('区域   时长 seg   κ       E[f]%       上界%       保费ETH   固定成本N=1  期望赔付     期望净收益   上界净收益   约束');
for (const r of rows) {
  const c = r.c;
  console.log(
    `${c.regionName}  ${String(c.hours).padStart(2)}h  ${c.segKey}  ${num(c.selectivity).toFixed(2)}  ` +
    `${pct(c.pointRatePct).padStart(10)}  ${pct(c.upperRatePct).padStart(10)}  ` +
    `${eth(r.prem)}  ${eth(r.cost1)}  ${eth(r.expPay)}  ` +
    `${sgn(r.marginExp1)}  ${sgn(r.marginUp1)}  ${c.boundBy}`
  );
}

console.log(`\n== 汇总 ==`);
console.log(`格数 ${rows.length}  期望净收益为负或零的格数：${neg}`);
console.log(`最小的期望净收益：${eth(worst.marginExp1)} ETH/份（${worst.key}）`);
console.log(`最低零售价：${eth(cheapest.prem)} ETH（${cheapest.key}）`);
const allUp = rows.every((r) => r.marginUp1 > 0);
console.log(`按 97.5% 上界赔付率仍全部为正：${allUp ? '是' : '否'}`);
console.log(`期望净收益区间：${sgn(Math.min(...rows.map((r) => r.marginExp1)))} ~ ${sgn(Math.max(...rows.map((r) => r.marginExp1)))} ETH/份`);
console.log(`上界净收益区间：${sgn(Math.min(...rows.map((r) => r.marginUp1)))} ~ ${sgn(Math.max(...rows.map((r) => r.marginUp1)))} ETH/份`);

console.log(`\n== 批量 1000 份（每格最便宜的档）==`);
const bRows = [];
for (const r of rows) {
  bRows.push({ key: `${r.c.regionName} ${r.c.hours}h ${r.c.segKey}`, m: r.marginExp1000, ratio: r.cost1 / r.cost1000 });
}
console.log(`期望净收益区间：${sgn(Math.min(...bRows.map((b) => b.m)))} ~ ${sgn(Math.max(...bRows.map((b) => b.m)))} ETH/份`);
console.log(`固定成本摊薄比：${Math.min(...bRows.map((b) => b.ratio)).toFixed(1)}× ~ ${Math.max(...bRows.map((b) => b.ratio)).toFixed(1)}×`);
console.log(`最低者：${bRows.reduce((a, b) => (a.m < b.m ? a : b)).key}`);

console.log(`\n== 敏感性：期望净收益在什么冲击下才转负 ==`);
// 对每一格，求"期望赔付放大多少倍会让净收益归零"
const breakEven = rows.map((r) => ({ key: `${r.c.regionName} ${r.c.hours}h ${r.c.segKey}`, k: (r.prem - r.cost1) / r.expPay, k1000: (r.prem - r.cost1000) / r.expPay }));
console.log(`N=1：期望赔付可以放大到 ${Math.min(...breakEven.map((b) => b.k)).toFixed(1)}× ~ ${Math.max(...breakEven.map((b) => b.k)).toFixed(1)}× 才转负（最脆弱格：${breakEven.reduce((a, b) => (a.k < b.k ? a : b)).key}）`);
console.log(`N=1000：期望赔付可以放大到 ${Math.min(...breakEven.map((b) => b.k1000)).toFixed(1)}× ~ ${Math.max(...breakEven.map((b) => b.k1000)).toFixed(1)}× 才转负`);
console.log(`作为对照，97.5% 上界 ÷ E[f] 的最大值 = ${Math.max(...rows.map((r) => r.qUp / r.q)).toFixed(3)}×（即真实概率取到上界时仍远未触及转负点）`);
// 这两行原本是"把成本总额乘 1.5 / 乘 3"——等于让 **gas 用量和单价一起涨**。
// 真实风险是**单价**在浮：本表的 gas 单价取自 Sepolia（判定 1.080 / 赔付 2.500 gwei），
// 而要部署/演示的 BOT Chain 968 链上实测是 20 gwei。所以下面按「gas 用量 × 单价」重算成本腿，
// 直接给出 20 gwei 口径与"哪一档 gwei 会让格转负"。
const U = E.gasUnits, G = E.gasGwei;
if (!U || !G) {
  console.log('（pricing-engine.json 的 meta.economics 里没有 gasUnits/gasGwei —— 重跑 node pricing_engine.js 后本节能给出逐 gwei 口径）');
} else {
  const ratio = G.judge / G.payout;                 // 判定/赔付的单价之比（同链同源，按比例缩放）
  const costAt = (gwei, N, q) => A.gasEthAt(U.judge, gwei * ratio) / N + A.gasEthAt(U.payout, gwei) * q;
  const drift = Math.max(...rows.map((r) => Math.abs(costAt(G.payout, 1, r.q) - r.cost1)));
  console.log(`按「用量 × 单价」重算的成本与产物 costPerPolicyEth 的最大偏差 = ${drift.toExponential(1)} ETH/份（应为 0）`);
  for (const gwei of [G.payout, 5, 10, 20]) {
    const m = rows.map((r) => r.prem - costAt(gwei, 1, r.q) - r.expPay);
    const tag = gwei === 20 ? '   ← 968 现网 20 gwei（02-作战与答辩/决策记录.md:40 链上实测 0.002458 BOT）'
      : gwei === G.payout ? '   ← 本表口径（Sepolia）' : '';
    console.log(`赔付 gas 单价 ${String(gwei).padStart(5)} gwei：N=1 最小期望净收益 ${sgn(Math.min(...m))} ETH/份，净收益 ≤ 0 的格数 ${m.filter((v) => v <= 0).length}/${rows.length}${tag}`);
  }
  const gBreak = (N) => rows.map((r) => ({
    key: `${r.c.regionName} ${r.c.hours}h ${r.c.segKey}`,
    g: (r.prem - r.expPay) / (U.judge * ratio * 1e-9 / N + U.payout * 1e-9 * r.q),
  }));
  for (const N of [1, 1000]) {
    const b = gBreak(N);
    console.log(`N=${N}：全部格转负的赔付 gas 单价 = ${Math.min(...b.map((x) => x.g)).toFixed(2)} ~ ${Math.max(...b.map((x) => x.g)).toFixed(2)} gwei（最脆弱格：${b.reduce((a, x) => (a.g < x.g ? a : x)).key}）`);
  }
  console.log(`（对照旧口径"成本总额 ×1.5 / ×3"：最小期望净收益 ${sgn(Math.min(...rows.map((r) => r.prem - r.cost1 * 1.5 - r.expPay)))} / ${sgn(Math.min(...rows.map((r) => r.prem - r.cost1 * 3 - r.expPay)))} ETH/份）`);
}

console.log(`\n== 构造性证明（不依赖任何一格实测值）==`);
const ceilTick = (v) => Math.ceil(v / E.ceilTickEth) * E.ceilTickEth;
let proofOk = true, minSlack = Infinity;
for (const r of rows) {
  const C = r.cost1;
  const pNetRaw = ceilTick((r.qUp * PAYOUT + C) / R);
  const floorRaw = ceilTick(C * (1 + E.minCostMarkup));
  const Pactual = Math.max(E.minPremiumAbsEth, Math.max(pNetRaw, floorRaw));
  const slack = Pactual - (r.qUp * PAYOUT + C);
  minSlack = Math.min(minSlack, slack);
  if (slack <= 0) proofOk = false;
}
console.log(`对全部 ${rows.length} 格重算 max(地板, ceil(P_net), ceil(F))，与产物价对比，最小余量 = ${eth(minSlack)} ETH/份`);
console.log(`构造性正收益（保费 ≥ 上界赔付 + 固定成本）成立：${proofOk ? '是' : '否'}`);
console.log(`理论下界：保费 ≥ (1/R*)·(上界赔付 + C) = 1.6667·(上界赔付 + C) ⇒ 相对上界赔付的余量 ≥ ${(1 / R - 1).toFixed(4)}× (上界赔付 + C) > 0`);
