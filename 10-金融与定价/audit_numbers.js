#!/usr/bin/env node
/**
 * 精算数值复核脚本（零浮点 / 零蒙特卡洛）
 *
 * 用途：让第三方（评委、审计、队友）不依赖我们的任何中间产物，直接从原始逐小时
 *      降雨数据复算《精算口径.md》引用的每一个触发概率，并亲眼看到：
 *        1) 权威命中数（整数十分位口径，零浮点误差）
 *        2) 与 `actuary-output.json` 的差异（即浮点累加漏计了多少个边界窗口）
 *        3) 每个 p 的 95% 区间（月聚类块自举）—— 用来判断「广州越线」是否显著
 *
 * 复现：cd 10-金融与定价 && node audit_numbers.js
 * 输出：控制台表格 + `audit-verified.json`
 *
 * 口径与阈值：见文末 `--self-check`。
 */
const fs = require('fs');
const path = require('path');
const { REGIONS } = require('../04-脚本/regions.js');

// ── 输入 ────────────────────────────────────────────────────────────────────
// 注意：这里的起止日期是**历史样本区间**，与 regions.js 的 RAIN_EPOCH（链上累计
// 起点 2026-10-01）是两个不同的东西，不要混用。样本区间必须覆盖完整水文年。
const DATA_START = '2015-10-01';
const DATA_END = '2026-09-30';
const CACHE_DIR = path.join(__dirname, 'cache');
const CACHE_FILE = (key) => path.join(CACHE_DIR, `${key}-${DATA_START}_${DATA_END}.json`);
const DURATIONS = [6, 12, 24, 48, 72, 168];
const THRESHOLD = 50;

// ── 权威口径：整数十分位 ─────────────────────────────────────────────────────
// 为什么不用浮点求和：50.0mm 恰是双精度可表示数，而 ERA5 的 hourly precipitation
// 是 0.1mm 的十进制小数（如 0.1、0.3），二进制下不可精确表示。
// 增量累加滑动窗口时，恰好等于 50.0mm 的窗口会单向漏计（广州 72h 有 49 个这样的窗口）。
// 换成 Kahan 求和或前缀和都不能消除：三种方法分别给 11153 / 11140 / 11134。
// 唯一确定解是把数据放大 10 倍取整，全程整数运算。
const toDecimillimetres = (v) => Math.round((v ?? 0) * 10); // 0.1mm → 1

function loadCity(region) {
  const file = CACHE_FILE(region.key);
  if (!fs.existsSync(file)) {
    throw new Error(
      `缺少缓存文件 ${file}\n  先运行：node actuary.js --refresh（会联网重新下载）`
    );
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const times = raw.hourly.time;
  const mm10 = raw.hourly.precipitation.map(toDecimillimetres);
  return { times, mm10, meta: { latitude: raw.latitude, longitude: raw.longitude, elevation: raw.elevation } };
}

/**
 * 数据源新鲜度：`cache/` 下本样本区间缓存文件里**最新**的 mtime。
 *
 * 为什么需要它：产物里的 `generatedAt` 只说明"脚本什么时候跑的"，**判不出"数是不是旧的"** ——
 * 曾经出现过三个产物 `generatedAt` 17:30 而文件 mtime 19:03（Δ1h33m）的情况，
 * 也出现过产物 mtime 早于生成它的脚本 38 分钟的情况。把 `sourceMtime` 与 `generatedAt`
 * 一起写进产物，任何"数比代码旧"都能一眼看出来。
 */
function sourceMtime() {
  try {
    const files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith(`-${DATA_START}_${DATA_END}.json`));
    let newest = 0;
    for (const f of files) {
      const m = fs.statSync(path.join(CACHE_DIR, f)).mtimeMs;
      if (m > newest) newest = m;
    }
    return newest ? new Date(newest).toISOString() : null;
  } catch { return null; }
}

