"use strict";
// 9 区划分歧的裁决包生成器（只读 + 本地产物，不发交易）。
// 输入：diverge-archive-2026-11-02/{summary.json,extra-models.json} + 链上 rainfall() 实读。
// 输出：每城裁决证据 JSON（含可复算 evidenceHash）+ 即用多签命令清单。
// 规则：额外三套独立模型（GEM/JMA/ARPEGE）中位数落在 gate 三模型范围内 → 建议
//       按 gate 中位数（Math.round，与自动喂价同口径）人工喂价；否则 hold。
//       链上写入本身仍须用户逐条执行（--send），本脚本不签任何交易。
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
require(path.join(__dirname, "..", "04-脚本", "node_modules", "dotenv")).config({ path: path.join(__dirname, "..", "04-脚本", ".env") });
const { ethers } = require(path.join(__dirname, "..", "04-脚本", "node_modules", "ethers"));
const { withRetry, provider: makeProvider } = require(path.join(__dirname, "..", "04-脚本", "rpc-read"));

const BASE = path.join(__dirname, "..");
const ARCH = path.join(BASE, "09-AI判定留痕", "diverge-archive-2026-11-02");
const OUT_DIR = path.join(BASE, "09-AI判定留痕", "diverge-adjudication-2026-11-03");
const REG = require(path.join(BASE, "04-脚本", "v5-regions.json"));
const NAME = Object.fromEntries(REG.map(r => [r.code, r.name]));
const sha256 = t => crypto.createHash("sha256").update(t, "utf8").digest("hex");

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const arch = JSON.parse(fs.readFileSync(path.join(ARCH, "summary.json"), "utf8"));
  const extra = JSON.parse(fs.readFileSync(path.join(ARCH, "extra-models.json"), "utf8"));
  const exByCode = Object.fromEntries(extra.rows.map(r => [r.code, r]));
  const p = makeProvider(ethers, process.env.SEPOLIA_RPC);
  const v6 = new ethers.Contract(process.env.CONTRACT_ADDRESS_V6 || process.env.CONTRACT_ADDRESS,
    require(path.join(BASE, "03-合约", "RainDeliveryInsuranceV6.abi.json")), p);

  const rows = [];
  const commands = [];
  for (const a of arch.rows) {
    const code = a.code, name = NAME[code] || a.name;
    const ex = exByCode[code] || {};
    const chainVal = Number(await withRetry(() => v6.rainfall(code)));
    const gateMedian = a.modelGate && a.modelGate.median;
    const corrob = ex.extra && ex.extra.withinGateRange === true && ex.extra.missingHours === 0;
    const row = { code, name, chainVal, fromIso: a.fromIso, toIso: a.toIso,
      gateModels: a.modelGate && a.modelGate.perModel, gateMedian,
      extraModels: ex.extra && ex.extra.perModel, extraMedian: ex.extra && ex.extra.median,
      corroborated: corrob, decision: null, target: null, evidenceHash: null, confidence: null, sources: 6 };
    if (corrob && Number.isFinite(gateMedian)) {
      const inc = Math.round(gateMedian);
      const target = Math.max(chainVal, chainVal + inc);
      const evFileRefs = {
        gateRawEvidence: a.rawEvidence, gateRawSha256: a.rawSha256,
        extraRawEvidence: `09-AI判定留痕/diverge-archive-2026-11-02/extra-raw-${code}.json`,
        extraRawSha256: ex.extra && ex.extra.sha256,
      };
      const canonical = `v6-feed-manual ${code} ${target}mm window(${a.fromIso}→${a.toIso}) ` +
        `gate-models=[${a.modelGate.perModel.join(",")}] gate-median=${gateMedian} ` +
        `extra-models=[${(ex.extra.perModel || []).join(",")}] extra-median=${ex.extra.median} ` +
        `gate-raw-sha256=${a.rawSha256} extra-raw-sha256=${ex.extra.sha256} adjudication=2026-11-03`;
      const evidenceHash = ethers.id(canonical);
      const confidence = Math.min(95, 60 + Math.max(0, target - chainVal));
      row.decision = "suggest-feed";
      row.target = target; row.evidenceHash = evidenceHash; row.confidence = confidence;
      row.evidenceCanonical = canonical;
      row.evidenceFileRefs = evFileRefs;
      fs.writeFileSync(path.join(OUT_DIR, `adjudication-${code}.json`), JSON.stringify({ schema: "rainproof/feed-adjudication@1", generatedAt: new Date().toISOString(), ...row }, null, 2));
      commands.push(`node 07-测试工具/multisig-call.js updateRainfall ${code} ${target} ${evidenceHash} ${confidence} 6 --send   # ${name} ${chainVal}→${target}mm（gate 中位 ${gateMedian.toFixed(1)}，独立三模型 ${ex.extra.median.toFixed(1)} 佐证）`);
    } else {
      row.decision = "hold";
      row.reason = "独立模型中位数不在 gate 范围内（鹤峰）或证据不完整——建议等 ERA5 archive 回填（约 2-5 天）后再裁决";
      fs.writeFileSync(path.join(OUT_DIR, `adjudication-${code}.json`), JSON.stringify({ schema: "rainproof/feed-adjudication@1", generatedAt: new Date().toISOString(), ...row }, null, 2));
    }
    rows.push(row);
    console.log(`${code} ${name}: ${row.decision}${row.target ? " " + chainVal + "→" + row.target + "mm conf=" + row.confidence : ""}`);
    await new Promise(r => setTimeout(r, 250));
  }
  await p.destroy();
  const md = [
    "# 9 区划分歧裁决 · 即用命令（2026-11-03 生成）",
    "",
    "> 依据：gate 三模型窗口增量（09-AI判定留痕 raw）+ 三套独立模型（GEM/JMA/ARPEGE）同窗口佐证",
    "> （extra-models.json，SHA-256 " + sha256(fs.readFileSync(path.join(ARCH, "extra-models.json"))) + "）。",
    "> 规则：独立中位数落在 gate 范围内 → 建议按 gate 中位数（Math.round，与自动喂价同取整口径）人工喂价。",
    "> evidenceHash 为 keccak256(可复算 canonical 字符串)，每城证据文件见 adjudication-<code>.json。",
    "> confidence 沿用自动喂价公式 min(95, 60+增量)；sources=6（三 gate 模型 + 三独立模型）。",
    "> **鹤峰县 hold**：6 个模型 21.1–53.1mm 无收敛，继续拒喂，等 ERA5 回填后裁决。",
    "",
    "## 建议喂价（8 城，逐条执行；去掉注释前先确认 target 无误）",
    "",
    "```bash",
    ...commands,
    "```",
    "",
    "## 执行后验证",
    "",
    "```bash",
    "node 07-测试工具/audit-events-full.js   # 应看到 8 条新 RainfallUpdated，且 lastFeedAt 刷新",
    "node 04-脚本/preflight.js               # ❌ 喂价项应只剩 鹤峰县（或清零）",
    "```",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(OUT_DIR, "adjudication-commands.md"), md);
  fs.writeFileSync(path.join(OUT_DIR, "adjudication-summary.json"), JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2));
  console.log("saved:", OUT_DIR);
}

main().catch(e => { console.error("💥", (e && e.message) || e); process.exit(1); });
