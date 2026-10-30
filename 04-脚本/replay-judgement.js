#!/usr/bin/env node
/**
 * replay-judgement.js —— 判定一键重放（G6，2026-10-26）
 *
 * 干什么：拿一份留痕（snapshot-policyN.json + judgement-policyN.json），
 *   ① 复算快照 inputHash，与文件声称值比对；
 *   ② 用**同一份规则代码**（ai-judge.js 的 decide / buildRecord）重跑判定；
 *   ③ 复算 outputHash（keccak256(canonicalize(judgement))），与留痕比对；
 *   ④ 可选：与链上 judgements(policyId) 的记录比对（--onchain）。
 * 为什么：把"AI 判定"从黑箱变成可复算函数 —— 第三方拿同一份快照重跑，得到逐字节相同的结论。
 *
 * 用法：
 *   node replay-judgement.js 0                 # 重放保单 #0（读 09-AI判定留痕/）
 *   node replay-judgement.js 0 --onchain       # 另与链上记录比对（只读）
 *   node replay-judgement.js --all             # 把目录里所有留痕全重放一遍
 * 退出码：0 全部一致；1 有不一致；2 用法错。
 */
"use strict";
const path = require("path");
const fs = require("fs");
require(path.join(__dirname, "node_modules", "dotenv")).config({ path: path.join(__dirname, ".env") });
const ACTIVE = require("./active-deployment").applyDeployment();
const DIR = process.argv.includes("--legacy") ? path.join(__dirname,"../09-AI判定留痕") : (process.env.AI_OUT_DIR || path.join(__dirname,"../09-AI判定留痕"));
const { evidenceHashOf } = require("./canonical");
const { decide, buildRecord } = require("./ai-judge");

const pass = [], fail = [];
const ok = (n, c, t = "") => { (c ? pass : fail).push(n); console.log(`  ${c ? "✅" : "❌"} ${n}${t ? "  " + t : ""}`); };

function replayOne(policyId) {
  const snapFile = path.join(DIR, `snapshot-policy${policyId}.json`);
  const jFile = path.join(DIR, `judgement-policy${policyId}.json`);
  console.log(`\n===== 重放保单 #${policyId} =====`);
  if (!fs.existsSync(snapFile) || !fs.existsSync(jFile)) {
    ok(`留痕齐备（snapshot + judgement）`, false, "文件缺失");
    return;
  }
  const { snapshot, inputHash: claimedInput } = JSON.parse(fs.readFileSync(snapFile, "utf8"));
  const rec = JSON.parse(fs.readFileSync(jFile, "utf8"));

  // ① 快照哈希
  const input = evidenceHashOf(snapshot);
  ok("① 快照 inputHash 可复算一致", input === claimedInput, `${input.slice(0, 18)}…`);

  // ② 同一份规则代码重跑
  const r = decide(snapshot);
  const rebuilt = buildRecord({ policyId, snapshot, r, inputHash: input, rationale: "(replay)", rationaleSource: "replay" });
  ok("② 判定结论一致", rebuilt.judgement.decision === rec.judgement.decision,
    `重放 ${r.decision} / 留痕 ${rec.judgement.decision}`);
  ok("② 置信度一致", rebuilt.judgement.confidence === rec.judgement.confidence,
    `${r.confidence}`);
  ok("② 指标逐项一致", JSON.stringify(rebuilt.judgement.metrics) === JSON.stringify(rec.judgement.metrics));

  // ③ outputHash —— 历史 schema 兼容（2026-10-06 的 #0/#1 把 decidedAt/rationale 也算进了哈希面；
  //    后来 schema 收敛把这些字段移出，以保护「可复算」不被时间戳破坏。重放按留痕自身键集走。）
  const legacyCustom = (o) => Object.fromEntries(Object.keys(rec.judgement).filter(k => o[k] !== undefined).map(k => [k, o[k]]));
  const isLegacy = Object.prototype.hasOwnProperty.call(rec.judgement, "decidedAt");
  const rebuiltHash = isLegacy
    ? evidenceHashOf({ ...legacyCustom(rebuilt.judgement), decidedAt: rec.judgement.decidedAt, rationale: rec.judgement.rationale, rationaleSource: rec.judgement.rationaleSource })
    : rebuilt.outputHash;
  if (isLegacy) console.log("  ℹ 旧 schema 留痕（decidedAt/rationale 曾在哈希面内）：按留痕自身口径重放");
  ok("③ outputHash 可复算一致", rebuiltHash === rec.outputHash,
    `重放 ${rebuiltHash.slice(0, 18)}… / 留痕 ${rec.outputHash.slice(0, 18)}…`);
  console.log(`  结论 ${r.decision} · 置信 ${r.confidence} · 依据：${(rec.judgement.reasons || []).join("；")}`);
}

async function onchain(policyId) {
  const { ethers } = require(path.join(__dirname, "node_modules", "ethers"));
  const p = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC || "https://rpc.bohr.life", undefined, { staticNetwork: true });
  const abi = require(path.join(__dirname, "..", "03-合约", (ACTIVE.version === "V6" ? "RainDeliveryInsuranceV6.abi.json" : "RainDeliveryInsuranceV5.abi.json")));
  const v5 = new ethers.Contract(process.env.CONTRACT_ADDRESS, abi, p);
  try {
    const j = await v5.judgements(policyId);
    if (!j.exists) { ok("④ 请求的链上判定确实存在", false, `保单 #${policyId} 无判定记录`); return; }
    const rec = JSON.parse(fs.readFileSync(path.join(DIR, `judgement-policy${policyId}.json`), "utf8"));
    ok("④ 与链上 outputHash 一致", String(j.outputHash).toLowerCase() === String(rec.outputHash).toLowerCase(),
      `链上 ${String(j.outputHash).slice(0, 18)}…`);
    ok("④ 与链上 conclusion/confidence 一致",
      Number(j.decision) === rec.judgement.decision && Number(j.confidence) === rec.judgement.confidence);
  } catch (e) { ok("④ 链上核验完成", false, String(e.shortMessage || e.message || "").slice(0, 60)); }
}

(async () => {
  const args = process.argv.slice(2);
  const wantOnchain = args.includes("--onchain");
  if (args.includes("--all")) {
    const ids = fs.readdirSync(DIR).map(f => (f.match(/^judgement-policy(\d+)\.json$/) || [])[1]).filter(Boolean).map(Number).sort((a, b) => a - b);
    if (!ids.length) { console.error("目录里没有判定留痕"); process.exit(2); }
    console.log(`发现 ${ids.length} 份判定留痕：${ids.map(i => "#" + i).join(" ")}`);
    for (const id of ids) { replayOne(id); if (wantOnchain) await onchain(id); }
  } else {
    const id = Number(args.find(a => /^\d+$/.test(a)));
    if (!Number.isInteger(id)) { console.error("用法：node replay-judgement.js <policyId>|--all [--onchain]"); process.exit(2); }
    replayOne(id);
    if (wantOnchain) await onchain(id);
  }
  console.log("=".repeat(64));
  console.log(`通过 ${pass.length} 项 / 失败 ${fail.length} 项`);
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error("💥 " + (e.shortMessage || e.message)); process.exit(1); });
