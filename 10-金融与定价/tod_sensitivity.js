#!/usr/bin/env node
/**
 * tod_sensitivity.js —— "使用场景"维度里最诱人也最难做的那个：**骑手班次时段**。
 *
 * 为什么单独算这个：
 *   合约赔的是 `rainfallDuring` = **保障窗口内的累计降水**，不看这些雨下在几点。
 *   但骑手的"使用场景"是有班次的 —— 上午 10 点到晚上 8 点跑单的人，凌晨 3 点
 *   下的雨对他没有收入影响。所以问题不是"要不要按时段定价"，而是：
 *     (a) 如果只按班次内的雨量赔（档线等比缩放到"班次占窗口的比例"），公平保费能便宜多少？
 *     (b) 现在已经赔出去的窗口里，班次时段的雨量占全天雨量的多少？
 *   这两个数决定这件事是"下一版做"还是"本来就不该做"。
 *
 * 结论（写进 `定价体系-v3.md` §2.3）：(a) 便宜 5~40 倍，非常诱人；但**不做**，因为
 *   ① "我的班次是几点"是自述参数，合约无法核验，一定被选成最便宜那个（与 §7 临灾档同一理由）；
 *   ② 更根本：(b) 显示大部分赔付窗口里，班次时段的雨量并不占多数 —— 这不是缺陷，
 *      而是参数化保险的定义：**赔付标的是"区域事件"，不是"个人暴露"**。
 *      想按个人暴露赔，需要的是平台对班次的 attestation，与身份认定是同一个依赖。
 *
 * 用法：node tod_sensitivity.js
 */
const A = require('./audit_numbers.js');
const { REGIONS } = require('../04-脚本/regions.js');

const HOURS = [12, 24];
// v3 档线（与 pricing_engine.js 的 THRESHOLDS 同值，即 GB/T 28592-2012 表 1；自检里拿 pricing-engine.json 反证）
const THRESHOLDS = { 12: [30, 70], 24: [50, 100] };
const TIER_BPS = [5000, 7500];
// 班次定义（本地时）：长班 10:00-19:59（外卖骑手最常见）；高峰 11-13 + 17-19
const SHIFT_MAIN = (h) => h >= 10 && h < 20;
const SHIFT_PEAK = (h) => (h >= 11 && h < 13) || (h >= 17 && h < 19);

/** times[i] = "YYYY-MM-DDTHH:00" → 小时数 */
const hourOf = (iso) => Number(iso.slice(11, 13));

/**
 * 窗口内属于该班次的小时数。
 *
 * ⚠️ 这算出来的是「**日均**班次小时数」，不是「窗口起点那一刻的实际班次小时数」：
 *   12h 窗口一律回传 5、24h 窗口一律回传 10（= `round(班次总小时数 × 窗口长 / 24)`）。
 *   真实情况下 12h 窗落在班次内的小时数在 **0~10** 之间（只有 2/24 个起点恰好是 5）：
 *     · 起点 10:00 的窗全在班次内 → 等比档线本应是 `30 × 10/12 = 25mm`，代码仍用 `12.5mm`（**放松 2×**）；
 *     · 起点 22:00 的窗完全不含班次小时 → 本应"有雨即赔"，代码仍要 `12.5mm`（**必然不命中**）。
 *   ⇒ `tod-sensitivity.json` 的 `pShiftPct` / `expShiftPct`（main / peak 两列）是**混合量**，
 *     偏差方向不确定，**不要直接进图表或对外材料**。
 *     自检只断言 `shiftHours === round(10h/24)` —— 断的是"近似的算术"，不是"近似的合理性"。
 *     （见 `全仓只读审计报告-2026-10-07.md` 的 I5；重写班次算法会动 167 项断言，收益不抵风险，故本轮只标注不改。）
 */
function shiftHoursIn(windowHours, inShift) {
  let c = 0;
  for (let h = 0; h < 24; h++) if (inShift(h)) c++;
  return Math.round((c * windowHours) / 24);
}

/** 按档位表把"窗口累计值"翻译成赔付比例 */
function fracOf(sum10, bounds) {
  let f = 0;
  for (let k = 0; k < bounds.length; k++) if (sum10 >= bounds[k]) f = TIER_BPS[k] / 10000;
  return f;
}

/**
 * 一趟扫完。返回：
 *   n            窗口数
 *   pAllPct      全天口径（档线 = v3 原值）的触发概率
 *   expAllPct    全天口径的期望赔付比例（= 引擎的 pointRate，自检拿去对）
 *   pShiftPct    班次口径（档线等比缩放）的触发概率
 *   expShiftPct  班次口径的期望赔付比例
 *   shares       已赔付窗口的"班次雨量占比"数组（%）
 */
