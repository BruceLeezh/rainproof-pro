/**
 * 精算口径：用 Open-Meteo 真实历史逐小时降雨，算「保单窗口内累计降雨 ≥ 50mm」的历史频率。
 * ============================================================================
 *
 * 【为什么这么算：把链上判定翻译成一句概率】
 *   合约里的赔付条件是
 *       during = rainfall[regionId] - rainfallAtBuy  >=  THRESHOLD(50)
 *   其中 rainfall 是喂价脚本推的【单调不减累计值】。因为增量非负，
 *       max over t∈[start,end] ( rainfall(t) - rainfall(start) )
 *    就等于窗口期末的累计增量，也就等于「窗口内的总降雨量」。
 *   所以链上判定等价于：
 *       保单窗口内总降雨 >= 50mm  →  赔
 *   —— 这正是下面统计的事件。这是个恒等式，不是近似，答辩时可以直接讲。
 *
 * 【为什么要区分「窗口频率」和「保单触发概率」】
 *   滑动窗口彼此高度重叠（相邻窗口共享 71/72 的样本），所以统计出来的 p 是
 *   「随机取一个时点开保，窗口内雨量达标的概率」——它对同一条降雨序列是精确的，
 *   但窗口之间不独立。对定价它是正确的输入（定价问的正是「随机时点开保」），
 *   对「独立性/方差」类推论则要另算。这一点必须写在口径里，别被评委问出来。
 *
 * 【数据源】
 *   Open-Meteo Archive API（ERA5 再分析），免 key、国内可直连。
 *   区间取 2015-10-01 ~ 2026-09-30（archive 有约 5 天滞后，取到今天会缺尾部）。
 *
 * 用法：
 *   node actuary.js              # 有缓存用缓存，没有就联网拉
 *   node actuary.js --refresh    # 强制重新拉取
 */

const fs = require("fs");
const path = require("path");
const { REGIONS } = require("../04-脚本/regions.js");

// —— 契约参数：与 03-合约/RainDeliveryInsurance.sol 保持一致（改合约必须同步改这里）——
const PREMIUM_ETH = 0.001;
const PAYOUT_ETH = 0.01;
const THRESHOLD_MM = 50;
const MAX_HOURS = 72;

// —— 统计口径 ——
const START = "2015-10-01";
const END = "2026-09-30";
const WINDOWS = [6, 12, 24, 48, 72, 168]; // 小时；72=合约上限，168=7天（旧文档口径，保留对照）

const CACHE_DIR = path.join(__dirname, "cache");
const REFRESH = process.argv.includes("--refresh");

function apiUrl(r) {
  const q = new URLSearchParams({
    latitude: String(r.lat),
    longitude: String(r.lon),
    start_date: START,
    end_date: END,
    hourly: "precipitation",
    timezone: "Asia/Shanghai",
  });
  return `https://archive-api.open-meteo.com/v1/archive?${q}`;
}

async function loadRegion(r) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cache = path.join(CACHE_DIR, `${r.key}-${START}_${END}.json`);
  if (!REFRESH && fs.existsSync(cache)) {
    return { data: JSON.parse(fs.readFileSync(cache, "utf8")), cached: true };
  }
  const url = apiUrl(r);
  // 现场网络会掐连接（实测 UND_ERR_SOCKET），退避重试；3 次都失败才放弃，
  // 且失败信息里带上是哪个城市 —— 别让一个城市挂了整轮计算白跑。
  let j = null;
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "rainproof-actuary/1.0" } });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      j = await res.json();
      break;
    } catch (e) {
      lastErr = e;
      console.error(`  [重试 ${attempt}/3] ${r.key}: ${e.message}`);
      if (attempt < 3) await new Promise((s) => setTimeout(s, attempt * 2000));
    }
  }
  if (!j) throw new Error(`${r.key}: 拉取失败（已重试 3 次）—— ${lastErr && lastErr.message}`);
  if (!j.hourly || !Array.isArray(j.hourly.precipitation)) {
    throw new Error(`${r.key}: 返回里没有 hourly.precipitation`);
  }
  fs.writeFileSync(cache, JSON.stringify(j), "utf8");
  return { data: j, cached: false };
}

