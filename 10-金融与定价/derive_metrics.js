#!/usr/bin/env node
/**
 * 指标推导脚本：把「杠杆 / 赔付率 / 保本线 / 公平保费 / 准备金」全部当**变量**算一遍。
 *
 * 它和 `audit_numbers.js` 的分工是刻意的：
 *   - `audit_numbers.js` 只算**输入**（每个窗口的触发概率 p），零浮点、可自证；
 *   - 本脚本把 p 当输入，按公式推**派生指标**，并对每条派生指标做恒等式自检。
 *
 * 所以这里没有任何写死的赔付率或杠杆——写死的只有合约常量、链上读回来的保费、
 * 以及从 ERA5 逐小时数据算出来的 p。剩下的全部是公式的求值结果。
 *
 * 复现：
 *   cd 10-金融与定价 && node derive_metrics.js            # 离线，只用 cache/
 *   cd 10-金融与定价 && node derive_metrics.js --chain     # 额外现场读一次链上保费
 * 输出：控制台表格 + `metrics-derived.json`
 */
const fs = require('fs');
const path = require('path');
const A = require('./audit_numbers.js');
const { REGIONS } = require('../04-脚本/regions.js');

// ── 输入 1：合约常量（写死的只有这些，每一行都指着合约行号）────────────────
const PAYOUT = 0.01;              // 03-合约/RainDeliveryInsurance.sol:21        (= v2 :30 PAYOUT_MAX)
const PREMIUM_DEFAULT = 0.001;    // 03-合约/RainDeliveryInsurance.sol:20
const MIN_PREMIUM = 0.0002;       // 03-合约/RainDeliveryInsuranceV2.sol:32
const THRESHOLD = 50;             // 03-合约/RainDeliveryInsurance.sol:22        (v2 :34 THRESHOLD_PER_24H)

// ── 输入 2：链上实收保费（变量，会随 setUnderwriting 变。默认值是 2026-10-07 只读读回的）──
// 现场要引用时先重读，不要背：premiumOf(1..5)
const CHAIN = {
  network: 'Sepolia 11155111',
  address: '0x89e7C942535930B61cB61631051E8b0bD670596a',
  block: 11860688,
  readAt: '2026-10-07',
  prices: { wuhan: 0.0008, shanghai: 0.0008, beijing: 0.0004, guangzhou: 0.0020, chengdu: 0.0007 },
};
/** 实测的每笔链上成本（变量：随 gas 价变，现场按当前 gas 价重算） */
const COST = {
  // 三个数都由 audit_numbers.js 的 gas 口径算出（用量 × 单价，唯一来源），这里不再手抄
  buyPolicy: A.gasEthAt(A.GAS_UNITS.buyPolicy, A.GAS_GWEI.buyPolicy),  // 0.00046
  judge: A.JUDGE_GAS,     // 一笔 submitJudgement，由 operator 付
  payout: A.PAYOUT_GAS,   // 一笔 claim 转账，由 operator 付
};
const COST_PER_POLICY = COST.judge + COST.payout; // 池子侧要为每份保单预留的运营成本

// ── 输入 3：定价值（不是合约常量，是我们的口径选择）────────────────────────
const TARGET_LOSS_RATIO = 0.6;    // R* —— 钉住它就等于钉住了杠杆，见下

// ── 公式（派生指标全部由这三个式子出来，没有第四个）───────────────────────
//   杠杆    L = PAYOUT / PREMIUM
//   赔付率  R = E[赔付] / PREMIUM = p × L      （二元全额赔付时 E[赔付] = p × PAYOUT）
//   保本    R < 1  ⟺  PREMIUM > E[赔付]  ⟺  L < PAYOUT / E[赔付] = 1/p
const leverage = (premium) => PAYOUT / premium;
const lossRatio = (expectedPayout, premium) => expectedPayout / premium;
/** 公平保费 = 期望赔付额本身（此时 R = 100%，杠杆 = 1/p，即保本线上限） */
const fairPremium = (expectedPayout) => expectedPayout;
/** 想让赔付率等于某个目标值 R*，保费必须收这么多 */
const premiumAt = (expectedPayout, rStar) => expectedPayout / rStar;
/**
 * R* 的可行上界（不假设费用率，直接减去每笔固定成本 C）：
 *   保费 P = E/R* 必须同时覆盖期望赔付 E 与固定成本 C
 *   ⟹ E/R* ≥ E + C  ⟹  R* ≤ E/(E+C)
 * 也就是说 R* 不是随便拍的：C 越大 / E 越小的区域，R* 的可选范围越窄。
 */
