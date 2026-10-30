#!/usr/bin/env node
/**
 * open-hubei.js —— 把湖北 118 个区划一次性开通成「可投保」
 *
 * 对每个区划做三件事（幂等，已满足就跳过）：
 *   ① registerRegion(code, name)            —— 未开通才发（重复注册=改名，不计新数）
 *   ② setPremiumGrid(code, 12|24, 分, hash) —— 与 hubei-pricing.json 不一致才发
 *   ③ updateRainfall(code, 自 2026-10-01 的累计 mm, evidence, conf, src)
 *      —— 链上 0 或喂价超过 20h 才发（合约买前要求 lastFeedAt ≤ 24h）
 *
 * 为什么累计从 2026-10-01 起算：与 push-rainfall-v5.js 对「从未喂过」的城市的
 * 首喂口径一致（lastFed=0 → fromIso=2026-10-01），这样后续 keeper 接着加增量。
 *
 * 两票：owner-keys-2026-10-24.json 的 accounts[0] 提交、accounts[1] 确认，
 * 与 07-测试工具/multisig-call.js 完全相同；每次调用后等收据，失败重试 3 次。
 *
 * 用法：
 *   node 04-脚本/open-hubei.js                     # 干跑：只打印将要发的动作
 *   node 04-脚本/open-hubei.js --send              # 真发
 *   node 04-脚本/open-hubei.js --send --only=420100
 *   node 04-脚本/open-hubei.js --send --skip-feed  # 只开通+设价（喂价另跑）
 *   node 04-脚本/open-hubei.js --send --force      # 已一致也重发（一般不必要）
 */
"use strict";
const path = require("path");
const fs = require("fs");
const zlib = require("zlib");
const crypto = require("crypto");
const ROOT = path.join(__dirname, "..");
require(path.join(__dirname, "node_modules", "dotenv")).config({ path: path.join(__dirname, ".env") });
const { ethers } = require(path.join(__dirname, "node_modules", "ethers"));

const argv = process.argv.slice(2);
const SEND = argv.includes("--send");
const SKIP_FEED = argv.includes("--skip-feed");
const FORCE = argv.includes("--force");
const only = (argv.find((a) => a.startsWith("--only=")) || "").split("=")[1];
const limit = Number((argv.find((a) => a.startsWith("--limit=")) || "").split("=")[1] || 0);

const REG_FILE = path.join(__dirname, "hubei-regions.json");
const PRICE_FILE = path.join(ROOT, "10-金融与定价", "hubei-pricing.json");
const KEY_FILE = process.env.OWNER_KEY_FILE
  || path.join(ROOT, "..", "密钥-本地", "owner-keys-2026-10-24.json");
const OUT_DIR = path.join(ROOT, "08-截图存证", "2026-10-27-湖北118区划开通");
const OCT_CACHE = path.join(ROOT, "10-金融与定价", "cache-hubei-oct");
const LOG = path.join(OUT_DIR, "open-hubei.log");

const sha256 = (t) => crypto.createHash("sha256").update(t).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function log(line) {
  const s = `[${new Date().toISOString()}] ${line}`;
  console.log(s);
  try { fs.mkdirSync(OUT_DIR, { recursive: true }); fs.appendFileSync(LOG, s + "\n"); } catch (_) {}
}

async function withRetry(fn, label, times = 3) {
  let last;
  for (let i = 0; i < times; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      log(`  ⚠️ ${label} 失败(${i + 1}/${times})：${(e.shortMessage || e.message || e).toString().slice(0, 120)}`);
      await sleep(2500 * (i + 1));
    }
  }
  throw last;
}