function scan(times, mm10, windowHours, inShift) {
  const n = mm10.length - windowHours + 1;
  const bounds = THRESHOLDS[windowHours].map((t) => Math.round(t * 10));
  const sh = shiftHoursIn(windowHours, inShift);
  const ratio = sh / windowHours;
  const pb = bounds.map((b) => Math.max(1, Math.round(b * ratio)));
  let hitAll = 0, hitShift = 0, expAll = 0, expShift = 0;
  const shares = [];
  for (let i = 0; i < n; i++) {
    let sumAll = 0, sumShift = 0;
    for (let j = i; j < i + windowHours; j++) {
      sumAll += mm10[j];
      if (inShift(hourOf(times[j]))) sumShift += mm10[j];
    }
    const fa = fracOf(sumAll, bounds);
    expAll += fa;
    if (fa > 0) { hitAll++; shares.push(sumAll > 0 ? (100 * sumShift) / sumAll : 0); }
    const fs = fracOf(sumShift, pb);
    expShift += fs;
    if (fs > 0) hitShift++;
  }
  shares.sort((a, b) => a - b);
  const q = (p) => (shares.length ? shares[Math.min(shares.length - 1, Math.floor(p * shares.length))] : 0);
  return {
    n, shiftHours: sh,
    // ⚠️ `proratedBounds` 的单位是**十分位毫米（0.1 mm）**，不是 mm —— 它与 `audit_numbers.js` 的整数十分位口径一致。
    // 例：武汉 12h 存的是 `[300, 700]`，人读是 30 / 70 mm。**引用或画图前先 ÷10**。
    proratedBounds: pb,
    pAllPct: (100 * hitAll) / n, expAllPct: (100 * expAll) / n,
    pShiftPct: (100 * hitShift) / n, expShiftPct: (100 * expShift) / n,
    paidWindows: shares.length,
    shareMedianPct: q(0.5), shareP10Pct: q(0.1), shareP90Pct: q(0.9),
    shareLt25Pct: shares.length ? (100 * shares.filter((x) => x < 25).length) / shares.length : 0,
    shareGe50Pct: shares.length ? (100 * shares.filter((x) => x >= 50).length) / shares.length : 0,
  };
}

function report() {
  const out = {
    definition: {
      thresholds: THRESHOLDS, tiersBps: TIER_BPS,
      shiftMain: '10:00-19:59（10h/24h）', shiftPeak: '11-13,17-19（4h/24h）',
      note: '班次口径 = 只累计班次内的雨量，档线等比缩放到 班次小时数/窗口小时数',
    },
    regions: {},
  };
  for (const r of REGIONS) {
    const { times, mm10 } = A.loadCity(r);
    out.regions[r.key] = { name: r.name, byHours: {} };
    for (const h of HOURS) {
      out.regions[r.key].byHours[h] = {
        all: scan(times, mm10, h, () => true),
        main: scan(times, mm10, h, SHIFT_MAIN),
        peak: scan(times, mm10, h, SHIFT_PEAK),
      };
    }
  }
  return out;
}