/** 滑动窗口：对每个起点 t，求 [t, t+D) 的累计降雨 */
function windowStats(values, D) {
  const n = values.length;
  const m = n - D + 1;
  let hits = 0;
  let max = 0;
  let sum = 0;
  for (let i = 0; i < D; i++) sum += values[i];
  for (let t = 0; t < m; t++) {
    if (t > 0) sum += values[t + D - 1] - values[t - 1];
    if (sum >= THRESHOLD_MM) hits++;
    if (sum > max) max = sum;
  }
  return { windows: m, hits, p: hits / m, max };
}

/** 逐年频率：看 p 稳不稳（评审会问「你这个数是不是某一年的偶然」） */
function perYear(values, times, D) {
  const byYear = new Map();
  for (let i = 0; i + D <= values.length; i++) {
    const y = Number(times[i].slice(0, 4));
    const e = byYear.get(y) || { n: 0, hits: 0 };
    let s = 0;
    for (let k = 0; k < D; k++) s += values[i + k];
    e.n++;
    if (s >= THRESHOLD_MM) e.hits++;
    byYear.set(y, e);
  }
  return [...byYear.entries()]
    .filter(([y]) => y > 2015)
    .map(([y, e]) => ({ year: y, p: e.hits / e.n, hits: e.hits, n: e.n }));
}

(async () => {
  console.log("=".repeat(78));
  console.log("雨证 · RainProof 精算口径 —— 历史触发频率");
  console.log("=".repeat(78));
  console.log(`数据源   : Open-Meteo Archive (ERA5)，逐小时 precipitation，timezone=Asia/Shanghai`);
  console.log(`区间     : ${START} ~ ${END}`);
  console.log(`触发定义 : 窗口内累计降雨 >= ${THRESHOLD_MM} mm`);
  console.log(`契约参数 : PREMIUM=${PREMIUM_ETH} ETH  PAYOUT=${PAYOUT_ETH} ETH  保本阈值 p < ${(PREMIUM_ETH / PAYOUT_ETH * 100).toFixed(0)}%`);
  console.log("");

  const out = { meta: { source: "Open-Meteo Archive (ERA5)", start: START, end: END, threshold: THRESHOLD_MM, premiumEth: PREMIUM_ETH, payoutEth: PAYOUT_ETH, maxHours: MAX_HOURS }, regions: {} };

  for (const r of REGIONS) {
    const { data } = await loadRegion(r);
    const values = data.hourly.precipitation.map((v) => (v == null ? 0 : v));
    const times = data.hourly.time;
    const hours = values.length;

    console.log(`${r.name}（id=${r.id}, ${r.lat},${r.lon}）  样本 ${hours} 小时 ≈ ${(hours / 8766).toFixed(1)} 年`);
    console.log("  窗口      窗口数      超阈值数      频率 p      窗口内最大累计");
    const rec = { hours, years: +(hours / 8766).toFixed(2), windows: {} };
    for (const D of WINDOWS) {
      const s = windowStats(values, D);
      rec.windows[D] = { windows: s.windows, hits: s.hits, p: +s.p.toFixed(6), maxMm: +s.max.toFixed(1) };
      const tag = D === MAX_HOURS ? "  ← 合约上限" : D === 168 ? "  ← 旧文档口径" : "";
      console.log(
        `  ${String(D).padStart(3)}h  ${String(s.windows).padStart(9)}  ${String(s.hits).padStart(12)}  ${(s.p * 100).toFixed(3).padStart(9)}%  ${s.max.toFixed(1).padStart(12)} mm${tag}`
      );
    }
    // 逐年稳定性只看合约上限那一档
    rec.perYear72h = perYear(values, times, MAX_HOURS).map((x) => ({ year: x.year, p: +x.p.toFixed(4), hits: x.hits }));
    const ps = rec.perYear72h.map((x) => x.p);
    rec.perYear72hRange = [+Math.min(...ps).toFixed(4), +Math.max(...ps).toFixed(4)];
    console.log(`  逐年 72h 频率区间: ${(rec.perYear72hRange[0] * 100).toFixed(3)}% ~ ${(rec.perYear72hRange[1] * 100).toFixed(3)}%`);
    console.log("");
    out.regions[r.key] = rec;
  }

  const written = path.join(__dirname, "actuary-output.json");
  fs.writeFileSync(written, JSON.stringify(out, null, 2), "utf8");
  console.log("=".repeat(78));
  console.log(`明细已写入 ${path.relative(process.cwd(), written)}`);
})();
