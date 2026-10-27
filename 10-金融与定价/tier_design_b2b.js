#!/usr/bin/env node
/**
 * tier_design_b2b.js —— 面向企业客户（to B）的档位设计 + 「不亏损」证明
 *
 * 与同目录脚本的分工：
 *   - `audit_numbers.js`   给 **点估计**（p、档位分布、零浮点权威值）
 *   - `derive_metrics.js`  给 **公式推导**（L / R / 保本线 / R* 可行上界）
 *   - 本脚本给 **定价决策**：把「参数不确定性」与「风险集中度」显式算进保费，
 *     并对比现行 v2 档线与建议档线。
 *
 * 三条不亏损的闸（逐条给数）：
 *   闸 1 费率闸 …… 用**月聚类自举 97.5% 上界**定价，不用点估计
 *   闸 2 敞口闸 …… 单（区域 × 时长 × 批次）的集中度惩罚倍数
 *   闸 3 准备金闸 … 按月度损失分布分位设定 reserve，v2 已有 openExposure 硬下限
 *
 * 复算：node tier_design_b2b.js [--self-check]
 * 落盘：b2b-tier-design.json
 *
 * ⚠️ 报错先看这里：`cache/` 被 gitignore，新克隆会缺数据；
 *    跑 `node actuary.js --refresh` 可联网补，但 ERA5 会做再分析回溯，
 *    重取不保证逐字节一致（见 README.md「数据可得性」）。
 */
const fs = require('fs');
const path = require('path');
const A = require('./audit_numbers.js');
const { REGIONS } = require('../04-脚本/regions.js');

// 国标 GB/T 28592-2012 §3：降雨量只按 12h、24h 两个时段划分。48h/72h 是 v2 的线性外推，已删。
const WINDOWS = [12, 24];                  // 合约 v3 的 hoursAllowed() 目标集合
const PAYOUT_MAX = 0.01;                   // RainDeliveryInsuranceV2.sol:30
const MIN_PREMIUM = 0.0002;                // :32
const R_TARGET = 0.6;                      // 目标赔付率（口径见 指标推导-变量表.md §2.1）
const CEIL_TICK = 1e4;                     // 链上取整到 0.0001 ETH（与现价规则一致）
const { JUDGE_GAS, PAYOUT_GAS } = A;       // 与 pricing_engine.js 同源：audit_numbers.js 的 gas 口径
const REPS = 4000;
const SEED = 20261007;

const ceil4 = (v) => Math.ceil(v * CEIL_TICK) / CEIL_TICK;
const round = (v, n) => Math.round(v * 10 ** n) / 10 ** n;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 两套档线方案 ────────────────────────────────────────────────────────────
// bps 与合约 tierBps 语义一致（千分之十 = 万分比）
const SCHEMES = {
  A: {
    key: 'A',
    name: '纯照抄国标三档：12h 30/70/140，24h 50/100/250，档位 ×1/×2/×5',
    source: 'GB/T 28592-2012 表 1 暴雨 / 大暴雨 / 特大暴雨 三档下限',
    contractChange: true,
    // [档0, 档1, 档2] 的绝对阈值（mm）—— 国标原件，不外推
    thresholdsMm: (h) => ({ 12: [30, 70, 140], 24: [50, 100, 250] }[h]),
    bps: [5000, 7500, 10000],
    why: '国标给的三个等级全用上。24h 的特大暴雨线 ≥250mm 在五城 11 年里零命中（见 gbt_probe.js），'
       + '所以这一档是写进合约也赔不到的死条款 —— 正是 v2 那样的问题。',
  },
  B: {
    key: 'B',
    name: '建议：只卖国标前两档，12h 30/70，24h 50/100，赔付 50%/75%',
    source: 'GB/T 28592-2012 表 1 前两档 + gbt_probe.js 的 11 年可达性实测',
    contractChange: true,   // 需要把 hoursAllowed 收成 {12,24}、tierBps 收成两档、thresholdOf 改查表
    thresholdsMm: (h) => ({ 12: [30, 70], 24: [50, 100] }[h]),
    bps: [5000, 7500],
    why: '卖出即可能赔到的两档。第三档不卖的理由是它 11 年零命中（24h）/ 命中率 0.002~0.007%（12h），'
       + '"最高赔 100%"会变成对客户不诚实的表述。',
  },
};

