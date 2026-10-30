#!/usr/bin/env node
/**
 * reprice-review.js —— 定价季度回溯（C2，2026-10-25）
 *
 * 干什么：把「链上实际发生的事」与「定价时的假设」摆到一张表上：
 *   · 假设侧：定价引擎的点估计触发率（11 年实测）× 满额赔付 ÷ 链上现价 = 理论赔付率
 *   · 实际侧：链上保单的实收保费与实付赔款（数据还薄时如实标"样本不足"）
 *   · 结论：理论赔付率 > 60% 红线的城市 → 给出重定价命令（走多签两票）
 * 纪律：只读 + 报告；重定价永远人工触发（依据串哈希可审计）。
 *
 * 用法：node reprice-review.js
 */
"use strict";
const path = require("path");
require(path.join(__dirname, "node_modules", "dotenv")).config({ path: path.join(__dirname, ".env") });
const { ethers } = require(path.join(__dirname, "node_modules", "ethers"));

const CODE = { 1: 420100, 2: 310100, 3: 110100, 4: 440100, 5: 510100 };   // 精算表 id → v5 区划码
const CITY = { 1: "武汉", 2: "上海", 3: "北京", 4: "广州", 5: "成都" };
const PAYOUT = 10000n;                                  // 分（100 元，与 v4 链上一致）
const RED_LINE = 0.60;

(async () => {
  const engine = require(path.join(__dirname, "..", "10-金融与定价", "pricing-engine.json"));
  const p = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC || "https://rpc.bohr.life", undefined, { staticNetwork: true });
  const abi = require(path.join(__dirname, "..", "03-合约", "RainDeliveryInsuranceV5.abi.json"));
  const v4 = new ethers.Contract(process.env.CONTRACT_ADDRESS, abi, p);

  // 实际侧：扫全部保单，按城市累计实收/实付
  const n = Number(await v4.nextPolicyId());
  const act = {}; for (let i = 1; i <= 5; i++) act[i] = { prem: 0n, paid: 0n, cnt: 0 };   // 按精算 id 记，输出时换算区划码
  for (let i = 0; i < n; i++) {
    const q = await v4.policies(i);
    const rid = Object.keys(CODE).find(k => CODE[k] === Number(q.regionId));
    if (!rid) continue;   // 非五城（如义乌兜底价）暂不入回溯表；continue 而不是 return，否则遇到第一张义乌单就整份报告静默终止
    act[rid].prem += q.premium; act[rid].cnt++;
    if (q.paid) act[rid].paid += q.payout;
  }

  console.log(`===== 定价回溯 · ${new Date().toLocaleString("zh-CN")} · 保单 ${n} 笔 =====\n`);
  console.log("城市 | 时长 | 链上价(元) | 点估计触发率 | 理论赔付率 | 实际(实收/实付 元) | 判定");
  let drift = [];
  for (let c = 1; c <= 5; c++) {
    for (const h of [12, 24]) {
      const cell = Object.values(engine.cells).find(x => x.regionId === c && x.hours === h && x.segKey === "t0c0");   // 精算表仍是 1..5 旧 id
      const price = await v4.premiumOf(CODE[c], h);
      const pPoint = cell ? cell.pointRatePct / 100 : null;             // 众包自助段（网格对应段）
      const lrTheory = pPoint != null && Number(price) > 0 ? (pPoint * Number(PAYOUT)) / Number(price) : null;
      const mark = lrTheory == null ? "无精算格" : lrTheory > RED_LINE ? "⚠ 越红线" : lrTheory > 0.55 ? "贴线" : "OK";
      if (lrTheory != null && lrTheory > RED_LINE) drift.push({ c, h, price, lrTheory });
      const a = act[c];
      console.log(`${CITY[c]} | ${h}h | ${(Number(price) / 100).toFixed(2)} | ${(pPoint * 100).toFixed(2)}% | ${lrTheory == null ? "—" : (lrTheory * 100).toFixed(1) + "%"} | ${(Number(a.prem) / 100).toFixed(2)}/${(Number(a.paid) / 100).toFixed(2)}（${a.cnt} 单${a.cnt < 50 ? "，样本不足只看理论侧" : ""}） | ${mark}`);
    }
  }
  if (drift.length) {
    console.log("\n重定价建议（引擎理论价按 P=ceil((E97.5×PAYOUT+C)/0.6)，见 rmb-pricing.js；执行走两票）：");
    for (const d of drift) {
      // v5 起改价也走 2/3 多签：setgrid-v3/v4 是对不上 v5 选择器的旧脚本（2026-10-26 实测双双 revert）
      console.log(`  ${CITY[d.c]} ${d.h}h：现价 ${(Number(d.price) / 100).toFixed(2)} 元 → 理论赔付率 ${(d.lrTheory * 100).toFixed(1)}% 越线`);
      console.log(`      理论价重算： node 04-脚本/rmb-pricing.js --code=${d.c}`);
      console.log(`      写到链上：   node 07-测试工具/multisig-call.js setPremiumGrid ${d.c} <12h_分> <24h_分> <理由哈希32B> --send`);
    }
  } else {
    console.log("\n全部 10 格在红线内 —— 本季无需调价。");
  }
  console.log(`\n（实际侧样本 ${n} 单；样本 ≥50 前以理论侧为准。数据源：pricing-engine.json 11 年实测 + 链上 ${await v4.getAddress()}）`);
})().catch(e => { console.error("💥 " + (e.shortMessage || e.message)); process.exit(1); });
