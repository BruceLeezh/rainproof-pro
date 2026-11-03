"use strict";
// 「雨中投保」残余风险量化（T+1 之后还剩多少）。
//
// 问题：骑手在 t 时刻看着窗外下雨就投保。判定只计 [t, t+时长] 的增量，
// 所以当天下过的雨不赔——但**进行中降雨事件的尾巴**会落进保单窗口。
// T+1（生效锚定）把窗口推到 [t+24h, t+24h+时长]，切掉了尾巴的头部。
// 本脚本用 11 年逐小时缓存实算：
//   U = 无条件触发概率          P(窗口增量 ≥ 档线)，t 在全体小时均匀取
//   C = 「雨中/雨后买」条件概率  同一窗口，但条件为前 24h 已有 ≥10mm（A10）或 ≥30mm（A30）降雨
//   倍数 C/U = 挑雨买相对随手买的期望赔付放大倍数（T+1 之后的残余攻击面）
// 同口径对照「无 T+1」：窗口 [t, t+时长] 的条件概率（旧锚点的攻击面）。
// 全程整数十分位（0.1mm → 1），与 audit_numbers 同纪律。
//
// 用法：node 10-金融与定价/pricing-next/conditional-risk.js
const path = require("path");
const fs = require("fs");

const CACHE = path.join(__dirname, "..", "cache");
const CITIES = [
  { key: "wuhan", name: "武汉" },
  { key: "shanghai", name: "上海" },
  { key: "beijing", name: "北京" },
  { key: "guangzhou", name: "广州" },
  { key: "chengdu", name: "成都" },
];
const PRODUCTS = [
  { name: "12h", dur: 12, threshold: 30 },
  { name: "24h", dur: 24, threshold: 50 },
];
const ANTE = [10, 30]; // 前置 24h 降雨条件（mm）：≥10 = 有雨；≥30 = 明显降雨事件

const to10 = (v) => Math.round((v ?? 0) * 10);

function hit(pm, from, dur, threshold10) {
  // [from, from+dur) 小时增量（十分位）≥ threshold*10
  let s = 0;
  for (let k = 0; k < dur; k++) s += pm[from + k] ?? 0;
  return s >= threshold10;
}

async function main() {
  const out = { schema: "rainproof/conditional-risk@1", generatedAt: new Date().toISOString(), note: "T+1 残余风险量化。窗口 [t+24h, t+24h+dur)。条件 = 前 24h 降雨 ≥ 阈值。全部来自 cache/ ERA5 逐小时（2015-10 → 2026-09），整数十分位。", cities: [] };
  for (const c of CITIES) {
    const file = path.join(CACHE, `${c.key}-2015-10-01_2026-09-30.json`);
    if (!fs.existsSync(file)) { console.log(`跳过 ${c.name}（无缓存）`); continue; }
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const times = raw.hourly.time;
    const mm10 = raw.hourly.precipitation.map(to10);
    const n = mm10.length;
    // 前缀和：P[i] = 前 i 小时之和（十分位）
    const P = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) P[i + 1] = P[i] + mm10[i];
    const range = (a, b) => P[b] - P[a]; // [a, b) 十分位

    const city = { code: c.key, name: c.name, hours: n, products: [] };
    for (const prod of PRODUCTS) {
      const t10 = prod.threshold * 10;
      // 有效小时范围：需要 t-24h 与 t+24h+dur 都在样本内
      const startHour = 24, endHour = n - 24 - prod.dur;
      const stat = {
        unconditional: { trials: 0, hits: 0 },
        ante10: { trials: 0, hits: 0 },
        ante30: { trials: 0, hits: 0 },
        legacyNoT1_ante10: { trials: 0, hits: 0 }, // 无 T+1：窗口 [t, t+dur)，雨中买
      };
      for (let t = startHour; t < endHour; t++) {
        const w = range(t + 24, t + 24 + prod.dur);          // T+1 窗口
        const wOld = range(t, t + prod.dur);                  // 旧窗口（即时生效）
        const a10 = range(t - 24, t) >= ANTE[0] * 10;
        const a30 = range(t - 24, t) >= ANTE[1] * 10;
        const hitW = w >= t10, hitOld = wOld >= t10;
        stat.unconditional.trials++; stat.unconditional.hits += hitW ? 1 : 0;
        if (a10) { stat.ante10.trials++; stat.ante10.hits += hitW ? 1 : 0; }
        if (a30) { stat.ante30.trials++; stat.ante30.hits += hitW ? 1 : 0; }
        if (a10) { stat.legacyNoT1_ante10.trials++; stat.legacyNoT1_ante10.hits += hitOld ? 1 : 0; }
      }
      const pct = (s) => s.trials ? Number((s.hits / s.trials * 100).toFixed(3)) : null;
      const ratio = (a, b) => (a && b) ? Number((a.hits / a.trials / (b.hits / b.trials)).toFixed(2)) : null;
      const row = {
        product: prod.name, thresholdMm: prod.threshold,
        unconditionalPct: pct(stat.unconditional),
        rainBuyPct: pct(stat.ante10), rainBuyMultiplierVsUncond: ratio(stat.ante10, stat.unconditional),
        heavyRainBuyPct: pct(stat.ante30), heavyRainBuyMultiplierVsUncond: ratio(stat.ante30, stat.unconditional),
        legacyNoT1_rainBuyPct: pct(stat.legacyNoT1_ante10),
        legacyNoT1_multiplierVsUncond: ratio(stat.legacyNoT1_ante10, stat.unconditional),
        t1RemovalPct: null,
      };
      if (row.legacyNoT1_rainBuyPct && row.rainBuyPct != null) {
        row.t1RemovalPct = Number(((1 - row.rainBuyPct / row.legacyNoT1_rainBuyPct) * 100).toFixed(1));
      }
      city.products.push(row);
      console.log(`${c.name} ${prod.name}h：无条件 ${row.unconditionalPct}% | 雨中买(T+1后) ${row.rainBuyPct}%（×${row.rainBuyMultiplierVsUncond}）| 雨中买(无T1旧锚) ${row.legacyNoT1_rainBuyPct}%（×${row.legacyNoT1_multiplierVsUncond}）| T+1 削减 ${row.t1RemovalPct}%`);
    }
    out.cities.push(city);
  }
  const outPath = path.join(__dirname, "conditional-risk.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log("saved:", outPath);
}

main().catch(e => { console.error("💥", (e && e.message) || e); process.exit(1); });
