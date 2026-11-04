#!/usr/bin/env node
/**
 * gen-intensity-stats.js —— 雨强维度统计（评语②「多参数情景建模」的可算部分）
 *
 * 只用项目内 11 年逐小时缓存，零新增采集、零假设编造：
 *   ① 触发窗口的强度画像：现行档线触发时，窗口内「峰值小时雨强」的中位数/90 分位
 *   ② 雨型分解：长历时低强度（峰值 <5mm/h）vs 对流短时强降水（峰值 ≥20mm/h）各占多少
 *   ③ 独立强度触发：若以「窗口内最大小时雨强 ≥ X」为触发线，触发概率是多少
 *
 * 输出：02-作战与答辩/雨强维度-2026-11-05.md
 * 用法：node 07-测试工具/gen-intensity-stats.js
 */
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");

const CITIES = [["wuhan", "武汉"], ["shanghai", "上海"], ["beijing", "北京"], ["guangzhou", "广州"], ["chengdu", "成都"]];
const TIERS = { 12: [30, 70], 24: [50, 100] };  // 现行档线（mm）
const INTENSITY_LINES = [10, 20, 30];           // mm/h

const pct = (arr, q) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

function analyze(city, hours) {
  const file = path.join(ROOT, "10-金融与定价/cache", `${city}-2015-10-01_2026-09-30.json`);
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const mm = raw.hourly.precipitation.map(v => Math.round((v || 0) * 10)); // 十分位整数
  const N = mm.length;
  const pre = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) pre[i + 1] = pre[i] + mm[i];
  const [t1, t2] = TIERS[hours];

  let windows = 0, hit1 = 0, hit2 = 0;
  const peaksHit = [];
  const intensityHit = Object.fromEntries(INTENSITY_LINES.map(x => [x, 0]));

  for (let i = 0; i + hours <= N; i++) {
    windows++;
    const sum = (pre[i + hours] - pre[i]) / 10;
    let peak = 0;
    for (let k = i; k < i + hours; k++) peak = Math.max(peak, mm[k] / 10);
    for (const line of INTENSITY_LINES) if (peak >= line) intensityHit[line]++;
    if (sum >= t1) { hit1++; peaksHit.push(peak); }
    if (sum >= t2) hit2++;
  }
  const p50 = pct(peaksHit, 0.5), p90 = pct(peaksHit, 0.9);
  const steady = peaksHit.filter(p => p < 5).length;
  const burst = peaksHit.filter(p => p >= 20).length;
  return {
    hours, windows, hit1, hit2,
    p1: hit1 / windows, p2: hit2 / windows,
    peakP50: p50, peakP90: p90,
    steadyShare: hit1 ? steady / hit1 : 0,
    burstShare: hit1 ? burst / hit1 : 0,
    intensity: Object.fromEntries(INTENSITY_LINES.map(x => [x, intensityHit[x] / windows])),
  };
}

const rows = [];
for (const [key, name] of CITIES) for (const h of [12, 24]) rows.push({ name, ...analyze(key, h) });

const pctf = v => (v * 100).toFixed(2) + "%";
const L = [];
L.push("# 雨强维度（2026-11-05 生成 · 11 年逐小时缓存实算）\n");
L.push("> 生成命令：`node 07-测试工具/gen-intensity-stats.js`。全部数字来自 `10-金融与定价/cache/` 的 11 年逐小时 ERA5 缓存（每城 96,432 小时），整数十分位累加，与精算引擎同口径。\n");
L.push("## 一、现行档线触发时的雨强画像\n");
L.push("| 城市 | 时长 | 触发窗口数 | 触发率 | 峰值小时雨强 中位 | 峰值 90 分位 | 长历时低强度占比* | 对流短时占比** |");
L.push("|---|---:|---:|---:|---:|---:|---:|---:|");
for (const r of rows) {
  L.push(`| ${r.name} | ${r.hours}h | ${r.hit1} | ${pctf(r.p1)} | ${r.peakP50.toFixed(1)} mm/h | ${r.peakP90.toFixed(1)} mm/h | ${pctf(r.steadyShare)} | ${pctf(r.burstShare)} |`);
}
L.push("");
L.push("\\* 峰值小时雨强 < 5 mm/h（绵雨型，累计达标但单小时不猛）；\\*\\* 峰值 ≥ 20 mm/h（对流型，短时猛下）。\n");
L.push("## 二、若以「窗口内最大小时雨强」为独立触发线\n");
L.push("| 城市 | 时长 | ≥10 mm/h | ≥20 mm/h | ≥30 mm/h |");
L.push("|---|---:|---:|---:|---:|");
for (const r of rows) {
  L.push(`| ${r.name} | ${r.hours}h | ${pctf(r.intensity[10])} | ${pctf(r.intensity[20])} | ${pctf(r.intensity[30])} |`);
}
L.push("");
L.push("## 三、这张表回答什么、不回答什么\n");
L.push("- **回答**：同样的「累计雨量达标」，雨型可以完全不同——绵雨与对流短时降水对骑手的影响、对城市排水的压力都不一样。我们已有能力把这一维算出来，并在研究层作为情景分解（不改链上触发口径）。");
L.push("- **不回答**：路网积水与订单潮汐。这两项需要市政内涝点清单与平台订单数据，**我们没有，就不编**——已写进二期路线图（数据接口预留）。");
L.push("- **口径边界**：本表是研究层情景分解，链上判定仍只看累计增量与国标档线；若未来要把雨强写进条款，需要重新走一遍定价与条款报备。\n");

const out = path.join(ROOT, "02-作战与答辩/雨强维度-2026-11-05.md");
fs.writeFileSync(out, L.join("\n"), "utf8");
console.log("written:", out);
console.log(rows.map(r => `${r.name}${r.hours}h 触发${r.hit1}次 峰值中位${r.peakP50.toFixed(1)} 对流占${pctf(r.burstShare)}`).join("\n"));
