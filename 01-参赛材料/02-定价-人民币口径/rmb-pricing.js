#!/usr/bin/env node
/**
 * 人民币口径定价重算 —— 分子实验室保险创业赛用
 *
 * 与雨证仓库 10-金融与定价/pricing_engine.js 同一权威公式：
 *   P_net = ceilTick((E_upper × PAYOUT + C) / R*)   // 风险腿：97.5% 上界，不是点估计
 *   F     = ceilTick(C × (1 + M))                    // 成本地板
 *   P     = max(P_net, F, MIN_PREMIUM)
 * 差异仅两处（法币世界 vs 链上世界）：
 *   ① 计价单位：PAYOUT/C/保费全部为人民币分（整数运算，无浮点漂移）
 *   ② 单份固定成本 C：链上版 = 判定 gas + 赔付 gas；法币版 = 支付通道手续费 + 数据/推理摊销
 * 触发概率（含 97.5% 上界 upperRatePct、点估计 pointRatePct）逐格取自雨证引擎的 11 年实测，
 * 未做任何改动 —— 换算只是线性的计价单位迁移，风险口径与链上版完全一致。
 *
 * 用法：node rmb-pricing.js [--payout 元] [--cost 元] > 表.md   （默认 PAYOUT=100 元，C=0.30 元）
 * 数据源（只读）：<项目根>\10-金融与定价\pricing-engine.json
 */
"use strict";

const fs = require("fs");
const path = require("path");

// ---------- 参数 ----------
const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, arr) => (a.startsWith("--") ? [a.slice(2), arr[i + 1]] : [])).filter((p) => p.length === 2)
);
const PAYOUT_YUAN = Number(args.payout ?? 100); // 额度基数；两档实赔 50%/75%
const C_YUAN = Number(args.cost ?? 0.3);
if (!Number.isFinite(PAYOUT_YUAN) || PAYOUT_YUAN <= 0 || !Number.isFinite(C_YUAN) || C_YUAN < 0) {
  throw new Error("--payout 必须为正金额，--cost 必须为非负金额");
}
const R_STAR = 0.6;                              // 赔付率上限 R*（约束：期望赔付率 ≤ 60%）
const M = 0.25;                                  // 成本加成（成本地板 = C × 1.25）
const TICK_FEN = 10;                             // 保费网格 0.1 元
const MIN_PREMIUM_FEN = 100;                     // 保费地板 1.0 元（低于此不卖：渠道尊严地板）
const BATCH_NS = [1, 10, 100, 1000];             // 输出的批量档

const SRC = path.resolve(__dirname, "../../10-金融与定价/pricing-engine.json");
const PAYOUT_FEN = Math.round(PAYOUT_YUAN * 100);
const C_FEN = Math.round(C_YUAN * 100);
const ceilTick = (fen) => Math.ceil((fen - 1e-6) / TICK_FEN) * TICK_FEN; // 只许向上

// ---------- 读取 40 格 ----------
const engine = JSON.parse(fs.readFileSync(SRC, "utf8"));
const cells = Object.values(engine.cells);
const meta = engine.meta;

const SEG_ORDER = ["t2c1", "t1c1", "t1c0", "t0c0"]; // 平台团体·平台代付 / 认证·平台代付 / 认证·自助 / 众包·自助
const SEG_NAME = { t2c1: "平台团体·代付", t1c1: "认证·代付", t1c0: "认证·自助", t0c0: "众包·自助" };
const CITIES = [...new Set(cells.map((c) => c.regionName))];

function priceCell(cell, N) {
  const eUpper = cell.upperRatePct / 100;                       // 已按赔付档加权的 97.5% 上界赔付比例
  const cN = Math.max(Math.round(C_FEN / N), 1);                // 固定成本随份数摊薄（法币口径下很小）
  const pNet = ceilTick((eUpper * PAYOUT_FEN + cN) / R_STAR);
  const floor = ceilTick(cN * (1 + M));
  const p = Math.max(pNet, floor, MIN_PREMIUM_FEN);
  const fair = (cell.pointRatePct / 100) * PAYOUT_FEN;          // 点估计期望赔付
  return { p, pNet, floor, boundBy: pNet >= floor ? "risk" : "cost", lr: fair / p };
}