/** 自 2026-10-01 起的 ERA5 累计降水（mm，整数） */
async function bootstrapMm(r) {
  fs.mkdirSync(OCT_CACHE, { recursive: true });
  const f = path.join(OCT_CACHE, `${r.code}.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${r.lat}&longitude=${r.lon}` +
    `&start_date=2026-10-01&end_date=2026-10-26&hourly=precipitation&timezone=Asia%2FShanghai`;
  const r0 = await withRetry(() => fetch(url, { signal: AbortSignal.timeout(60000), headers: { "User-Agent": "rainproof-hubei-open/1.0" } }), `fetch ${r.code}`);
  if (!r0.ok) throw new Error(`archive HTTP ${r0.status}`);
  const text = await r0.text();
  const j = JSON.parse(text);
  const mm = Math.round((j.hourly.precipitation || []).reduce((s, v) => s + (Number(v) || 0), 0));
  const rec = { code: r.code, name: r.name, mm, digest: sha256(text), url, cachedAt: new Date().toISOString() };
  fs.writeFileSync(f, JSON.stringify(rec, null, 1), "utf8");
  return rec;
}

(async () => {
  const target = process.env.CONTRACT_ADDRESS;
  if (!target) throw new Error("04-脚本/.env 缺 CONTRACT_ADDRESS");
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC || "https://rpc.bohr.life", undefined, { staticNetwork: true });
  const abiV5 = JSON.parse(fs.readFileSync(path.join(ROOT, "03-合约", "RainDeliveryInsuranceV5.abi.json"), "utf8"));
  const abiMs = JSON.parse(fs.readFileSync(path.join(ROOT, "03-合约", "OperatorMultisig.abi.json"), "utf8"));
  const v5 = new ethers.Contract(target, abiV5, provider);
  const ms = new ethers.Contract(process.env.MULTISIG_ADDR || "0x21C8520D486be3805Cf3FaA7cCab896241410d98", abiMs, provider);
  const iface = new ethers.Interface(abiV5);
  const threshold = Number(await ms.threshold());
  const owners = JSON.parse(fs.readFileSync(KEY_FILE, "utf8")).accounts;
  const signers = owners.slice(0, threshold).map((k) => new ethers.Wallet(k.privateKey, provider));

  const regions = JSON.parse(fs.readFileSync(REG_FILE, "utf8")).regions;
  const prices = new Map(JSON.parse(fs.readFileSync(PRICE_FILE, "utf8")).regions.map((x) => [String(x.code), x]));
  const list = (only ? regions.filter((r) => String(r.code) === only) : regions).slice(0, limit || undefined);

  log(`== open-hubei ${SEND ? "SEND" : "DRY-RUN"} ==  合约 ${target}  多签 ${threshold}/${(await ms.getOwners()).length}  区划 ${list.length}`);

  async function act(fn, args, label) {
    const data = iface.encodeFunctionData(fn, args);
    if (!SEND) { log(`  · ${label}  [dry]`); return null; }
    const submitter = signers[0];
    const sTx = await withRetry(() => ms.connect(submitter).submit(target, 0, data), `${label} submit`);
    const rc1 = await sTx.wait();
    const txId = require("./multisig-receipt").submittedTxId(ms, rc1, target, data);
    let ok = false, confirms = 0;
    for (const s of signers.slice(1)) {
      const cTx = await withRetry(() => ms.connect(s).confirm(txId), `${label} confirm`);
      const rc = await cTx.wait();
      confirms = rc.status === 1 ? confirms + 1 : confirms;
    }
    const t = await ms.getTx(txId);
    ok = Boolean(t[4]);   // getTx: [target,value,data,confirmations,executed]
    log(`  ✓ ${label}  txId=${txId} submit=${sTx.hash.slice(0, 10)} gas=${rc1.gasUsed} executed=${ok}`);
    if (!ok) throw new Error(`${label} 两票后仍未执行（confirm=${confirms}）`);
    return txId;
  }

  let done = 0, skipped = 0;
  const pendingFeeds = [];   // 注册/设价全部完成后用 updateRainfallBatch 分块喂价，省 ~100 笔多签
  for (const r of list) {
    const p = prices.get(String(r.code));
    if (!p) throw new Error(`${r.code} 没有定价记录，先跑 hubei-pricing.js`);
    try {
      const st = await withRetry(() => v5.regions(r.code), `${r.code} regions()`);
      const active = Boolean(st[1]);
      if (!active) {
        await act("registerRegion", [r.code, r.name], `register ${r.code} ${r.name}`);
      } else { skipped++; }

      for (const h of [12, 24]) {
        const want = BigInt(p.grid[h]);
        const cur = await withRetry(() => v5.premiumGrid(r.code, h), `${r.code} grid${h}`);
        if (FORCE || cur !== want) {
          const basis = `${p.basis} · grid ${h}h = ${want}fen`;
          await act("setPremiumGrid", [r.code, h, want, ethers.id(basis)], `grid ${r.code} ${h}h=${want}`);
        }
      }

      if (!SKIP_FEED) {
        const fed = Number(await withRetry(() => v5.lastFeedAt(r.code), `${r.code} lastFeedAt`));
        const ageH = fed ? (Date.now() / 1000 - fed) / 3600 : Infinity;
        if (FORCE || ageH > 20) {
          if (!SEND) {
            log(`  · feed ${r.code} ${r.name}  [dry，发送时才拉 10-01 起报文]`);
            pendingFeeds.push({ code: r.code, name: r.name, mm: null, ev: null });
          } else {
            const b = await bootstrapMm(r);
            const chainMm = Number(await withRetry(() => v5.rainfall(r.code), `${r.code} rainfall`));
            const mm = Math.max(chainMm, b.mm);
            const ev = ethers.id(`rainproof-hubei-bootstrap|${r.code}|${b.mm}mm|sha256=${b.digest}`);
            pendingFeeds.push({ code: r.code, name: r.name, mm, ev });
          }
        }
      }
      done++;
      log(`[${done}/${list.length}] ${r.code} ${r.name} OK（grid ${p.grid[12]}/${p.grid[24]} 分）`);
      await sleep(300);
    } catch (e) {
      log(`❌ ${r.code} ${r.name} 失败：${(e.shortMessage || e.message || e).toString().slice(0, 200)}`);
      throw e;
    }
  }
  if (pendingFeeds.length && SEND) {
    const CHUNK = 20;
    for (let i = 0; i < pendingFeeds.length; i += CHUNK) {
      const part = pendingFeeds.slice(i, i + CHUNK);
      await act("updateRainfallBatch",
        [part.map((x) => x.code), part.map((x) => BigInt(x.mm)), part.map((x) => x.ev), part.map(() => 82), part.map(() => 2)],
        `feed×${part.length} ${part[0].code}..${part[part.length - 1].code}`);
    }
  } else if (pendingFeeds.length) {
    log(`  · ${pendingFeeds.length} 个区划待批量喂价 [dry]`);
  }
  log(`== 完成：${done} 个区划，${skipped} 个原本已开通，喂价 ${pendingFeeds.length} 个待发 ==`);
})().catch((e) => { log("💥 " + (e.shortMessage || e.message || e)); process.exit(1); });
