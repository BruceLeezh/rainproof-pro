#!/usr/bin/env node
'use strict';
/**
 * snapshot-real-rainfall.js —— 生成「真值快照」并就地内嵌进 05-演示站点/index.html。
 * ============================================================================
 * 为什么这么做：演示页是**静态单文件**（GitHub Pages、双击即开），真值面板不能靠运行时联网取数
 * （现场可能有代理/网络问题），也不能把三个模型的累计与一致性判断在页面里再写一遍
 * （那就是把 04-脚本/feed-verify.js 的闸门复制成两份，迟早不一致）。
 * 所以：这里用**同一份** feed-verify 算出快照 → 内嵌进页面 → 页面只负责画。
 *
 * 跑法（在 07-测试工具 目录下；Open-Meteo 直连即可，不需要 FlClash）：
 *   node snapshot-real-rainfall.js [epoch=2026-09-01] [until=今天(+0800)]
 *
 * 注意：真值能不能写进链还要看合约那边 —— 968 的 v2 存的是模拟暴雨、累计值只增不减，
 * 真值比它小就 revert；677 的 v3 是全新合约（rainfall[] 从 0 起），真值可以直接写。
 */
const fs = require('fs');
const path = require('path');

const SCRIPTS = path.join(__dirname, '..', '04-脚本');
const { fetchModelSeries, gradeModels } = require(path.join(SCRIPTS, 'feed-verify'));
const { REGIONS } = require(path.join(SCRIPTS, 'regions'));

const HTML = path.join(__dirname, '..', '05-演示站点', 'index.html');
const PLACEHOLDER = /^const REAL_RAIN = .*;.*$/m;
const NAME_EN = {
  wuhan: 'Wuhan', shanghai: 'Shanghai', beijing: 'Beijing',
  guangzhou: 'Guangzhou', chengdu: 'Chengdu',
};

// 交付值（与 04-脚本/push-rainfall.js:155-217 同口径）：Open-Meteo **archive** 自 epoch 到 until 的累计 —— 
// 这才是真正会被写进链上的那个数。feed-verify 的三模型核验只在【最近 14 天】上做旁证，所以两个数天然不同值，
// 面板必须把两个都标清楚，否则会和链上读数对不上。（push-rainfall.js 没有 require.main 守卫，没法直接 require 复用它。）
async function fetchArchiveSum(region, epoch, until) {
  const url = 'https://archive-api.open-meteo.com/v1/archive' +
    `?latitude=${region.lat}&longitude=${region.lon}` +
    `&daily=precipitation_sum&timezone=Asia%2FShanghai&start_date=${epoch}&end_date=${until}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'rain-insurance-oracle/1.0' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  const times = (j && j.daily && j.daily.time) || [];
  const vals = (j && j.daily && j.daily.precipitation_sum) || [];
  let sum = 0, days = 0;
  for (let i = 0; i < times.length; i++) {
    if (times[i] >= epoch && typeof vals[i] === 'number') { sum += vals[i]; days++; }
  }
  return { mm: Math.max(0, Math.round(sum)), days };
}

const nowCst = () => new Date(Date.now() + 8 * 3600e3);
const today = () => nowCst().toISOString().slice(0, 10);
const stamp = () => nowCst().toISOString().slice(0, 19).replace('T', ' ') + ' +0800';

(async () => {
  const epoch = process.argv[2] || '2026-09-01';
  const until = process.argv[3] || today();
  console.log(`真值快照：epoch ${epoch} → ${until}（Open-Meteo Archive 三模型 + feed-verify 闸门）`);

  const regions = [];
  let failed = 0;
  for (const r of REGIONS) {
    try {
      const series = await fetchModelSeries(r, until, epoch);
      const g = gradeModels(series);
      let delivered = null;
      try { delivered = await fetchArchiveSum(r, epoch, until); } catch (_) { /* 面板显示 — */ }
      regions.push({
        id: r.id, key: r.key, name: r.name, nameEn: NAME_EN[r.key],
        mm: delivered ? delivered.mm : null,          // ← 会写进链的那个数（archive 自 epoch 起）
        gateMm: g.mm,                                  // ← 闸门三模型核验值（只覆盖最近 14 天）
        gateDays: 14,
        status: g.status, confidence: g.confidence, sources: g.sources,
        medianMm: g.medianMm, toleranceMm: g.toleranceMm, spreadMm: g.spreadMm,
        perModel: (g.perModel || []).map((p) => ({ label: p.label, mm: p.mm })),
      });
      const mark = g.status === 'diverge' ? '⛔ 闸门会拒收' : '✅ 可写链';
      console.log(`  #${r.id} ${r.name}  写链值 ${delivered ? delivered.mm + ' mm' : '—'}（archive 自 ${epoch}） · 闸门核验 ${g.status} ${g.mm} mm（最近 14 天） 置信 ${g.confidence} 源 ${g.sources}  ${mark}`);
    } catch (e) {
      failed++;
      regions.push({
        id: r.id, key: r.key, name: r.name, nameEn: NAME_EN[r.key],
        mm: null, status: 'error', confidence: 0, sources: 0,
        error: String((e && e.message) || e),
      });
      console.log(`  #${r.id} ${r.name}  💥 ${(e && e.message) || e}`);
    }
  }

  const snapshot = {
    schema: 'rainproof/real-rainfall@1',
    generatedAt: stamp(),
    epoch,
    until,
    source: 'Open-Meteo Archive API · ECMWF / GFS / ICON',
    note: 'mm = Open-Meteo archive 自 epoch 起的真实累计（与写进链上的那个数同口径）；gateMm 是 feed-verify 闸门在最近 14 天三模型上的核验值，status/confidence/sources 是那份核验的判定 —— 只有不是 diverge 的才写得进链。',
    regions,
  };

  const html = fs.readFileSync(HTML, 'utf8');
  const hits = html.match(new RegExp(PLACEHOLDER.source, 'gm'));
  if (!hits || hits.length !== 1) {
    throw new Error('index.html 里的 REAL_RAIN 占位行匹配到 ' + (hits ? hits.length : 0) + ' 处，应为 1');
  }
  const line = 'const REAL_RAIN = ' + JSON.stringify(snapshot) + ';';
  fs.writeFileSync(HTML, html.replace(PLACEHOLDER, () => line));
  console.log(`已内嵌进 ${HTML}（${hits[0].length} → ${line.length} 字符）`);
  if (failed) console.log(`⚠️ 有 ${failed} 个区域取数失败（面板里会显示 —）`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('💥 ' + (e.stack || e.message)); process.exit(1); });