// ---------- 输出 ----------
const L = [];
L.push(`# 定价体系 · 人民币口径（PAYOUT 满额 ${PAYOUT_YUAN} 元，单份固定成本 ${C_YUAN.toFixed(2)} 元）`);
L.push("");
L.push(`> 生成：\`node rmb-pricing.js\`（${new Date().toISOString().slice(0, 10)}）· 风险口径源：雨证 pricing-engine.json v${meta.version}（${meta.dataStart} → ${meta.dataEnd}，11 年逐小时 ERA5）`);
L.push(`> 公式：\`P = max( ceilTick((E₉₇.₅ × ${PAYOUT_YUAN}元 + C)/0.6), ceilTick(C×1.25), 1.0元 )\`，ceilTick = 向上取整到 0.1 元。`);
L.push(`> 触发档线（国标 GB/T 28592—2012）：12h 档 30/70 mm，24h 档 50/100 mm；赔付比例仅 50% / 75%（即 ${(PAYOUT_YUAN / 2).toFixed(2)} / ${(PAYOUT_YUAN * 0.75).toFixed(2)} 元），没有 100% 赔付档。`);
L.push(`> LR 列 = 点估计期望赔付 ÷ 定价（理论 ≤ 60%；因按 97.5% 上界 + 向上取整定价，点估计口径的 LR 显著更低——这正是安全边际的来源）。`);
L.push("");

for (const hours of [12, 24]) {
  L.push(`## ${hours} 小时档（档线 ${hours === 12 ? "30 / 70 mm" : "50 / 100 mm"}）`);
  L.push("");
  L.push(`| 城市 | ${SEG_ORDER.map((s) => SEG_NAME[s] + "（元）").join(" | ")} | 众包自助 LR |`);
  L.push(`|---|---|---|---|---|---|`);
  for (const city of CITIES) {
    const row = SEG_ORDER.map((seg) => {
      const cell = cells.find((c) => c.regionName === city && c.hours === hours && c.segKey === seg);
      if (!cell) return "—";
      const { p } = priceCell(cell, 1);
      return (p / 100).toFixed(1);
    });
    const cellCrowd = cells.find((c) => c.regionName === city && c.hours === hours && c.segKey === "t0c0");
    const lr = cellCrowd ? (priceCell(cellCrowd, 1).lr * 100).toFixed(0) + "%" : "—";
    L.push(`| ${city} | ${row.join(" | ")} | ${lr} |`);
  }
  L.push("");
}

L.push("## 平台团体批量价（B2B 主打口径，元/份）");
L.push("");
L.push("> 法币口径下单份固定成本本来就小（链上版的批量折扣主要来自 gas 摊薄），所以这里的批量价与零售价差距不大——");
L.push("> **平台渠道的真实经济性在于零获客成本与整批结算**，而不是成本摊薄；给平台的商业折扣应作为商务政策另行决策（建议 ≤15%，守住 60% 赔付率红线）。");
L.push("");
L.push(`| 城市 × 时长 | ${BATCH_NS.map((n) => "N=" + n).join(" | ")} |`);
L.push(`|---|---|---|---|---|`);
for (const city of CITIES) {
  for (const hours of [12, 24]) {
    const cell = cells.find((c) => c.regionName === city && c.hours === hours && c.segKey === "t2c1");
    if (!cell) continue;
    L.push(`| ${city} ${hours}h | ${BATCH_NS.map((n) => (priceCell(cell, n).p / 100).toFixed(1)).join(" | ")} |`);
  }
}
L.push("");

const allRetail = cells.map((c) => priceCell(c, 1).p / 100);
L.push("## 汇总");
L.push("");
L.push(`- 40 格零售价区间：**${Math.min(...allRetail).toFixed(1)} – ${Math.max(...allRetail).toFixed(1)} 元/份**（PAYOUT 满额 ${PAYOUT_YUAN} 元）`);
const crowd = cells.filter((c) => c.segKey === "t0c0").map((c) => priceCell(c, 1).p / 100);
L.push(`- 众包自助（最贵渠道）区间：**${Math.min(...crowd).toFixed(1)} – ${Math.max(...crowd).toFixed(1)} 元/份**；平台团体批量（N≥100）普遍 **1 元级/份**`);
L.push(`- 单份期望赔付（点估计）= 触发概率 × 赔付档加权 × ${PAYOUT_YUAN} 元；定价按 97.5% 上界，安全边际 = 上界与点估计之差 + 40% 毛利空间`);
L.push("");

// 敏感性计算独立命名，不能覆盖部署所用的 100 元基准。
const base = PAYOUT_YUAN === 100 && C_YUAN === 0.3;
const filename = base ? "定价体系-人民币-数表.md" : `定价敏感性-额度${PAYOUT_YUAN}-成本${C_YUAN}.md`;
const output = args.out ? path.resolve(args.out) : path.join(__dirname, filename);
fs.writeFileSync(output, L.join("\n"), "utf8");
if (base && !args.out) {
  fs.writeFileSync(path.resolve(__dirname, "../../10-金融与定价/rmb-pricing-base.md"), L.join("\n"), "utf8");
}
console.log(L.join("\n"));
