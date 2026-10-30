/**
 * setgrid-v6.js —— v6 定价网格的「全量核对 + 按需修正」
 * ============================================================================
 * 存在的原因（交接文档 P1 待办第 8 条）：湖北开通是一次性脚本 open-hubei.js 干完的，
 * 之后没有人再核对过「链上 244 格（122 区划 × 12h/24h）是否仍等于定价表」。
 * 定价表 `10-金融与定价/hubei-pricing.json` 是 B 侧产物、由 `hubei-pricing.js` 生成；
 * 本工具只读它，把差异逐格列出来，必要时用两票多签改链。
 *
 * 默认干跑（只读链、不发交易）。要真改必须显式加 --send。
 *
 * 用法：
 *   node 04-脚本/setgrid-v6.js                  # 干跑：246 格全核，列出漂移
 *   node 04-脚本/setgrid-v6.js --json           # 机器可读（喂给 CI / preflight）
 *   node 04-脚本/setgrid-v6.js --only=420202    # 只看一个区划
 *   node 04-脚本/setgrid-v6.js --send           # 把不一致的格子按定价表改回（两票）
 *
 * 退出码：有漂移 = 2（便于 CI 判红）；全一致 = 0；断链/配置错 = 1。
 */
"use strict";
const path = require("path");
const fs = require("fs");
const ROOT = path.join(__dirname, "..");
require(path.join(__dirname, "node_modules", "dotenv")).config({ path: path.join(__dirname, ".env") });
const { ethers } = require(path.join(__dirname, "node_modules", "ethers"));

const ACTIVE = require("./active-deployment").applyDeployment();
const argv = process.argv.slice(2);
const SEND = argv.includes("--send");
const AS_JSON = argv.includes("--json");
const only = (argv.find((a) => a.startsWith("--only=")) || "").split("=")[1];

const REG_FILE = path.join(__dirname, "v5-regions.json");
const PRICE_FILE = path.join(ROOT, "10-金融与定价", "hubei-pricing.json");
const KEY_FILE = process.env.OWNER_KEY_FILE
  || path.join(ROOT, "..", "密钥-本地", "owner-keys-2026-10-24.json");
const HOURS = [12, 24];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function out(obj) { if (AS_JSON) return; console.log(obj); }

async function withRetry(fn, label, times = 3) {
  let last;
  for (let i = 0; i < times; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      out(`  ⚠️ ${label} 失败(${i + 1}/${times})：${(e.shortMessage || e.message || e).toString().slice(0, 120)}`);
      await sleep(2500 * (i + 1));
    }
  }
  throw last;
}