/** 滚动窗口命中：返回 {windows, hits}，全程整数 */
function countHits(mm10, windowHours) {
  const sum10 = THRESHOLD * 10; // 阈值换算到同一单位
  let rolling = 0;
  let hits = 0;
  let windows = 0;
  for (let i = 0; i < mm10.length; i++) {
    rolling += mm10[i];
    if (i >= windowHours) rolling -= mm10[i - windowHours];
    if (i >= windowHours - 1) {
      windows++;
      if (rolling >= sum10) hits++;
    }
  }
  return { windows, hits };
}

/** 逐窗口累计值（整数），供区间估计与边界窗口核对使用 */
function windowSums(mm10, windowHours) {
  const out = new Int32Array(Math.max(0, mm10.length - windowHours + 1));
  let rolling = 0;
  for (let i = 0; i < mm10.length; i++) {
    rolling += mm10[i];
    if (i >= windowHours) rolling -= mm10[i - windowHours];
    if (i >= windowHours - 1) out[i - windowHours + 1] = rolling;
  }
  return out;
}

// ── 区间估计：月聚类块自举 ──────────────────────────────────────────────────
// 为什么不用二项分布：72h 滑动窗口高度重叠（96,361 个窗口的真实信息量按不同口径
// 只有 1339 / 132 / 10），二项 SE 会小 34~102 倍，是纯伪精度。
function monthIndex(times) {
  const idx = new Int32Array(times.length);
  const map = new Map();
  const keys = [];
  for (let i = 0; i < times.length; i++) {
    const k = times[i].slice(0, 7); // "YYYY-MM"
    let v = map.get(k);
    if (v === undefined) {
      v = keys.length;
      keys.push(k);
      map.set(k, v);
    }
    idx[i] = v;
  }
  return { idx, keys };
}

function bootstrapCI(hitFlags, monthOf, nMonths, { reps = 4000, seed = 20261007 } = {}) {
  // 每个月的 hit 计数与其窗口数
  const hitByMonth = new Float64Array(nMonths);
  const winByMonth = new Float64Array(nMonths);
  for (let m = 0; m < hitFlags.length; m++) {
    winByMonth[monthOf[m]]++;
    if (hitFlags[m]) hitByMonth[monthOf[m]]++;
  }
  const months = [];
  for (let m = 0; m < nMonths; m++) {
    if (winByMonth[m] > 0) months.push([hitByMonth[m], winByMonth[m]]);
  }
  // 玩具 PRNG（xorshift32），保证同种子逐位可复现
  let state = seed >>> 0;
  const rand = () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
  const samples = new Float64Array(reps);
  for (let r = 0; r < reps; r++) {
    let h = 0, w = 0;
    for (let i = 0; i < months.length; i++) {
      const [mh, mw] = months[(rand() * months.length) | 0];
      h += mh; w += mw;
    }
    samples[r] = (h / w) * 100;
  }
  samples.sort();
  const q = (a) => samples[Math.min(samples.length - 1, Math.floor(a * samples.length))];
  return { lo: q(0.025), hi: q(0.975), months: months.length };
}

// ── 边界窗口核对：恰好等于阈值的窗口有多少个 ────────────────────────────────
function boundaryWindows(sums) {
  let exact = 0;
  const lo = THRESHOLD * 10;
  for (const v of sums) if (v === lo) exact++;
  return exact;
}

// ── A7 分档（**与合约 v2 逐字对齐**，改这里必须同步改合约）────────────────────
// 权威定义在 `03-合约/RainDeliveryInsuranceV2.sol:172-192`：
//   thresholdOf(hours) = THRESHOLD_PER_24H(=50) * hours / 24
//     → 24h=50mm  48h=100mm  72h=150mm
//   tierOf(during, hours): during >= base*5 → 2（特大暴雨，100%）
//                          during >= base*2 → 1（大暴雨，  75%）
//                          during >= base   → 0（暴雨，    50%）
//                          否则 TIER_NONE（不触发）
//   tierBps: 0→5000  1→7500  2→10000；赔款 = PAYOUT_MAX * bps / 10000
//
// 比较一律走整数十分位（`sum10 >= basis10`），否则 50.0mm 这类边界又会踩浮点坑
// （同一个坑已经让 72h 广州的命中数在 11105/11134/11140/11153 之间摇摆）。
const TIERS = [
  { tier: 0, mult: 1, bps: 5000,  note: '暴雨（= 国标 50mm/24h）→ 赔 50%' },
  { tier: 1, mult: 2, bps: 7500,  note: '大暴雨（= 国标 100mm/24h）→ 赔 75%' },
  { tier: 2, mult: 5, bps: 10000, note: '特大暴雨（= 国标 250mm/24h）→ 赔 100%' },
];

