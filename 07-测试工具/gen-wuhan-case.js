#!/usr/bin/env node
/**
 * gen-wuhan-case.js —— 生成「武汉落地」答辩素材切片
 *
 * 数据全部来自项目内已有成果，零新增采集：
 *   ① 研究价（月×时点）：pricing-next/model.json 的 cells + core.quote()（与 summarize 同一函数、同一假设集）
 *   ② 链上现行价：V6-T1 premiumOf(regionId, hours) 实读
 *   ③ 自校验：武汉(420100) 1月/7月 × 12h/24h 重算值必须与 summary.examples 逐格一致，否则报错退出
 *
 * 输出：02-作战与答辩/武汉落地素材-2026-11-04.md
 * 用法：node 07-测试工具/gen-wuhan-case.js
 */
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");
require(path.join(ROOT, "04-脚本/node_modules/dotenv")).config({ path: path.join(ROOT, "04-脚本/.env") });
const { ethers } = require(path.join(ROOT, "04-脚本/node_modules/ethers"));
const { withRetry, provider } = require(path.join(ROOT, "04-脚本/rpc-read"));

const CORE = require(path.join(ROOT, "10-金融与定价/pricing-next/core.js"));
const model = require(path.join(ROOT, "10-金融与定价/pricing-next/model.json"));
const summary = require(path.join(ROOT, "10-金融与定价/pricing-next/summary.json"));
const A = model.config.assumptions;
const HOURS = [12, 24];
const MONTHS = [1, 7];
const START = 12;

const wuhan = model.regions.filter(r => String(r.code).startsWith("4201"));
const money = fen => (fen / 100).toFixed(2);

function premiumFor(region, month, h) {
  const cell = (region.cells[String(h)] || []).find(c => c.month === month && c.startHour === START);
  if (!cell) throw new Error(`${region.code} ${month}月 ${h}h 无单元`);
  return CORE.quote(A, h, cell);
}

// ③ 自校验：与 summary.examples 对齐
const city = wuhan.find(r => r.code === 420100);
let checked = 0;
for (const ex of summary.examples.filter(e => e.code === 420100 && e.startHour === START)) {
  const q = premiumFor(city, ex.month, ex.h);
  if (q.premiumFen !== Math.round(ex.premiumYuan * 100)) {
    throw new Error(`自校验失败：${ex.month}月 ${ex.h}h 重算 ${money(q.premiumFen)} vs examples ${ex.premiumYuan}`);
  }
  checked++;
}
console.log(`自校验通过：${checked} 格与 summary.examples 逐格一致`);

// ① 研究价表
const rows = wuhan.map(r => {
  const out = { code: r.code, name: r.name };
  for (const h of HOURS) for (const m of MONTHS) {
    const q = premiumFor(r, m, h);
    out[`${h}_${m}`] = q.premiumFen;
    out[`${h}_${m}_q`] = q.q;
    out[`${h}_${m}_upper`] = q.upper;
  }
  return out;
});