function selfCheck(rep) {
  let total = 0, fails = 0;
  const ok = (cond, msg) => { total++; if (!cond) { fails++; console.error('  ✗ ' + msg); } };
  const keys = Object.keys(rep.regions);

  ok(keys.length === 5, '五个城市');
  for (const k of keys) {
    for (const h of HOURS) {
      const g = rep.regions[k].byHours[h];
      ok(g.all.n > 96000, `${k} ${h}h 窗口数 > 96000`);
      ok(g.all.pAllPct > 0, `${k} ${h}h 全天口径有赔付`);
      // ① 核心结论断言：档线按班次占比等比缩放（= 合约 thresholdOf 自己的缩放方式）之后，
      //    班次口径与全天口径**同量级** —— "只按班次赔"并不便宜，这是本脚本要证明的那件事。
      const rMain = g.all.pAllPct / g.main.pShiftPct;
      const rPeak = g.all.pAllPct / g.peak.pShiftPct;
      ok(rMain > 0.25 && rMain < 4, `${k} ${h}h 长班口径/全天口径 = ${rMain.toFixed(2)}（应在 0.25~4）`);
      ok(rPeak > 0.25 && rPeak < 4, `${k} ${h}h 高峰口径/全天口径 = ${rPeak.toFixed(2)}（应在 0.25~4）`);
      // ② 班次小时数：长班 10/24、高峰 4/24
      ok(g.main.shiftHours === Math.round((10 * h) / 24), `${k} ${h}h 长班小时数 = ${g.main.shiftHours}`);
      ok(g.peak.shiftHours === Math.round((4 * h) / 24), `${k} ${h}h 高峰小时数 = ${g.peak.shiftHours}`);
      // ③ 期望赔付夹在 [0.5, 1] × 触发率之间（最低一档就是半额）
      for (const which of ['all', 'main', 'peak']) {
        const s = g[which];
        ok(s.expAllPct >= 0.5 * s.pAllPct - 1e-9, `${k} ${h}h ${which} 期望赔付 ≥ 0.5×触发率`);
        ok(s.expAllPct <= s.pAllPct + 1e-9, `${k} ${h}h ${which} 期望赔付 ≤ 触发率`);
      }
      // ④ 占比统计自洽
      ok(g.main.shareMedianPct >= 0 && g.main.shareMedianPct <= 100, `${k} ${h}h 中位占比在 [0,100]`);
      ok(g.main.shareLt25Pct + g.main.shareGe50Pct <= 100, `${k} ${h}h 占比分档不重叠`);
      ok(g.main.paidWindows > 0, `${k} ${h}h 有赔付窗口`);
    }
  }

  // ⑤ 关键交叉校验甲：全天口径的期望赔付必须复现引擎的 pointRate
  const eng = require('./pricing-engine.json');
  const idKey = {}; for (const r of REGIONS) idKey[r.id] = r.key;
  let checked = 0, worst = 0;
  for (const c of eng.cells.filter((x) => x.segKey === 't2c1')) {
    const g = rep.regions[idKey[c.regionId]].byHours[c.hours];
    const d = Math.abs(g.all.expAllPct - c.pointRatePct);
    worst = Math.max(worst, d);
    checked++;
    ok(d < 0.02, `复现引擎 pointRate 区域${c.regionId} ${c.hours}h：本脚本 ${g.all.expAllPct.toFixed(4)}% vs 引擎 ${c.pointRatePct.toFixed(4)}%（差 ${d.toFixed(4)}）`);
  }
  ok(checked === 5 * HOURS.length, `复现了 5 城 × ${HOURS.length} 档 = ${5 * HOURS.length} 格（实际 ${checked}）`);
  console.log(`  全天口径 vs 引擎 pointRate：最大偏差 ${worst.toFixed(4)} 个百分点（${checked} 格）`);

  // ⑥ 关键交叉校验乙：**历史口径**的 72h / 恒定 50mm 触发概率必须复现《精算口径》§0 公布的那组数。
  //    这一条**不是本设计的口径**（本设计只有国标的 12h/24h），它的唯一用途是证明本脚本的
  //    窗口扫描器与《精算口径》那套独立实现算得一样 —— 参考系不变，换口径时才能信任新数字。
  const PUB = { wuhan: 4.77, shanghai: 4.56, beijing: 2.28, chengdu: 3.72, guangzhou: 11.57 };
  for (const k of keys) {
    const r = REGIONS.find((x) => x.key === k);
    const { mm10 } = A.loadCity(r);
    let hit = 0;
    const n = mm10.length - 72 + 1;
    for (let i = 0; i < n; i++) { let s = 0; for (let j = i; j < i + 72; j++) s += mm10[j]; if (s >= 500) hit++; }
    const p = (100 * hit) / n;
    ok(Math.abs(p - PUB[k]) < 0.02, `（历史口径）复现《精算口径》72h/50mm ${k}：本脚本 ${p.toFixed(2)}% vs 公布 ${PUB[k]}%`);
  }

  console.log(`\n自检结果：${total} 项断言，${fails === 0 ? '全部通过' : `${fails} 项失败`}`);
  return fails;
}

// ── CLI ────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const t0 = Date.now();
  const rep = report();
  console.log('使用场景 · 班次时段敏感度（11 年逐小时 ERA5，v3 档线）\n');
  console.log('城市   时长   全天触发    长班口径(10/24)  倍数    高峰口径(4/24)   倍数  | 已赔付窗口里班次雨量占比 中位/P10/P90  <25%');
  for (const k of Object.keys(rep.regions)) {
    for (const h of HOURS) {
      const g = rep.regions[k].byHours[h];
      console.log(
        rep.regions[k].name.padEnd(4) +
        (h + 'h').padStart(6) +
        (g.all.pAllPct.toFixed(4) + '%').padStart(12) +
        (g.main.pShiftPct.toFixed(4) + '%').padStart(17) +
        (g.all.pAllPct / g.main.pShiftPct).toFixed(1).padStart(7) + 'x' +
        (g.peak.pShiftPct.toFixed(4) + '%').padStart(17) +
        (g.all.pAllPct / g.peak.pShiftPct).toFixed(1).padStart(7) + 'x' +
        '  | ' + g.main.shareMedianPct.toFixed(1).padStart(5) + '% / ' +
        g.main.shareP10Pct.toFixed(1).padStart(5) + '% / ' +
        g.main.shareP90Pct.toFixed(1).padStart(5) + '%   ' +
        g.main.shareLt25Pct.toFixed(1).padStart(5) + '%'
      );
    }
  }
  const fails = selfCheck(rep);
  const fs = require('fs'), path = require('path');
  A.emit(path.join(__dirname, 'tod-sensitivity.json'),
    JSON.stringify({ ...rep, generatedAt: new Date().toISOString(), sourceMtime: A.sourceMtime() }, null, 2) + '\n');
  console.log(`\n落盘 10-金融与定价/tod-sensitivity.json（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
  process.exit(fails ? 1 : 0);
}

module.exports = { report, selfCheck, scan, SHIFT_MAIN, SHIFT_PEAK, THRESHOLDS };