/** 按合约 v2 的 thresholdOf 算基准线（单位：十分之一毫米，整数） */
const thresholdBasis10 = (windowHours) => Math.round((THRESHOLD * 10 * windowHours) / 24);

function tierStats(sums, windowHours) {
  const basis10 = thresholdBasis10(windowHours);
  const counts = new Array(TIERS.length + 1).fill(0); // 末位 = 未触发
  const bounds = TIERS.map((t) => basis10 * t.mult);
  for (const sum of sums) {
    let hit = TIERS.length; // 默认未触发
    for (let i = 0; i < TIERS.length; i++) if (sum >= bounds[i]) hit = i;
    counts[hit]++;
  }
  const n = sums.length;
  const probs = counts.map((c) => c / n);
  const expectedPayoutFraction = TIERS.reduce((a, t, i) => a + probs[i] * (t.bps / 10000), 0);
  const fairPremiumEth = expectedPayoutFraction * 0.01; // PAYOUT_MAX = 0.01 ETH
  return {
    windowHours,
    thresholdMm: round(basis10 / 10, 4),
    thresholdsMm: bounds.map((b) => round(b / 10, 4)),
    counts,
    pctByTier: probs.map((x) => round(x * 100, 6)),
    pctNotTriggered: round(probs[TIERS.length] * 100, 6),
    expectedPayoutFraction: round(expectedPayoutFraction, 8),
    expectedLossEth: round(fairPremiumEth, 8),
    premiumAt60pct: round(fairPremiumEth / 0.6, 8),
  };
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
function main() {
  const argv = process.argv.slice(2);
  const baseline = readBaseline();
  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      sourceMtime: sourceMtime(),
      thresholdMm: THRESHOLD,
      durations: DURATIONS,
      dataStart: DATA_START,
      dataEnd: DATA_END,
      method: 'integer decimillimetre sliding window',
      bootstrapReps: 4000,
      bootstrapSeed: 20261007,
      cacheDir: path.relative(process.cwd(), CACHE_DIR).replace(/\\/g, '/'),
      source: 'Open-Meteo Archive (ERA5) hourly precipitation_sum, timezone Asia/Shanghai',
      a7Tiers: TIERS,
      a7Source: '03-合约/RainDeliveryInsuranceV2.sol:172-192 (thresholdOf / tierOf / tierBps)',
      payoutMaxEth: 0.01,
      targetLossRatio: 0.6,
    },
    cities: {},
  };

  console.log('\n权威口径复核：整数十分位（零浮点）滑动窗口');
  console.log(`阈值 ${THRESHOLD}mm ｜ 数据区间 ${DATA_START} ~ ${DATA_END} ｜ 逐小时\n`);

  for (const region of REGIONS) {
    const { times, mm10, meta } = loadCity(region);
    const { idx, keys } = monthIndex(times);
    const entry = { hours: times.length, grid: meta, windows: {}, perYear72h: {} };
    entry.firstHour = times[0];
    entry.lastHour = times[times.length - 1];

    console.log(`── ${region.name}（${region.key}）格点 ${meta.latitude},${meta.longitude} 海拔 ${meta.elevation}m ──`);
    console.log('  窗口   权威命中/窗口数      权威 p       JSON p     差异(pp)   95% 区间(月聚类)   恰好=50mm');

    for (const h of DURATIONS) {
      const { windows, hits } = countHits(mm10, h);
      const p = (hits / windows) * 100;
      const sums = windowSums(mm10, h);

      let ci = null;
      if (h === 72) {
        const flags = new Uint8Array(sums.length);
        for (let i = 0; i < sums.length; i++) flags[i] = sums[i] >= THRESHOLD * 10 ? 1 : 0;
        ci = bootstrapCI(flags, idx, keys.length);
      }

      const jsonP = baseline?.[region.key]?.windows?.[String(h)]?.p;
      const jsonPct = jsonP === undefined ? null : jsonP * 100;
      const diff = jsonPct === null ? null : p - jsonPct;
      const exact = boundaryWindows(sums);

      entry.windows[String(h)] = {
        windows, hits, pPct: round(p, 4), boundariesAtThreshold: exact,
        jsonPct: jsonPct === null ? null : round(jsonPct, 4),
        diffPp: diff === null ? null : round(diff, 4),
        ci95: ci ? { lo: round(ci.lo, 3), hi: round(ci.hi, 3), clusters: ci.months } : null,
      };

      // A7 四档（只对合约要卖的窗口算：24/48/72h）
      if (h === 24 || h === 48 || h === 72) entry.tiers = entry.tiers || {};
      if (h === 24 || h === 48 || h === 72) entry.tiers[String(h)] = tierStats(sums, h);

      console.log(
        `  ${String(h).padStart(3)}h  ${String(hits).padStart(6)}/${String(windows).padEnd(6)}  ` +
        `${p.toFixed(4).padStart(8)}%  ${(jsonPct === null ? '—' : jsonPct.toFixed(4)).padStart(8)}%  ` +
        `${(diff === null ? '—' : diff.toFixed(4)).padStart(7)}   ` +
        `${(ci ? `[${ci.lo.toFixed(2)}, ${ci.hi.toFixed(2)}]` : '').padEnd(17)}  ${String(exact).padStart(4)}`
      );
    }
    // A7 分档分布（只对合约 v2 会卖的窗口算：24/48/72h）
    for (const h of ['24', '48', '72']) {
      const t = entry.tiers?.[h];
      if (!t) continue;
      // 注意 pctByTier 已经是百分数（0~100），不要再乘 100
      const cells = t.pctByTier.map((x, i) =>
        i < TIERS.length ? `${i}档${x.toFixed(4)}%` : `未触发${x.toFixed(4)}%`
      ).join(' ');
      console.log(
        `  A7 ${h.padStart(3)}h  基准 ${String(t.thresholdMm).padStart(6)}mm  ` +
        `线 ${t.thresholdsMm.join('/')}mm\n          ${cells}\n          → 期望赔付 ` +
        `${(t.expectedPayoutFraction * 100).toFixed(5)}% = ${t.expectedLossEth} ETH/份` +
        `  →  R*=60% 公平保费 ${t.premiumAt60pct} ETH`
      );
    }
    console.log('');
    report.cities[region.key] = entry;
  }

  // 落盘
  const outFile = path.join(__dirname, 'audit-verified.json');
  emit(outFile, JSON.stringify(report, null, 2) + '\n');
  console.log(`已写出 ${path.relative(process.cwd(), outFile)}`);

  if (argv.includes('--self-check')) selfCheck(report);
}