(async () => {
  const target = process.env.CONTRACT_ADDRESS;
  if (!target) throw new Error("04-脚本/.env 缺 CONTRACT_ADDRESS");
  const provider = new ethers.JsonRpcProvider(
    process.env.SEPOLIA_RPC || "https://rpc.bohr.life", undefined, { staticNetwork: true });

  const abiV6 = JSON.parse(fs.readFileSync(path.join(ROOT, "03-合约", "RainDeliveryInsuranceV6.abi.json"), "utf8"));
  const v6 = new ethers.Contract(target, abiV6, provider);

  const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
  const asList = (j) => Array.isArray(j) ? j : (j.regions || []);
  const regions = asList(readJson(REG_FILE));          // v6-regions.json 是裸数组
  const targets = new Map(asList(readJson(PRICE_FILE)).map((x) => [String(x.code), x.grid]));

  const list = only ? regions.filter((r) => String(r.code) === only) : regions;
  if (!list.length) throw new Error(`没有匹配的区划（--only=${only}）`);

  out(`== setgrid-v6 ${SEND ? "SEND" : "DRY-RUN"} ==  合约 ${target}  区划 ${list.length}  目标表 ${targets.size} 条`);

  const drift = [];      // 与定价表不一致
  const missing = [];    // 链上无价（0）= 该区划连通都不会承保
  const extra = [];      // 定价表有意不覆盖的区划（沪京穗蓉），只核对 >0
  let checked = 0, same = 0;

  for (const r of list) {
    const code = String(r.code);
    const want = targets.get(code);
    for (const h of HOURS) {
      let cur;
      try {
        cur = Number(await withRetry(() => v6.premiumGrid(r.code, h), `${code} grid${h}`));
      } catch (e) {
        out(`  ❌ ${code} ${r.name} ${h}h 读链失败：${(e.shortMessage || e.message || e).toString().slice(0, 120)}`);
        throw e;
      }
      checked++;
      if (cur === 0) { missing.push({ code: r.code, name: r.name, hours: h, want: want ? Number(want[h]) : null, cur }); continue; }
      if (!want) { extra.push({ code: r.code, name: r.name, hours: h, cur }); continue; }
      const w = Number(want[h]);
      if (cur !== w) drift.push({ code: r.code, name: r.name, hours: h, want: w, cur });
      else same++;
    }
    await sleep(120);   // 公共 RPC 别打太密
  }

  const problems = missing.length + drift.length;
  const report = {
    contract: target, dryRun: !SEND, regions: list.length, cells: checked,
    ok: same, missing, drift, notInPriceTable: extra,
    verdict: problems === 0 ? "pass" : "drift",
  };

  if (AS_JSON) { console.log(JSON.stringify(report, null, 1)); }
  else {
    out(`\n  核对 ${checked} 格：一致 ${same} · 不一致 ${drift.length} · 无价 ${missing.length} · 不在定价表 ${extra.length}`);
    if (missing.length) {
      out("\n  ⛔ 链上无价（这些区划买不了单）：");
      for (const x of missing) out(`     ${x.code} ${x.name} ${x.hours}h  cur=0  want=${x.want ?? "（无目标）"}`);
    }
    if (drift.length) {
      out("\n  ⚠️ 与定价表不一致：");
      for (const x of drift) out(`     ${x.code} ${x.name} ${x.hours}h  链上 ${x.cur} ≠ 表 ${x.want}`);
    }
    if (extra.length) {
      out("\n  ℹ️ 不在 hubei-pricing.json 里（沪京穗蓉等，只核对 >0）：");
      for (const x of extra) out(`     ${x.code} ${x.name} ${x.hours}h = ${x.cur} 分`);
    }
    out(problems === 0 ? "\n  ✅ 全部一致" : `\n  ❌ ${problems} 格需要处理${SEND ? "" : "（加 --send 修正）"}`);
  }

  if (problems === 0) process.exit(0);
  if (!SEND) process.exit(2);

  // ---- 修正：逐格两票（与 open-hubei.js 同一套多签流程）----
  const abiMs = JSON.parse(fs.readFileSync(path.join(ROOT, "03-合约", "OperatorMultisig.abi.json"), "utf8"));
  const ms = new ethers.Contract(process.env.MULTISIG_ADDR || "0x21C8520D486be3805Cf3FaA7cCab896241410d98", abiMs, provider);
  const iface = new ethers.Interface(abiV6);
  const threshold = Number(await ms.threshold());
  const owners = JSON.parse(fs.readFileSync(KEY_FILE, "utf8")).accounts;
  if (owners.length < threshold) throw new Error(`owner 钥匙只有 ${owners.length} 把，多签阈值 ${threshold}`);
  const signers = owners.slice(0, threshold).map((k) => new ethers.Wallet(k.privateKey, provider));

  const todo = [...missing, ...drift].filter((x) => x.want != null);
  const skipped = [...missing, ...drift].filter((x) => x.want == null);
  for (const x of skipped) out(`  ⏭️  ${x.code} ${x.name} ${x.hours}h 定价表无目标，跳过（需人工定价）`);

  let fixed = 0;
  for (const x of todo) {
    const basis = `setgrid-v6 repair ${x.code} grid ${x.hours}h = ${x.want}fen (was ${x.cur})`;
    const data = iface.encodeFunctionData("setPremiumGrid", [x.code, x.hours, BigInt(x.want), ethers.id(basis)]);
    const sTx = await withRetry(() => ms.connect(signers[0]).submit(target, 0, data), `${x.code} submit`);
    const receipt = await sTx.wait();
    const txId = require("./multisig-receipt").submittedTxId(ms, receipt, target, data);
    for (const s of signers.slice(1)) {
      const cTx = await withRetry(() => ms.connect(s).confirm(txId), `${x.code} confirm`);
      await cTx.wait();
    }
    const t = await ms.getTx(txId);
    if (!Boolean(t[4])) throw new Error(`${x.code} ${x.hours}h 两票后仍未执行（txId=${txId}）`);
    fixed++;
    out(`  ✓ ${x.code} ${x.name} ${x.hours}h → ${x.want} 分  txId=${txId}`);
    await sleep(400);
  }
  out(`\n  修正 ${fixed} 格，跳过 ${skipped.length} 格`);
  process.exit(skipped.length ? 2 : 0);
})().catch((e) => {
  console.error(`❌ setgrid-v6 失败：${(e.shortMessage || e.message || e).toString().slice(0, 400)}`);
  process.exit(1);
});