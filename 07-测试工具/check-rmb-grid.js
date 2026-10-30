#!/usr/bin/env node
/**
 * check-rmb-grid.js —— 网格一致性门禁（E2，2026-10-25）
 *
 * 锁一件事：`04-脚本/setgrid-v4.js` 里手写的 10 格人民币网格，与
 * `01-参赛材料/02-定价-人民币口径/定价体系-人民币-数表.md`（rmb-pricing.js 生成）
 * 的「众包·自助」列**逐格相等**。两边任何一边被手改，这道门禁就红——
 * 「链上价 = 计划书价 = 定价引擎价」这条链不许断。
 *
 * 用法：node check-rmb-grid.js   （纯离线，进 npm test 链）
 */
"use strict";
const fs = require("fs");
const path = require("path");

const pass = [], fail = [];
const ok = (n, c, t = "") => { (c ? pass : fail).push(n); console.log(`  ${c ? "✅" : "❌"} ${n}${t ? "  " + t : ""}`); };

const CITY = { 1: "武汉", 2: "上海", 3: "北京", 4: "广州", 5: "成都" };

// ① setgrid-v4.js 的 GRID（正则抓字面量，不执行脚本）
const gridSrc = fs.readFileSync(path.join(__dirname, "..", "04-脚本", "setgrid-v4.js"), "utf8");
const grid = {};
for (let c = 1; c <= 5; c++) {
  const m = gridSrc.match(new RegExp(`${c}:\\s*\\{\\s*12:\\s*(\\d+),\\s*24:\\s*(\\d+)\\s*\\}`));
  if (!m) { fail.push(`GRID 缺城市 ${CITY[c]}`); continue; }
  grid[c] = { 12: Number(m[1]), 24: Number(m[2]) };
}

// ② 数表 md 的「众包·自助」列（两张表各一列，12h 与 24h）
const md = fs.readFileSync(
  path.join(__dirname, "..", "10-金融与定价", "rmb-pricing-base.md"), "utf8");
function parseCol(header) {
  const idx = md.indexOf(header);
  const next = md.indexOf("\n## ", idx + 1);
  const sec = md.slice(idx, next === -1 ? undefined : next);   // 只取本小节，别把下一档的行吞进来
  const rows = [...sec.matchAll(/^\| (武汉|上海|北京|广州|成都) \| ([\d.]+) \| ([\d.]+) \| ([\d.]+) \| ([\d.]+) \|/gm)];
  return rows;
}
const rows12 = parseCol("## 12 小时档");
const rows24 = parseCol("## 24 小时档");
ok("数表 12h/24h 两段各解析出 5 行", rows12.length === 5 && rows24.length === 5,
  `12h=${rows12.length} 行 · 24h=${rows24.length} 行`);
if (rows12.length !== 5 || rows24.length !== 5) { finish(); }

const nameToId = {}; for (const [k, v] of Object.entries(CITY)) nameToId[v] = Number(k);
// 众包·自助 = 每行第 5 个数值列（平台团体/认证代付/认证自助/众包自助）
let cell = 0, mismatch = [];
for (const rows of [rows12, rows24]) {
  const h = rows === rows12 ? 12 : 24;
  for (const r of rows) {
    const c = nameToId[r[1]];
    const mdVal = Math.round(Number(r[5]) * 100);           // 元 → 分
    cell++;
    if (grid[c] && grid[c][h] === mdVal) continue;
    mismatch.push(`${CITY[c]} ${h}h：GRID=${grid[c] ? grid[c][h] : "缺"} 分 ≠ 数表=${mdVal} 分`);
  }
}
ok(`10 格逐格一致（GRID ↔ 数表众包自助列）`, mismatch.length === 0, mismatch.length ? mismatch.join("；") : `${cell} 格核对`);
ok("基准表是 100 元额度基数", /PAYOUT 满额 100 元/.test(md));
const engine = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "10-金融与定价", "pricing-engine.json"), "utf8"));
const cells = Object.values(engine.cells).filter(c => c.segKey === "t0c0");
const drift = cells.filter(c => {
  const expected = Math.max(Math.ceil((((c.upperRatePct / 100) * 10000 + 30) / 0.6 - 1e-6) / 10) * 10, 100);
  return grid[nameToId[c.regionName]]?.[c.hours] !== expected;
});
ok("10 格与当前引擎的风险上界及定价公式一致", cells.length === 10 && drift.length === 0, drift.map(c => `${c.regionName} ${c.hours}h`).join("；"));
ok("GRID 值域合理（100–1000 分 = 1–10 元，且 < 满额 10000）",
  Object.values(grid).every(g => g[12] >= 100 && g[24] >= 100 && g[12] < 10000 && g[24] < 10000));

function finish() {
  console.log("=".repeat(60));
  console.log(`通过 ${pass.length} 项 / 失败 ${fail.length} 项`);
  if (fail.length) process.exit(1);
}
finish();