function readBaseline() {
  const f = path.join(__dirname, 'actuary-output.json');
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, 'utf8')).regions;
}

const round = (v, n) => Math.round(v * 10 ** n) / 10 ** n;

// ── 自检：核心逻辑坏掉时这里会失败 ──────────────────────────────────────────
// 断言值来自 2026-10-07 由主理人独立复算的 5 城 72h 权威命中数。
// 任何一条失败都说明滑动窗口/阈值口径被改坏了，此时本脚本的其他输出一律不可信。
function selfCheck(report) {
  const EXPECT = {
    // 24h 的五城期望值不是"另外采一次数"，而是 **同一条链上两套实现必须相等** 的交叉校验：
    // `windows[h].hits`（滑动窗口扫描路径）必须等于下方 TIER_EXPECT 的 `counts[0] + counts[1]`
    // （tierStats 分档路径，2026-10-07 由一个不复用 tierStats 的独立实现复算过）。
    // 两路任何一处被改坏都会立刻红。
    wuhan: { 72: 4596, 24: 735 },      // = 622 + 113
    shanghai: { 72: 4391, 24: 727 },   // = 642 + 85
    beijing: { 72: 2198, 24: 422 },    // = 380 + 42
    guangzhou: { 72: 11153, 24: 1369 },// = 1247 + 122
    chengdu: { 72: 3588, 24: 573 },    // = 490 + 83
  };
  let pass = 0, fail = 0;
  console.log('\n── 自检（--self-check）──');
  for (const [key, wants] of Object.entries(EXPECT)) {
    for (const [h, want] of Object.entries(wants)) {
      // ⚠️ 这里必须是 === undefined，不能写 `if (!want)`：
      // 期望值 0（如 wuhan 24h、各城 tier2 计数）会被 falsy 判断吞掉 → 死断言。
      if (want === undefined) continue;
      const got = report.cities[key]?.windows?.[h]?.hits;
      const ok = got === want;
      console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${key} ${h}h hits = ${got}（期望 ${want}）`);
      ok ? pass++ : fail++;
    }
  }
  // 广州 72h 必须显著高于北京（判别度），这是产品叙事的核心
  const gz = report.cities.guangzhou.windows['72'].pPct;
  const bj = report.cities.beijing.windows['72'].pPct;
  const ratio = gz / bj;
  const okRatio = ratio > 4.5 && ratio < 5.5;
  console.log(`  ${okRatio ? 'PASS' : 'FAIL'}  广州/北京 72h 触发率比 = ${ratio.toFixed(2)}（期望 ≈5.0）`);
  okRatio ? pass++ : fail++;
  // 广州的区间下界必须低于 10%（"越线不显著"的证据）
  const ci = report.cities.guangzhou.windows['72'].ci95;
  const okCi = ci && ci.lo < 10 && ci.hi > 10;
  console.log(`  ${okCi ? 'PASS' : 'FAIL'}  广州 72h 95% 区间跨越 10%：[${ci.lo}, ${ci.hi}]`);
  okCi ? pass++ : fail++;

  // A7 分档（合约 v2）：档位计数与期望赔付必须逐格对得上
  // 期望值于 2026-10-07 由一个**独立实现**（不复用 tierStats，显式三档 if-else）逐城复算，
  // 下表 10 格（链上 v2 实际存在的时长）全部在 8 位小数内一致。任何一格不符 = 分档口径被改坏了。
  const TIER_EXPECT = {
    'wuhan|24': { counts: [622, 113, 0, 95674], exp: 0.00410491 },
    'wuhan|72': { counts: [154, 50, 0, 96157], exp: 0.00118824 },
    'shanghai|24': { counts: [642, 85, 0, 95682], exp: 0.00399081 },
    'shanghai|48': { counts: [425, 6, 0, 95954], exp: 0.00225139 },
    'beijing|24': { counts: [380, 42, 0, 95987], exp: 0.0022975 },
    'beijing|72': { counts: [105, 0, 0, 96256], exp: 0.00054483 },
    'guangzhou|24': { counts: [1247, 122, 0, 95040], exp: 0.00741632 },
    'guangzhou|72': { counts: [542, 0, 0, 95819], exp: 0.00281234 },
    'chengdu|24': { counts: [490, 83, 0, 95836], exp: 0.00318694 },
    'chengdu|72': { counts: [219, 0, 0, 96142], exp: 0.00113635 },
  };
  for (const [k, want] of Object.entries(TIER_EXPECT)) {
    const [key, h] = k.split('|');
    const got = report.cities[key]?.tiers?.[h];
    const okC = got && JSON.stringify(got.counts) === JSON.stringify(want.counts);
    const okE = got && Math.abs(got.expectedPayoutFraction - want.exp) < 5e-9;
    console.log(`  ${okC && okE ? 'PASS' : 'FAIL'}  A7 ${key} ${h}h 档位计数 ${JSON.stringify(got?.counts)}（期望 ${JSON.stringify(want.counts)}）期望赔付 ${got?.expectedPayoutFraction}`);
    okC && okE ? pass++ : fail++;
  }

  console.log(`\n自检结果：${pass} 项通过 / ${fail} 项失败`);
  if (fail > 0) process.exitCode = 1;
}

// ── 链上 gas 成本：全仓唯一来源 ───────────────────────────────────────────────
// 以前 `pricing_engine.js` / `tier_design_b2b.js` / `derive_metrics.js` 各抄了一份
// 0.00013 / 0.00012，改一处漏另两处就静默漂移 —— 统一放这里，别的文件从这取。
// 口径是「gas 用量 × gas 单价」：用量是真链实测、与网络无关；单价是**那条链那天的价**。
// ⚠️ 1.080 / 2.500 gwei 是 **Sepolia** 2026-10-06 的价，**不是 968 的价** —— 968 现网 20 gwei
// ⇒ 同样两笔约 0.0024369 / 0.00098594 BOT（`02-作战与答辩/决策记录.md:40` 链上实测
// 0.002458 BOT，差 0.9%，来自 gas 用量口径 122,900 vs 121,845）。换链必须重算，
// `node margin_check.js` 会同时打印 20 gwei 口径和每一格转负的 gwei。
const GAS_UNITS = { buyPolicy: 176579, judge: 121845, payout: 49297 };  // gas 用量（实测）
const GAS_GWEI  = { buyPolicy: 2.616,  judge: 1.080,  payout: 2.500 };  // 单价（Sepolia）
// 取整到 1e-5：与合约/正文里的 0.00013 / 0.00012 保持同一表示
const gasEthAt  = (units, gwei) => Math.round(units * gwei * 1e-9 * 1e5) / 1e5;
const JUDGE_GAS  = gasEthAt(GAS_UNITS.judge, GAS_GWEI.judge);    // 0.00013
const PAYOUT_GAS = gasEthAt(GAS_UNITS.payout, GAS_GWEI.payout);  // 0.00012
// 自证：正文里写的"121,845 gas @1.080 gwei ⇒ 0.00013"必须真的算得出来，否则这堆数在互相骗
for (const k of ['judge', 'payout']) {
  const raw = GAS_UNITS[k] * GAS_GWEI[k] * 1e-9;
  const cst = k === 'judge' ? JUDGE_GAS : PAYOUT_GAS;
  if (Math.abs(raw - cst) > 5e-6) throw new Error(`gas 口径自相矛盾：${k} 用量 × 单价 = ${raw}，常量却是 ${cst}`);
}

// ── 产物落盘：时间戳不该制造 git 噪声 ─────────────────────────────────────────
// 重跑脚本时产物里唯一会变的就是 generatedAt / "生成时间" 这类 ISO 时间戳（而那个字段
// 本来就判不出"数是不是旧的"，见文件头注释）。所以**除时间戳外内容一致就不重写**，
// 让重跑后 `git status` 保持干净。返回 true = 真的写了，false = 只有时间戳在动、已跳过。
const ISO_TS_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
function emit(file, text) {
  const bare = (s) => s.replace(ISO_TS_RE, '@TS@');
  try { if (bare(fs.readFileSync(file, 'utf8')) === bare(text)) return false; } catch (_) { /* 不存在，写 */ }
  fs.writeFileSync(file, text);
  return true;
}

// 供 `derive_metrics.js` 复用同一套口径（改这里必须同时想清楚那边）
module.exports = {
  DATA_START, DATA_END, DURATIONS, THRESHOLD, TIERS,
  toDecimillimetres, loadCity, countHits, windowSums, sourceMtime,
  monthIndex, bootstrapCI, boundaryWindows, thresholdBasis10, tierStats,
  GAS_UNITS, GAS_GWEI, JUDGE_GAS, PAYOUT_GAS, gasEthAt, emit,
};

if (require.main === module) main();