// ② 链上现行价
(async () => {
  const p = provider(ethers, process.env.SEPOLIA_RPC || "https://rpc.bohr.life");
  const v6 = new ethers.Contract(process.env.CONTRACT_ADDRESS_V6, require(path.join(ROOT, "03-合约/RainDeliveryInsuranceV6.abi.json")), p);
  for (const r of rows) {
    r.chain12 = Number(await withRetry(() => v6.premiumOf(r.code, 12)));
    r.chain24 = Number(await withRetry(() => v6.premiumOf(r.code, 24)));
  }
  await p.destroy();

  const max24 = rows.reduce((a, b) => (b.chain24 > a.chain24 ? b : a));
  const min24 = rows.reduce((a, b) => (b.chain24 < a.chain24 ? b : a));
  const julJan = rows.map(r => ({ name: r.name, ratio: r["24_7"] / r["24_1"] })).sort((a, b) => b.ratio - a.ratio);

  const L = [];
  L.push("# 武汉落地素材（2026-11-04 生成 · 全部数字可复核）\n");
  L.push("> 生成命令：`node 07-测试工具/gen-wuhan-case.js`；研究价复用 `pricing-next/core.quote()`（与 summarize 同函数同假设集），并已与 `summary.examples` 逐格自校验；链上价实读 `premiumOf()`。\n");
  L.push("## 一、链上现行价（V6-T1，244 格中的武汉 14 区划）\n");
  L.push("| 区划码 | 区划 | 12h 现价 | 24h 现价 |");
  L.push("|---|---|---:|---:|");
  for (const r of rows) L.push(`| ${r.code} | ${r.name} | ${money(r.chain12)} 元 | ${money(r.chain24)} 元 |`);
  L.push("");
  L.push(`**因地制宜的现成证据**：24h 最高 ${max24.name} ${money(max24.chain24)} 元，最低 ${min24.name} ${money(min24.chain24)} 元，相差 ${(max24.chain24 / min24.chain24).toFixed(2)} 倍——同一座城市内部，气候与地形差异就足以让价格拉开。\n`);
  L.push("## 二、研究价（月 × 起保时点，12:00 起保；训练定价，未上链）\n");
  L.push("| 区划 | 1月 12h | 1月 24h | 7月 12h | 7月 24h | 7月/1月（24h） |");
  L.push("|---|---:|---:|---:|---:|---:|");
  for (const r of rows) {
    L.push(`| ${r.name} | ${money(r["12_1"])} | ${money(r["24_1"])} | ${money(r["12_7"])} | ${money(r["24_7"])} | ${(r["24_7"] / r["24_1"]).toFixed(2)}× |`);
  }
  L.push("");
  L.push(`**季节维度**：7 月对 1 月的 24h 研究价倍数，最高的区划是 ${julJan[0].name}（${julJan[0].ratio.toFixed(2)}×），最低是 ${julJan[julJan.length - 1].name}（${julJan[julJan.length - 1].ratio.toFixed(2)}×）——「同城不同季」不是修辞，是价目表。\n`);
  L.push("## 三、可直接用于答辩的三句话\n");
  L.push(`1. 「武汉内部就有 ${(max24.chain24 / min24.chain24).toFixed(2)} 倍价差——${max24.name} ${money(max24.chain24)} 元、${min24.name} ${money(min24.chain24)} 元，我们没有用一张全市均价糊过去。」`);
  L.push(`2. 「同一个月，不同季节价差最高 ${julJan[0].ratio.toFixed(1)} 倍（${julJan[0].name}）——这是 11 年逐小时数据算出来的，不是拍脑袋的季节系数。」`);
  L.push("3. 「这些数字不是 PPT 里的表：链上 244 格随时可 `premiumOf` 逐格核对，研究价用同一份代码可重算（`gen-wuhan-case.js` 一行命令）。」\n");
  L.push("## 四、配套的真实素材（已在链上跑）\n");
  L.push("- 演示保单 #0：武汉 24h，8.80 元，11-03 22:00 买入 → 11-04 22:00 生效（T+1）→ keeper 自动锚定基线 12.6mm，状态 active；");
  L.push("- 2024-06-24~26 三天 230mm 回放：`node 07-测试工具/check-replay.js`（历史窗口逐窗可复算）。\n");

  const out = path.join(ROOT, "02-作战与答辩/武汉落地素材-2026-11-04.md");
  fs.writeFileSync(out, L.join("\n"), "utf8");
  fs.writeFileSync(path.join(ROOT, "02-作战与答辩/武汉落地素材.json"), JSON.stringify({ generatedAt: new Date().toISOString(), modelId: model.modelId, regions: rows.map(r => ({ code: r.code, name: r.name, chain12: r.chain12, chain24: r.chain24, m1_12: r["12_1"], m1_24: r["24_1"], m7_12: r["12_7"], m7_24: r["24_7"] })) }, null, 2));
  console.log("written:", out, "+ JSON");
})().catch(e => { console.error("💥 " + (e.shortMessage || e.message)); process.exit(1); });