const rStarCeiling = (expectedPayout, cost = COST_PER_POLICY) => expectedPayout / (expectedPayout + cost);
/**
 * 两种成本口径（**必须分开写**，否则"北京到底亏不亏"会给出相反答案）：
 *   保守 C_cons = judge + payout = 0.00025  —— 把赔付那笔 gas 也摊到每一份保单上（上界）
 *   期望 C_exp(p) = judge + p × payout ≈ 0.000135 —— 判定每份都要付，赔付只在出险时付
 * 池子的长期真实支出是 C_exp；C_cons 是"假设每一份都出险"的悲观上界。
 */
const costConservative = COST_PER_POLICY;
const costExpected = (p) => COST.judge + p * COST.payout;
const round = (v, n) => Math.round(v * 10 ** n) / 10 ** n;

function main() {
  const argv = process.argv.slice(2);
  const reserveMc = readReserveMc();
  const out = {
    meta: {
      generatedAt: new Date().toISOString(),
      sourceMtime: A.sourceMtime(),
      payoutEth: PAYOUT,
      premiumDefaultEth: PREMIUM_DEFAULT,
      minPremiumEth: MIN_PREMIUM,
      thresholdMm: THRESHOLD,
      targetLossRatio: TARGET_LOSS_RATIO,
      costPerPolicyEth: COST_PER_POLICY,
      cost: COST,
      chain: CHAIN,
      pSource: 'audit_numbers.js（整数十分位滑动窗口，ERA5 逐小时 2015-10-01~2026-09-30）',
      formulas: {
        leverage: 'L = PAYOUT / PREMIUM',
        lossRatio: 'R = E[payout] / PREMIUM = p * L  (二元全额赔付)',
        fairPremium: 'P_fair = E[payout]（此处 R = 100%，L = 1/p）',
        premiumAt: 'PREMIUM(R*) = E[payout] / R*',
        breakeven: 'R < 1 ⟺ PREMIUM > E[payout] ⟺ L < 1/p',
        reserveFloor: 'reserve >= Σ_区域(该区域在保保单数 × PAYOUT) = 未了结保单数 × PAYOUT',
      },
    },
    v1: {},   // v1：阈值恒 50mm、二元全额赔付
    v2: {},   // v2：thresholdOf(h)=50*h/24、三档按比例赔付
    arbitrage: {},
    reserve: {},
  };

  console.log('\n══ v1（现行链上口径）：阈值恒 50mm、达标全额赔 PAYOUT = 0.01 ETH ══');
  console.log('每一列都是变量：p 由数据算出，L/R 由 p 与保费算出，保费本身随 setUnderwriting 变。\n');

  for (const region of REGIONS) {
    const { mm10 } = A.loadCity(region);
    const premiumOnchain = CHAIN.prices[region.key];
    const rows = {};

    console.log(`── ${region.name}（链上现价 ${premiumOnchain} ETH）──`);
    console.log('   窗口      p(点估计)         E[赔付]      P_fair    P@R*=60%   L_现价  R_现价   L_公平  L_保本   每份净毛利');

    for (const h of A.DURATIONS) {
      const { windows, hits } = A.countHits(mm10, h);
      const p = hits / windows;                 // ← 输入：概率
      const ePay = p * PAYOUT;                  // ← 公式：期望赔付
      const fair = fairPremium(ePay);            // ← 公式：公平保费 = 期望赔付
      const pR60 = premiumAt(ePay, TARGET_LOSS_RATIO);
      const lOnchain = leverage(premiumOnchain);
      const rOnchain = lossRatio(ePay, premiumOnchain);
      const lFair = leverage(fair);
      const margin = premiumOnchain - ePay - COST_PER_POLICY;

      rows[String(h)] = {
        windows, hits, p: round(p, 8), pPct: round(p * 100, 4),
        expectedPayoutEth: round(ePay, 10),
        fairPremiumEth: round(fair, 10),
        premiumAtR60Eth: round(pR60, 10),
        leverageFair: round(lFair, 2),          // = 1/p（保本上限）
        leverageOnchain: round(lOnchain, 3),
        lossRatioOnchain: round(rOnchain, 5),
        leverageAtDefault001: round(leverage(PREMIUM_DEFAULT), 2),
        lossRatioAtDefault001: round(lossRatio(ePay, PREMIUM_DEFAULT), 5),
        marginPerPolicyEth: round(margin, 10),
        // 两种成本口径各算一遍 —— 符号在这两种口径之间会翻
        costPerPolicyExpectedEth: round(costExpected(p), 10),
        marginPerPolicyExpectedEth: round(premiumOnchain - ePay - costExpected(p), 10),
        rStarCeiling: round(rStarCeiling(ePay), 5),                        // 保守口径下的 R* 上界
        rStarCeilingExpected: round(rStarCeiling(ePay, costExpected(p)), 5), // 期望口径下的 R* 上界
        sellableInV1: h <= 72,                   // v1: MIN_HOURS=1 / MAX_HOURS=72
        // 全精度原值：自检的恒等式必须用它们判，用显示值会被四舍五入骗过
        _raw: {
          p, ePay, fair, pR60, lFair, lOnchain, rOnchain,
          cExp: costExpected(p), rCeil: rStarCeiling(ePay), rCeilExp: rStarCeiling(ePay, costExpected(p)),
        },
      };

      console.log(
        `  ${String(h).padStart(4)}h  ${(p * 100).toFixed(4).padStart(8)}%  ` +
        `${ePay.toExponential(3).padStart(11)}  ${fair.toExponential(3).padStart(11)}  ` +
        `${pR60.toExponential(3).padStart(11)}  ${String(round(lOnchain, 2)).padStart(6)}  ` +
        `${(rOnchain * 100).toFixed(2).padStart(6)}%  ${String(round(lFair, 1)).padStart(6)}  ` +
        `${String(round(lFair, 1)).padStart(6)}  ${margin.toExponential(2).padStart(10)}` +
        (h > 72 ? '   ← 不可售（v1 MAX_HOURS=72）' : '')
      );
    }
    out.v1[region.key] = { premiumOnchain, onchainAtBlock: CHAIN.block, windows: rows };
    console.log('');
  }

  // ── R* 的可行区间：把固定成本 C 显式减掉，R* 就不是随便拍的了 ────────────
  console.log('══ R* 的可行上界（72h）：R* ≤ E[赔付] / (E[赔付] + 固定成本 C) ══');
  console.log(`   保守口径 C = judge + payout = ${costConservative}（把赔付 gas 也摊到每份）`);
  console.log('   期望口径 C = judge + p×payout ≈ 0.000135（赔付只在出险时付）—— 池子真实长期支出是这一列');
  console.log('   C 越大、E 越小的区域，R* 可选范围越窄 —— 这就是「60% 不是随便定的」的量化依据。\n');
  console.log('     城市      E[赔付]72h   上界(保守)   上界(期望)   我们取 R*   现价净毛利(保守/期望)');
  for (const region of REGIONS) {
    const raw = out.v1[region.key].windows['72']._raw;
    const row = out.v1[region.key].windows['72'];
    console.log(
      `   ${region.name.padEnd(6)}  ${raw.ePay.toExponential(3).padStart(11)}  ` +
      `${((raw.rCeil * 100).toFixed(1) + '%').padStart(11)}  ` +
      `${((raw.rCeilExp * 100).toFixed(1) + '%').padStart(11)}  ` +
      `${(TARGET_LOSS_RATIO * 100).toFixed(0).padStart(9)}%  ` +
      `${row.marginPerPolicyEth.toExponential(2)} / ${row.marginPerPolicyExpectedEth.toExponential(2)}`
    );
  }
  console.log('');

  // ── v2：阈值随窗口缩放 + 三档比例赔付 ────────────────────────────────────
  console.log('══ v2（待部署）：thresholdOf(h) = 50 × h / 24，三档按比例赔付 ══');
  console.log('阈值本身是变量 → p 也随之变；赔付额是变量 → 期望赔付不能再写成 p × PAYOUT。\n');
  for (const region of REGIONS) {
    const { mm10 } = A.loadCity(region);
    const premiumOnchain = CHAIN.prices[region.key];
    const rows = {};
    console.log(`── ${region.name} ──`);
    console.log('   窗口  基准线    触发率   E[赔付]        P@R*=60%    L_现价  R_现价   R@地板0.0002');
    for (const h of [24, 48, 72]) {
      const sums = A.windowSums(mm10, h);
      const t = A.tierStats(sums, h);
      const ePay = t.expectedLossEth;
      const pR60 = premiumAt(ePay, TARGET_LOSS_RATIO);
      const rOnchain = lossRatio(ePay, premiumOnchain);
      const rAtFloor = lossRatio(ePay, MIN_PREMIUM);   // 若被迫按地板价卖，赔付率会变成多少
      const triggerPct = round(t.pctByTier.slice(0, 3).reduce((a, b) => a + b, 0), 6);
      rows[String(h)] = {
        thresholdMm: t.thresholdMm, thresholdsMm: t.thresholdsMm,
        counts: t.counts, pctByTier: t.pctByTier,
        triggerPct,
        expectedPayoutEth: ePay,
        premiumAtR60Eth: round(pR60, 10),
        leverageOnchain: round(leverage(premiumOnchain), 3),
        lossRatioOnchain: round(rOnchain, 6),
        lossRatioAtMinPremium: round(rAtFloor, 6),
        belowMinPremium: pR60 < MIN_PREMIUM,
        _raw: { pR60, rOnchain },
      };
      console.log(
        `  ${String(h).padStart(4)}h  ${String(t.thresholdMm).padStart(6)}mm  ` +
        `${triggerPct.toFixed(4).padStart(7)}%  ${ePay.toExponential(3).padStart(11)}  ` +
        `${pR60.toExponential(3).padStart(11)}  ${String(round(leverage(premiumOnchain), 2)).padStart(6)}  ` +
        `${(rOnchain * 100).toFixed(3).padStart(7)}%  ${(rAtFloor * 100).toFixed(3).padStart(7)}%` +
        (pR60 < MIN_PREMIUM ? '   ← 公平保费低于 MIN_PREMIUM' : '')
      );
    }
    out.v2[region.key] = { premiumOnchain, windows: rows };
    console.log('');
  }

  // ── 期限套利：v1 的 premiumOf(regionId) 没有 hours 参数 ──────────────────
  // 同一城市买 1h 和买 72h 付一样的钱，而公平保费正比于触发概率 → 概率之比就是套利尺度。
  console.log('══ 期限套利（v1：premiumOf(regionId) 无 hours 参数，全时长同价）══');
  const ARB_WINDOWS = [1, 3, 6, 12, 24, 48, 72];
  for (const region of REGIONS) {
    const { mm10 } = A.loadCity(region);
    const pOf = {}, maxMm = {};
    for (const h of ARB_WINDOWS) {
      const { windows, hits } = A.countHits(mm10, h);
      pOf[h] = hits / windows;
      const sums = A.windowSums(mm10, h);
      let m = 0;
      for (let i = 0; i < sums.length; i++) if (sums[i] > m) m = sums[i];
      maxMm[h] = round(m / 10, 1);
    }
    const mult = pOf[6] > 0 ? pOf[72] / pOf[6] : Infinity;   // 72h 相对 6h 的公平保费倍数
    out.arbitrage[region.key] = {
      // ⚠️ `pByWindow["1"]`（1 小时窗）**五城恒为 0，不是数据缺失**：`ARB_WINDOWS` 的阈值是 24/48/72 口径的
      // 累计毫米数，1 小时窗在本数据集里永远到不了，所以 `hits = 0`。**画图时必须把这个点删掉**
      // （对数轴上 log(0) 会断线或压扁其余点），并在图注写明"1h 窗不适用，已略去"。
      // 见 `全仓只读审计报告-2026-10-07.md` 第 158 行 / 第 16 条。
      pByWindow: Object.fromEntries(ARB_WINDOWS.map((h) => [h, round(pOf[h], 8)])),
      pByWindowNote: '窗口 "1" 恒为 0（1h 窗到不了这些阈值），图表须删该点',
      maxMmByWindow: maxMm,
      multiple72over6: Number.isFinite(mult) ? round(mult, 1) : null,
      premiumOnchain: out.v1[region.key].premiumOnchain,
    };
    console.log(`  ${region.name}　p: ` + ARB_WINDOWS.map((h) => `${h}h ${(pOf[h] * 100).toFixed(4)}%`).join('  '));
    console.log(`        11 年实测最大累计: ` + ARB_WINDOWS.map((h) => `${h}h ${maxMm[h]}mm`).join('  '));
    console.log(`        → 72h 档的公平保费是 6h 档的 ${Number.isFinite(mult) ? mult.toFixed(1) : '—'} 倍，`
      + `而链上同价 ${out.v1[region.key].premiumOnchain} ETH；`
      + `1h 档在 11 年里从未达到 50mm（单小时极值 ${maxMm[1]}mm）→ 付一样的钱却永远不会赔付，`
      + `3h 档也只有 ${(pOf[3] * 100).toFixed(4)}% 的触发率。`);
  }
  console.log('');

  // ── 准备金：真实分位（seed 42 的 reserve_mc 输出）+ 闭式上界 ──────────────
  console.log('══ 准备金（变量：随在保份数 N、时长、城市组合变）══');
  if (reserveMc) {
    console.log('  口径：reserve_mc.js --seed 42 的真实 VaR99（单位 ETH，正值=需要预留的亏）');
    console.log('  键                                   P(当月亏损)  VaR95   VaR99   每份预留(VaR99/N)');
    for (const k of ['_mix_H24_N200', '_mix_H72_N50', '_mix_H72_N100', '_mix_H72_N200', '_mix_H72_N400']) {
      const v = reserveMc[k];
      if (!v) continue;
      const n = Number(k.split('_N')[1]);
      out.reserve[k] = { ...v, perPolicyEth: round(v.VaR99_eth / n, 6), n };
      console.log(
        `  ${k.padEnd(34)}  ${(v.P_loss_gt0 * 100).toFixed(2).padStart(8)}%  ` +
        `${round(v.VaR95_eth, 4).toFixed(4).padStart(7)}   ${round(v.VaR99_eth, 4).toFixed(4).padStart(7)}   ${round(v.VaR99_eth / n, 4).toFixed(4)}`
      );
    }
    const N = 200;
    console.log(`  闭式上界：N × (PAYOUT − PREMIUM) = ${N} × ${PAYOUT - PREMIUM_DEFAULT} = ${round(N * (PAYOUT - PREMIUM_DEFAULT), 4)} ETH（最坏月份，全部保单同时赔付）`);
    out.reserve.closedFormWorstMonth = { N, value: round(N * (PAYOUT - PREMIUM_DEFAULT), 4) };
  } else {
    console.log('  缺少 reserve-mc-output.json，先跑：node reserve_mc.js --seed 42');
  }
  console.log('');

  if (argv.includes('--chain')) chainCheck(CHAIN.prices);

  const file = path.join(__dirname, 'metrics-derived.json');
  A.emit(file, JSON.stringify(out, null, 2) + '\n');
  console.log(`已写出 ${path.relative(process.cwd(), file)}`);

  if (argv.includes('--self-check')) selfCheck(out);
}