/** 每窗口的赔付比例（0 / 0.50 / 0.75 / 1.00），与 tierOf + tierBps 逐字对齐 */
function payoutFractions(sums, thresholdsMm, bps) {
  const bounds = thresholdsMm.map((t) => Math.round(t * 10)); // 整数十分位
  const out = new Float64Array(sums.length);
  for (let i = 0; i < sums.length; i++) {
    const v = sums[i];
    let f = 0;
    for (let k = 0; k < bounds.length; k++) if (v >= bounds[k]) f = bps[k] / 10000;
    out[i] = f;
  }
  return out;
}

function main() {
  // ── 1. 读缓存（只读一次，两套方案共用）──────────────────────────────────
  const monthSet = new Set();
  const raw = [];
  for (const r of REGIONS) {
    const { times, mm10 } = A.loadCity(r);
    const { idx, keys } = A.monthIndex(times);
    keys.forEach((k) => monthSet.add(k));
    const sums = {};
    for (const h of WINDOWS) sums[h] = A.windowSums(mm10, h);
    raw.push({ key: r.key, name: r.name, idx, sums, nHours: times.length });
  }
  const monthKeys = [...monthSet].sort();
  const nM = monthKeys.length;
  const monthIdx = new Map(monthKeys.map((k, i) => [k, i]));

  const report = {
    meta: {
      generatedBy: '10-金融与定价/tier_design_b2b.js',
      generatedAt: new Date().toISOString(),
      sourceMtime: A.sourceMtime(),
      source: 'Open-Meteo Archive (ERA5) 逐小时; cache/ 五城',
      dataStart: A.DATA_START, dataEnd: A.DATA_END,
      bootstrap: { unit: 'calendar month', reps: REPS, seed: SEED, quantile: 0.975 },
      contract: '03-合约/RainDeliveryInsuranceV2.sol:30-36,172-192',
      payoutMaxEth: PAYOUT_MAX, minPremiumEth: MIN_PREMIUM, targetLossRatio: R_TARGET,
      judgeGasEth: JUDGE_GAS, payoutGasEth: PAYOUT_GAS,
      ceilTickEth: 1 / CEIL_TICK,
      costCalibers: {
        conservative: 'judge + payout，赔付 gas 摊到每一份（上界）',
        expected: 'judge + q×payout，赔付 gas 只在出险时付',
      },
      caveat: '块自举的块长固定为 1 个日历月；真实风险记忆尺度与月长不同，本表只做参数不确定性的一阶修正',
    },
    schemes: {},
  };

  for (const sc of Object.values(SCHEMES)) {
    // ── 2. 逐格按月聚合 ───────────────────────────────────────────────────
    const cellsFlat = [];
    for (const c of raw) {
      for (const h of WINDOWS) {
        const thr = sc.thresholdsMm(h);
        const frac = payoutFractions(c.sums[h], thr, sc.bps);
        const monthOf = new Int32Array(c.sums[h].length);
        for (let j = 0; j < frac.length; j++) monthOf[j] = c.idx[j + h - 1];
        const paySum = new Float64Array(nM);
        const win = new Int32Array(nM);
        for (let j = 0; j < frac.length; j++) {
          const m = monthIdx.get(monthKeys[monthOf[j]]);
          paySum[m] += frac[j]; win[m] += 1;
        }
        let s = 0;
        for (let j = 0; j < frac.length; j++) s += frac[j];
        let nHit = 0;
        for (let j = 0; j < frac.length; j++) if (frac[j] > 0) nHit++;
        cellsFlat.push({
          key: c.key, name: c.name, hours: h, thresholdsMm: thr,
          paySum, win, nWin: frac.length, nHit,
          pointRate: s / frac.length,
        });
      }
    }

    // ── 3. 月聚类块自举（同一次抽样对所有格共用 → 保留城市间相关性）──────────
    const rnd = mulberry32(SEED);
    const cellRates = new Float64Array(cellsFlat.length * REPS);
    const drawn = new Int32Array(nM);
    for (let rep = 0; rep < REPS; rep++) {
      for (let i = 0; i < nM; i++) drawn[i] = (rnd() * nM) | 0;
      for (let ci = 0; ci < cellsFlat.length; ci++) {
        const cell = cellsFlat[ci];
        let p = 0, w = 0;
        for (let i = 0; i < nM; i++) { const m = drawn[i]; p += cell.paySum[m]; w += cell.win[m]; }
        cellRates[ci * REPS + rep] = w > 0 ? p / w : 0;
      }
    }
    const quantile = (arr, a) => {
      const s = Float64Array.from(arr).sort();
      return s[Math.min(s.length - 1, Math.floor(a * s.length))];
    };

    // ── 4. 闸 1 费率闸：按 97.5% 上界定价（不批量的零售口径）────────────────
    const grid = [];
    for (let ci = 0; ci < cellsFlat.length; ci++) {
      const g = cellsFlat[ci];
      const slice = cellRates.subarray(ci * REPS, (ci + 1) * REPS);
      const upRate = quantile(slice, 0.975);
      const p975Eth = upRate * PAYOUT_MAX;
      const q = upRate;                    // 出险率（保守用上界）
      // 零售：判定 gas 全摊在这一份上
      const costRetail = JUDGE_GAS + PAYOUT_GAS * q;
      const premRetail = Math.max(MIN_PREMIUM, ceil4((p975Eth + costRetail) / R_TARGET));
      grid.push({
        regionKey: g.key, regionName: g.name, hours: g.hours,
        thresholdsMm: g.thresholdsMm,
        nWin: g.nWin, nHit: g.nHit,
        pointRatePct: round(g.pointRate * 100, 6),
        p975RatePct: round(upRate * 100, 6),
        loadFactor: round(upRate / (g.pointRate || NaN), 3),
        pointEth: round(g.pointRate * PAYOUT_MAX, 8),
        p975Eth: round(p975Eth, 8),
        costRetailEth: round(costRetail, 8),
        premiumRetailEth: premRetail,
        premiumRetailWei: String(Math.round(premRetail * 1e18)),
        lossRatioAtP975: round(p975Eth / premRetail, 6),
        marginRetailEth: round(premRetail - p975Eth - costRetail, 8),
      });
    }

    // ── 5. 批量档：一次判定覆盖 N 份 → 判定 gas 摊薄 ─────────────────────────
    const BATCH_N = [1, 10, 50, 100, 500, 1000];
    const batch = BATCH_N.map((N) => {
      const rows = grid.map((g) => {
        // 一个批次 = 同一（区域 × 时长）的 N 份；一次判定 0.00013 ETH 由 N 份分摊
        const cost = JUDGE_GAS / N + PAYOUT_GAS * (g.p975Eth / PAYOUT_MAX);
        const premium = Math.max(MIN_PREMIUM, ceil4((g.p975Eth + cost) / R_TARGET));
        return {
          regionKey: g.regionKey, hours: g.hours,
          costPerPolicyEth: round(cost, 8),
          premiumEth: premium,
          marginEth: round(premium - g.p975Eth - cost, 8),
        };
      });
      const portfolioPremium = ceil4(rows.reduce((a, x) => a + x.premiumEth, 0) / rows.length);
      return {
        N,
        costPerPolicyEth: round(rows.reduce((a, x) => a + x.costPerPolicyEth, 0) / rows.length, 8),
        portfolioPremiumEth: portfolioPremium,
        maxCellPremiumEth: Math.max(...rows.map((x) => x.premiumEth)),
        rows,
      };
    });

    // ── 6. 闸 2 敞口闸：组合分散 vs 单格集中 ────────────────────────────────
    const combined = new Float64Array(REPS);
    for (let rep = 0; rep < REPS; rep++) {
      let s = 0;
      for (let ci = 0; ci < cellsFlat.length; ci++) s += cellRates[ci * REPS + rep];
      combined[rep] = s / cellsFlat.length;
    }
    const combPoint = cellsFlat.reduce((a, x) => a + x.pointRate, 0) / cellsFlat.length;
    const combP975 = quantile(combined, 0.975);
    const worst = grid.reduce((a, b) => (b.p975Eth > a.p975Eth ? b : a));
    const concentration = {
      portfolioPointRatePct: round(combPoint * 100, 6),
      portfolioP975RatePct: round(combP975 * 100, 6),
      worstCellKey: `${worst.regionName} ${worst.hours}h`,
      worstCellP975RatePct: round(worst.p975RatePct, 6),
      concentrationPenalty: round((worst.p975RatePct / 100) / combP975, 3),
      diversificationCredit: round(combP975 / combPoint, 3),
      worstCellLoadFactor: worst.loadFactor,
      // 若企业全押最差那一格，每份要多付多少 ETH
      extraPremiumPerPolicyEth: round(worst.premiumRetailEth - ceil4(
        (combP975 * PAYOUT_MAX + JUDGE_GAS) / R_TARGET), 8),
    };

    // ── 7. 闸 3 准备金闸 ──────────────────────────────────────────────────
    const portfolioPremium = batch.find((b) => b.N === 100).portfolioPremiumEth;
    const reserve = {
      perPolicyExposureEth: PAYOUT_MAX,
      meanPerPolicyEth: round(combPoint * PAYOUT_MAX, 8),
      var975PerPolicyEth: round(quantile(combined, 0.975) * PAYOUT_MAX, 8),
      var99PerPolicyEth: round(quantile(combined, 0.99) * PAYOUT_MAX, 8),
      portfolioPremiumEth: portfolioPremium,
      var99OverPremium: round((quantile(combined, 0.99) * PAYOUT_MAX) / portfolioPremium, 6),
      shortfall99PerPolicyEth: round(Math.max(0, quantile(combined, 0.99) * PAYOUT_MAX - portfolioPremium), 8),
      // 月度理论最大损失（闭式）：组合内 N 份全部满额赔付
      closedFormWorstPerPolicyEth: round(PAYOUT_MAX - portfolioPremium, 8),
    };

    // ── 8. 档位可达性（每一档在 11 年里是否够得着）──────────────────────────
    const reach = [];
    for (const c of raw) {
      for (const h of WINDOWS) {
        const sums = c.sums[h];
        const thr = sc.thresholdsMm(h);
        let maxSum = 0;
        for (const v of sums) if (v > maxSum) maxSum = v;
        const pByTier = thr.map((t) => {
          const b = Math.round(t * 10);
          let n = 0;
          for (const v of sums) if (v >= b) n++;
          return round((n / sums.length) * 100, 6);
        });
        reach.push({
          regionKey: c.key, regionName: c.name, hours: h,
          thresholdsMm: thr,
          pByTierPct: pByTier,
          maxObservedMm: round(maxSum / 10, 1),
          // 最高档是否够得着（reachable = 11 年至少命中一次）
          topTierReachable: pByTier[pByTier.length - 1] > 0,
        });
      }
    }

    report.schemes[sc.key] = {
      name: sc.name, source: sc.source, contractChange: sc.contractChange, why: sc.why,
      bps: sc.bps, grid, batch, concentration, reserve, reachability: reach,
    };
  }

  A.emit(path.join(__dirname, 'b2b-tier-design.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

// ── 自检：把「不亏损」写成可失败的断言 ──────────────────────────────────────
function selfCheck(rep) {
  const fails = [];
  const ok = (name, cond, detail) => { if (!cond) fails.push(`${name}${detail ? ' ' + detail : ''}`); };

  for (const key of Object.keys(rep.schemes)) {
    const s = rep.schemes[key];
    for (const g of s.grid) {
      const tag = `[${key}] ${g.regionName} ${g.hours}h`;
      // 硬约束 1：保费 ≥ 地板
      ok(`${tag} 保费不低于地板`, g.premiumRetailEth >= MIN_PREMIUM, `${g.premiumRetailEth}`);
      // 硬约束 2：97.5% 上界下，扣掉成本后每份不亏（这就是「不亏损」的形式化）
      ok(`${tag} 上界口径下每份不亏`, g.marginRetailEth >= -1e-12, `${g.marginRetailEth}`);
      // 硬约束 3：97.5% 上界 ≥ 点估计
      ok(`${tag} 上界 ≥ 点估计`, g.p975RatePct >= g.pointRatePct - 1e-9);
      // 硬约束 4：阈值严格递增
      for (let k = 1; k < g.thresholdsMm.length; k++) {
        ok(`${tag} 阈值严格递增`,
          g.thresholdsMm[k - 1] < g.thresholdsMm[k], JSON.stringify(g.thresholdsMm));
      }
      // 硬约束 5：档数与赔付比例数一致
      ok(`${tag} 档数与 bps 一致`, g.thresholdsMm.length === s.bps.length,
        `${g.thresholdsMm.length} vs ${s.bps.length}`);
    }
    // 批量越大，判定 gas 摊薄后单价单调不增
    const bs = s.batch;
    for (let i = 1; i < bs.length; i++) {
      ok(`[${key}] 批量 ${bs[i].N} 的单价 ≤ 批量 ${bs[i - 1].N}`,
        bs[i].portfolioPremiumEth <= bs[i - 1].portfolioPremiumEth + 1e-12,
        `${bs[i].portfolioPremiumEth} vs ${bs[i - 1].portfolioPremiumEth}`);
    }
    // 集中度惩罚 ≥ 1（分散不会比集中更贵）
    ok(`[${key}] 集中度惩罚 ≥ 1`, s.concentration.concentrationPenalty >= 1, `${s.concentration.concentrationPenalty}`);
    // 组合上界 ≤ 最差单格上界
    ok(`[${key}] 组合上界 ≤ 最差单格上界`,
      s.concentration.portfolioP975RatePct <= s.concentration.worstCellP975RatePct + 1e-9);
    // 准备金：VaR99 ≥ VaR97.5 ≥ 均值
    ok(`[${key}] VaR99 ≥ VaR97.5 ≥ 均值`,
      s.reserve.var99PerPolicyEth >= s.reserve.var975PerPolicyEth - 1e-12 &&
      s.reserve.var975PerPolicyEth >= s.reserve.meanPerPolicyEth - 1e-12,
      `${s.reserve.var99PerPolicyEth}/${s.reserve.var975PerPolicyEth}/${s.reserve.meanPerPolicyEth}`);
    // 可达性：档位概率单调不增
    for (const r of s.reachability) {
      let mono = true;
      for (let k = 1; k < r.pByTierPct.length; k++) if (r.pByTierPct[k] > r.pByTierPct[k - 1] + 1e-9) mono = false;
      ok(`[${key}] ${r.regionName} ${r.hours}h 档位概率单调不增`, mono, JSON.stringify(r.pByTierPct));
    }
  }

  // 已知事实回填（GB/T 28592-2012 + gbt_probe.js 的 11 年逐小时窗口实测）：
  // ① 国标 24h 特大暴雨线 ≥250mm 五城零命中 → 方案 A 的 24h 档2 必须全为 0
  const a24 = rep.schemes.A.reachability.filter((r) => r.hours === 24);
  ok('A 方案 24h 档2（≥250mm）五城全不可达', a24.every((r) => r.pByTierPct[2] === 0),
    JSON.stringify(a24.map((r) => r.pByTierPct[2])));
  // ② 国标 12h 特大暴雨线 ≥140mm 有命中（5 城合计 15 次）→ 至少一城可达
  const a12 = rep.schemes.A.reachability.filter((r) => r.hours === 12);
  ok('A 方案 12h 档2（≥140mm）至少一城可达', a12.some((r) => r.pByTierPct[2] > 0),
    JSON.stringify(a12.map((r) => r.pByTierPct[2])));
  // ③ 方案 B 只卖两档，且这两档在 10 格里全部可达 —— 这是"卖给客户的话都兑得现"的形式化
  ok('B 方案只有两档', rep.schemes.B.bps.length === 2, JSON.stringify(rep.schemes.B.bps));
  ok('B 方案两档在 10 格里全部可达',
    rep.schemes.B.reachability.every((r) => r.pByTierPct[0] > 0 && r.pByTierPct[1] > 0),
    JSON.stringify(rep.schemes.B.reachability.map((r) => r.pByTierPct.slice(0, 2))));
  return fails;
}

// ── 打印 ───────────────────────────────────────────────────────────────────
function printReport(rep) {
  const pad = (v, n) => String(v).padStart(n);
  for (const key of Object.keys(rep.schemes)) {
    const s = rep.schemes[key];
    console.log(`\n${'═'.repeat(96)}`);
    console.log(`方案 ${key}：${s.name}`);
    console.log(`  ${s.source}${s.contractChange ? '   ← 需要改合约' : '   ← 无需改合约'}`);
    console.log(`${'═'.repeat(96)}`);

    console.log(`\n档位 1 · 费率表（区域 × 时长 = ${s.grid.length} 格）`);
    console.log('区域   时长  档线mm         命中/窗口   点估计p   97.5%上界  上界倍数  上界赔付    成本     建议保费  上界赔付率  每份毛利');
    for (const g of s.grid) {
      console.log(
        `${g.regionName}  ${pad(g.hours + 'h', 4)}  ${pad(g.thresholdsMm.join('/'), 14)}  ` +
        `${pad(g.nHit + '/' + g.nWin, 12)}  ${pad(g.pointRatePct, 9)}%  ${pad(g.p975RatePct, 10)}%  ` +
        `${pad(g.loadFactor, 7)}x  ${pad(g.p975Eth, 9)}  ${pad(g.costRetailEth, 9)}  ` +
        `${pad(g.premiumRetailEth, 8)}  ${pad(g.lossRatioAtP975, 10)}  ${pad(g.marginRetailEth, 10)}`
      );
    }

    console.log('\n档位 2 · 批量规模（一次 AI 判定覆盖一个批次 → 判定 gas 摊薄）');
    console.log('批次 N   每份成本     组合保费    最贵单格');
    for (const b of s.batch) {
      console.log(`${pad(b.N, 6)}  ${pad(b.costPerPolicyEth, 11)}  ${pad(b.portfolioPremiumEth, 10)}  ${pad(b.maxCellPremiumEth, 9)}`);
    }

    console.log('\n档位 3 · 风险集中度');
    const c = s.concentration;
    console.log(`组合（${s.grid.length} 格等权）点估计 ${c.portfolioPointRatePct}%  →  97.5% 上界 ${c.portfolioP975RatePct}%`);
    console.log(`最差单格（${c.worstCellKey}）97.5% 上界 ${c.worstCellP975RatePct}%，上界倍数 ${c.worstCellLoadFactor}x`);
    console.log(`全押一格要多收 ${c.concentrationPenalty} 倍；分散后参数不确定性只剩 ${c.diversificationCredit} 倍`);

    console.log('\n档位 4 · 准备金（组合，100 份批量保费 ' + s.reserve.portfolioPremiumEth + ' ETH/份）');
    console.log(`每份期望赔付 ${s.reserve.meanPerPolicyEth}  VaR97.5 ${s.reserve.var975PerPolicyEth}  VaR99 ${s.reserve.var99PerPolicyEth}` +
      `  VaR99/保费 ${s.reserve.var99OverPremium}  99% 缺口 ${s.reserve.shortfall99PerPolicyEth}`);

    console.log(`\n档位 5 · 各档可达性（%，共 ${s.bps.length} 档）`);
    const nT = s.bps.length;
    console.log('区域   时长  档线mm          ' + Array.from({ length: nT }, (_, k) => pad('档' + k, 8)).join('  ') + '  11年最大mm  最高档可达');
    for (const r of s.reachability) {
      console.log(
        `${r.regionName}  ${pad(r.hours + 'h', 4)}  ${pad(r.thresholdsMm.join('/'), 14)}  ` +
        r.pByTierPct.slice(0, nT).map((v) => pad(v, 8)).join('  ') + '  ' +
        `${pad(r.maxObservedMm, 10)}  ${r.topTierReachable ? 'YES' : 'no '}`
      );
    }
  }
}

if (require.main === module) {
  const rep = main();
  if (process.argv.slice(2).includes('--self-check')) {
    const fails = selfCheck(rep);
    console.log(`\n自检结果：${fails.length === 0 ? '全部通过' : fails.length + ' 项失败'}`);
    fails.forEach((f) => console.log('  FAIL  ' + f));
    process.exit(fails.length === 0 ? 0 : 1);
  } else {
    printReport(rep);
  }
}

module.exports = { main, selfCheck, payoutFractions, SCHEMES };