function readReserveMc() {
  const f = path.join(__dirname, 'reserve-mc-output.json');
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}

/** 可选：现场重读链上保费，确认 CHAIN.prices 没过期 */
function chainCheck(expect) {
  console.log('── 现场读链（--chain）──');
  try {
    const { ethers } = require(path.join(__dirname, '..', '04-脚本', 'node_modules', 'ethers'));
    const abi = require(path.join(__dirname, '..', '03-合约', 'RainDeliveryInsurance.abi.json'));
    const provider = new ethers.JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com', 11155111, { staticNetwork: true });
    provider.getBlockNumber().then(async (bn) => {
      const c = new ethers.Contract(CHAIN.address, abi, provider);
      console.log(`  block = ${bn}`);
      for (const r of REGIONS) {
        const v = Number(await c.premiumOf(r.id)) / 1e18;
        const same = Math.abs(v - expect[r.key]) < 1e-12 ? '与默认值一致' : '⚠️ 与默认值不同，请更新 CHAIN.prices';
        console.log(`  premiumOf(${r.id}) ${r.name} = ${v} ETH  ${same}`);
      }
    });
  } catch (e) {
    console.log(`  跳过（${e.message}）`);
  }
}

// ── 自检：派生指标之间必须满足恒等式，任何一条不成立都说明公式或输入被改坏了 ──
function selfCheck(out) {
  let pass = 0, fail = 0;
  const check = (ok, msg) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); ok ? pass++ : fail++; };

  console.log('\n── 自检（--self-check）：恒等式 ──');
  for (const r of REGIONS) {
    const w72 = out.v1[r.key].windows['72'];
    const P = out.v1[r.key].premiumOnchain;
    const x = w72._raw;
    // R = p × L 必须成立（用全精度值判，显示值被四舍五入过）
    check(
      Math.abs(x.rOnchain - x.p * x.lOnchain) < 1e-15,
      `${r.name} 72h: R = p×L → ${round(x.rOnchain, 6)} = ${round(x.p, 6)}×${round(x.lOnchain, 3)}`
    );
    // 公平保费处 R 必须恰为 100%（等价 L = 1/p）
    check(
      Math.abs(x.p * x.lFair - 1) < 1e-12,
      `${r.name} 72h: 公平保费处 R = ${round(x.p * x.lFair, 10)}（应 = 1）`
    );
    // 保本线：L_保本 = 1/p，且此时 R 恰为 1
    check(
      Math.abs(x.lFair - 1 / x.p) < 1e-9,
      `${r.name} 72h: L_保本 = 1/p = ${round(1 / x.p, 2)}（显示 ${round(x.lFair, 2)}）`
    );
    // 现价杠杆必须由保费决定，不能是写死的 10
    check(
      Math.abs(x.lOnchain - PAYOUT / P) < 1e-15,
      `${r.name} 72h: L_现价 = PAYOUT/PREMIUM = ${round(x.lOnchain, 4)}，PREMIUM = ${P}`
    );
  }
  // 目标赔付率反解出的保费，代回去必须恰好落在 R*
  for (const r of REGIONS) {
    const x = out.v1[r.key].windows['72']._raw;
    const R = x.fair / x.pR60;
    check(Math.abs(R - TARGET_LOSS_RATIO) < 1e-12, `${r.name} 72h: 按 R*=60% 定价回代 → R = ${round(R, 10)}`);
  }
  // R* 的可行上界：在 R* = 上界处，公式价恰好 = E + 固定成本 C（毛利恰为零）
  for (const r of REGIONS) {
    const x = out.v1[r.key].windows['72']._raw;
    check(
      Math.abs(premiumAt(x.ePay, x.rCeil) - (x.ePay + costConservative)) < 1e-15,
      `${r.name} 72h: R* 上界(保守) ${round(x.rCeil * 100, 2)}% 处公式价 = E + C_cons = ${premiumAt(x.ePay, x.rCeil).toExponential(4)}`
    );
    check(
      Math.abs(premiumAt(x.ePay, x.rCeilExp) - (x.ePay + x.cExp)) < 1e-15,
      `${r.name} 72h: R* 上界(期望) ${round(x.rCeilExp * 100, 2)}% 处公式价 = E + C_exp = ${premiumAt(x.ePay, x.rCeilExp).toExponential(4)}`
    );
  }
  // 两种成本口径给出**相反**的可行结论 —— 这正是"北京到底亏不亏"的答案所在，必须写死
  {
    const consOut = REGIONS.filter((r) => out.v1[r.key].windows['72']._raw.rCeil < TARGET_LOSS_RATIO).map((r) => r.name);
    const expOut = REGIONS.filter((r) => out.v1[r.key].windows['72']._raw.rCeilExp < TARGET_LOSS_RATIO).map((r) => r.name);
    check(
      consOut.join('、') === '北京、成都',
      `保守口径下 R*=60% 越界的城市：${consOut.join('、') || '无'}（北京 47.7%、成都 59.8% → 按公式价卖都亏）`
    );
    check(
      expOut.length === 0,
      `期望口径下 R*=60% 越界的城市：${expOut.join('、') || '无'}（五城上界 63.2%~88.9%，60% 全部落在区间内）`
    );
    // 符号翻转本身要断言：北京在两种口径下净利润一负一正
    const bj = out.v1.beijing.windows['72'];
    check(
      bj.marginPerPolicyEth < 0 && bj.marginPerPolicyExpectedEth > 0,
      `北京 72h 现价净毛利符号随成本口径翻转：保守 ${bj.marginPerPolicyEth} / 期望 ${bj.marginPerPolicyExpectedEth}`
    );
  }
  // 单调性：保费越高，赔付率与杠杆越低
  const wu = out.v1.wuhan.windows['72'];
  check(wu._raw.rOnchain > wu.lossRatioAtDefault001, '武汉 72h: 现价(0.0008) 赔付率 > 默认价(0.001) 赔付率');
  check(wu._raw.lOnchain > wu.leverageAtDefault001, '武汉 72h: 现价杠杆 > 默认价杠杆');
  // v2：期望赔付必须小于「最小值 × 全额」，且触发率 ≤ 未触发率的补
  for (const r of REGIONS) {
    const v = out.v2[r.key].windows['72'];
    check(v.expectedPayoutEth > 0 && v.expectedPayoutEth <= PAYOUT, `${r.name} v2 72h: 0 < E[赔付] ≤ PAYOUT（${v.expectedPayoutEth}）`);
    check(Math.abs(v._raw.rOnchain - v.expectedPayoutEth / out.v2[r.key].premiumOnchain) < 1e-15,
      `${r.name} v2 72h: R = E[赔付]/PREMIUM（${round(v._raw.rOnchain, 8)}）`);
  }
  console.log(`\n自检结果：${pass} 项通过 / ${fail} 项失败`);
  if (fail > 0) process.exitCode = 1;
}

if (require.main === module) main();
