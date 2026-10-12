#!/usr/bin/env node
/**
 * hook-watch —— 事件钩子：链上多一份保单，AI 层就自动做一次独立复核
 * ============================================================================
 *
 * 【它解决什么】
 *   合约里 buyPolicy() 只看链上条件，不看天气对不对。那谁来保证「这份保单是在一份
 *   可信的雨量基线上签的」？答案不该是运营方口头保证 —— 所以挂一个钩子：
 *   链上每出现一个 PolicyBought，AI 层就自动重做一遍独立复核，并留下带哈希的记录。
 *
 * 【它刻意不做的事】（诚实边界，答辩可以直接这么说）
 *   · 不改链上状态 —— 钩子没有权限，也不该有；它的产物是一份可复算的复核留痕
 *   · 不阻断投保 —— 保单在链上已经成立，它只回答「这次承保的证据成不成立」
 *   · 不代替判定 —— 「该不该赔」是判定层 `ai-judge.js`（R1–R5）的事，两者分工不同：
 *       本钩子管「承保时的基线可不可信」，判定层管「理赔时的增量够不够」
 *
 * 【三层检查】
 *   1. 承保参数   —— 时长 / 保费 / 阈值 / 赔付额，全部从链上读回，不用页面上的数
 *   2. 喂价新鲜度 —— 这个区域最近一次喂价距今多久（> 24h 标红；v2 合约里它是硬闸门）
 *   3. 三模型共识 —— ECMWF / GFS / ICON 交叉核验（复用 feed-verify.js）
 *                    ＋ 链上累计值与三模型中位数的背离度（阈值 60%，与判定层 R2 同口径）
 *
 * 【留痕为什么带哈希】
 *   reviewHash = keccak256(canonical(review)) —— 第三方拿到这份 JSON 能重算出同一个哈希。
 *   结论可以不同意，但「这份复核是什么时候、基于什么数据做的」无法被事后改写。
 *
 *   ★ 只有「投保那一刻就固定」的字段进 review（保单结构体 / 喂价事件 / 三模型快照）。
 *     链上实时读数（`rainfall[region]`、`policyStatus()`）**会随时间变**，放进哈希就等于
 *     让 reviewHash 过一会儿换个值 —— 它们放在 review 之外的 `observed` 里（schema @2）。
 *
 * 用法（必须在 04-脚本 目录下跑，否则读不到 .env）：
 *   node hook-watch.js --once              扫最近 N 个区块里的 PolicyBought，逐个复核后退出
 *   node hook-watch.js --blocks=5000       改扫描深度（默认 10000；publicnode 的 eth_getLogs 上限 50000）
 *   node hook-watch.js --from=11855930     从指定区块开始扫（含）
 *   node hook-watch.js --watch=20          常驻，每 20 秒扫一次，只在新保单出现时干活
 *   node hook-watch.js --dry-run           只打印，不写留痕文件
 *   node hook-watch.js --no-models         跳过三模型取数（离线 / 无代理时用）
 *   node hook-watch.js --force             已复核过的保单也重做
 *   node hook-watch.js --abi=auto|v1|v2|v3 读哪一版 ABI（默认 auto：按版本指纹自动识别）
 *   兼容旧写法：--v1 / --v2 / --v3（手工强制某一版）
 *
 * 环境变量（.env）：SEPOLIA_RPC / CONTRACT_ADDRESS；可选 AI_OUT_DIR 改留痕目录。
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { JsonRpcProvider, Contract } = require("ethers");
const { evidenceHashOf } = require("./canonical");
const { REGION_BY_ID } = require("./regions");
const { fetchModelSeries, gradeModels } = require("./feed-verify");

const V1_ABI_FILE = path.join(__dirname, "..", "03-合约", "RainDeliveryInsurance.abi.json");
const V2_ABI_FILE = path.join(__dirname, "..", "03-合约", "RainDeliveryInsuranceV2.abi.json");
const V3_ABI_FILE = path.join(__dirname, "..", "03-合约", "RainDeliveryInsuranceV3.abi.json");
const ABI_BY_KIND = { v1: V1_ABI_FILE, v2: V2_ABI_FILE, v3: V3_ABI_FILE };
const OUT_DIR = process.env.AI_OUT_DIR || path.join(__dirname, "..", "09-AI判定留痕");

const REVIEW_VERSION = "hook-watch@2";   // @2：可变量移出 review（进 observed），见文件头
const RECORD_SCHEMA = "rainproof/underwrite-review@2";
// ★ 这些字段会随链上状态变化，**不许进 review**（进了哈希就会自己漂）。自检钉住这条白名单。
const MUTABLE_KEYS = ["policyStatus", "onchainCumulativeMm", "incrementMm", "baselineDeviationPct", "checks", "flagged", "verdict"];
const STALE_FEED_SEC = 24 * 3600;   // 超过这个年纪的喂价 = 基线不可信（v2 合约里是硬闸门）
const DEVIATION_LIMIT_PCT = 60;     // 链上累计值与三模型中位数的允许背离（与判定层 R2 同口径）
// 各版本合约允许的窗口档位。这张表是 reviewPolicy 的输入之一 ——
// 拿 v2 的白名单（24/48/72）去复核 v3 保单，12h 会被误判成「这一层把保单读错了」。
const WINDOWS_BY_KIND = { v1: [24, 48, 72], v2: [24, 48, 72], v3: [12, 24] };
const DEFAULT_BLOCKS = 10000;       // 扫描深度：publicnode 的 eth_getLogs 单次上限是 50000
const FEED_LOOKBACK_BLOCKS = 10000; // ★ 喂价新鲜度的查询窗口必须固定：若跟着扫描起点走，留痕哈希每轮都会漂

const ARGV = process.argv.slice(2);
const has = (f) => ARGV.includes(f);
const arg = (f, d) => { const a = ARGV.find((x) => x.startsWith(f + "=")); return a ? a.split("=")[1] : d; };
const ts = () => new Date().toTimeString().slice(0, 8);
const iso = (sec) => new Date(Number(sec) * 1000).toISOString();
/** ★ 取模型预报的窗口末日。原来是 UTC 切法（`toISOString().slice(0,10)`），与同一批喂价/判定
 *  用的东八区切法差一天 —— 留痕里「模型那一层取的是哪一天」于是和链上喂价的口径对不上。
 *  现在统一走 ./shardate（A11）。别名 ymd 保留，调用点不动。 */
const { shDate: ymd } = require("./shardate");

/* ------------------------------------------------------------------ 纯判定 */

/**
 * 承保复核判定（纯函数：只吃数据、只吐结论）
 *
 * 故意做成纯函数：① 离线可断言 ② 第三方拿到留痕里的数据能复算出同一结论。
 * 未知（null）不算失败 —— 拿不到数就说拿不到，不能假装查过了。
 *
 * @param {{windowHours:number, rainfallAtBuyMm:number, onchainMm:number,
 *          feedAgeSec:number|null, models:object|null, kind?:("v1"|"v2"|"v3")}} x
 *        kind 只影响「窗口档位白名单」：v1/v2 = 24/48/72，v3 = 12/24。缺省按 v1/v2。
 */
function reviewPolicy(x) {
  const checks = {};
  const flagged = [];

  /* 合约允许的档位随版本变：v1/v2 = 24/48/72，v3 = 12/24（v3 把窗口改成 12/24 之后，
     这里若仍按 v2 的白名单判，12h 的 v3 保单会被误标成「读错了」）。
     读到表外的值说明这一层把保单读错了，属于该报警的异常，不是「容错」。
     x.kind 缺省 = v1/v2 口径，保证旧调用点（与门禁用例）语义不变。 */
  checks.windowOk = (WINDOWS_BY_KIND[x.kind] || WINDOWS_BY_KIND.v2).includes(Number(x.windowHours));
  if (!checks.windowOk) flagged.push("window-out-of-range");

  checks.baselineMonotonic = x.rainfallAtBuyMm <= x.onchainMm;
  if (!checks.baselineMonotonic) flagged.push("baseline-above-onchain");

  checks.feedFresh = x.feedAgeSec === null || x.feedAgeSec === undefined
    ? null
    : x.feedAgeSec <= STALE_FEED_SEC;
  if (checks.feedFresh === false) flagged.push("stale-feed");

  const m = x.models;
  checks.modelsAgree = m ? (m.status === "agree" || m.status === "majority") : null;
  if (checks.modelsAgree === false) flagged.push("models-not-agreeing");

  let deviationPct = null;
  if (m && m.medianMm !== null && m.medianMm !== undefined) {
    const base = Math.max(Math.abs(m.medianMm), 1);   // 1mm 地板：中位数趋 0 时不做无穷放大
    deviationPct = Number(((Math.abs(x.onchainMm - m.medianMm) / base) * 100).toFixed(2));
    checks.baselineWithinModels = deviationPct <= DEVIATION_LIMIT_PCT;
    if (!checks.baselineWithinModels) flagged.push("baseline-deviates-from-models");
  } else {
    checks.baselineWithinModels = null;
  }

  return { checks, flagged, deviationPct, verdict: flagged.length ? "REVIEW_FLAG" : (checks.modelsAgree === null ? "REVIEW_PARTIAL" : "REVIEW_OK") };
}

/* ------------------------------------------------------------------ 读链 */

/**
 * 指纹探测的失败只有两种，混在一起就是上面注释里那个「静默读错」的根。
 *   · CALL_EXCEPTION / BAD_DATA = 这个合约上真没有这个函数（selector 打空 / 返回空）
 *     → 可以安全地退回旧版 ABI；
 *   · 其它（超时、ECONNREFUSED、限流、节点 5xx…）= **我们不知道**链上是什么版本
 *     → 必须抛出去让人重试。原来一律 catch 成「不是 v3/v2」，等于把「连不上」
 *       当成「链上没有」，接着拿 v1 ABI 去解 v2/v3 的 policies()，元组整体错位。
 */
function isMissingFunction(e) {
  const code = (e && e.code) || (e && e.info && e.info.error && e.info.error.code);
  return code === "CALL_EXCEPTION" || code === "BAD_DATA";
}
function throwIfNetErr(kind, e) {
  if (isMissingFunction(e)) return;
  const err = new Error(
    `合约版本指纹探测失败（试 ${kind} 的只读函数时出错）：${(e && (e.shortMessage || e.message)) || e}\n` +
    `  这不是「链上没有这个函数」，是 RPC / 网络层面的问题 —— 不敢猜版本，请确认 RPC 可达后重跑。`
  );
  err.cause = e;
  throw err;
}

/**
 * 合约版本指纹：v3 `entryThresholdOf(uint256)` ｜ v2 `thresholdOf(uint256)` ｜ v1 `THRESHOLD()`。
 * 探测顺序必须从新到旧 —— v3 的 `thresholdOf` 是 2 参，拿 v2 的 1 参签名去问必然失败；
 * 而「失败就退回 v1」更糟：v1 的 Policy 结构体少两个字段，解 v2/v3 的 policies()
 * 会整体错位（startTime 解成 regionId、endTime 解成 premium = 3e14 秒 → toISOString 直接抛）。
 * 原来这一层是手工开关 `--v2`：忘了传就用 v1 的 ABI 去读 v2 合约 → 静默读错，还不报错。
 */
async function detectKind(addr, provider, forced) {
  const mk = (kind) => new Contract(addr, JSON.parse(fs.readFileSync(ABI_BY_KIND[kind], "utf8")), provider);
  if (forced && ABI_BY_KIND[forced]) return { kind: forced, c: mk(forced) };
  const c3 = mk("v3");
  try { await c3.entryThresholdOf(24); return { kind: "v3", c: c3 }; } catch (e) { throwIfNetErr("v3", e); }
  const c2 = mk("v2");
  try { await c2.thresholdOf(24); return { kind: "v2", c: c2 }; } catch (e) { throwIfNetErr("v2", e); }
  return { kind: "v1", c: mk("v1") };
}

/** 一份保单的承保面：v1 / v2 / v3 的字段不同，这里统一成同一种形状 */
async function surfaceOf(c, id, kind) {
  const p = await c.policies(id);
  const regionId = Number(p.regionId);
  const region = REGION_BY_ID[regionId] || { id: regionId, key: `unknown${regionId}`, name: `未知区域 ${regionId}` };
  const startTime = Number(p.startTime);
  const endTime = Number(p.endTime);
  const onchainMm = Number(await c.rainfall(regionId));
  // v1 的保单结构体没有 windowHours 字段，只能按 start/end 反推；v2/v3 直接读。
  const windowHours = kind === "v1" ? Math.round((endTime - startTime) / 3600) : Number(p.windowHours);
  // 阈值三层来源：v3 把「入口线 × 赔付档」直接写进了保单结构体（thresholdMm，不用调合约）；
  // v2 只有一参的 thresholdOf(hours)；v1 是全局常量 THRESHOLD()。
  const thresholdMm = kind === "v3" ? Number(p.thresholdMm)
    : kind === "v2" ? Number(await c.thresholdOf(windowHours))
      : Number(await c.THRESHOLD());
  const premiumWei = kind === "v1" ? await c.premiumOf(regionId) : p.premium;
  const payoutWei = kind === "v1" ? await c.PAYOUT() : p.payout;
  return {
    p, regionId, region, startTime, endTime, windowHours, thresholdMm,
    premiumWei: String(premiumWei), payoutWei: String(payoutWei),
    rainfallAtBuyMm: Number(p.rainfallAtBuy),
    onchainMm,
    status: await c.policyStatus(id),
  };
}

/** 喂价新鲜度
 *  ★ 一律用「投保区块之前最近一次 RainfallUpdated」反推，**不直接读 v2 的 lastFeedAt**：
 *    lastFeedAt 是可变映射，之后每喂一次价它就变，直接读会让这份留痕的哈希随时间漂移；
 *    而链上最后一次喂价正是 lastFeedAt 的来源（rejectFeed 不刷新它），两者在投保那一刻等价。 */
async function feedInfo({ c, provider, kind, regionId, asOfSec, fromBlock, toBlock }) {
  const logs = await c.queryFilter(c.filters.RainfallUpdated(regionId), fromBlock, toBlock);
  if (!logs.length) {
    return { known: false, note: `投保区块之前、最近 ${FEED_LOOKBACK_BLOCKS} 个区块内没有该区域的喂价事件（v2 的 lastFeedAt 由该事件维护，v1 没有这个字段）` };
  }
  const last = logs[logs.length - 1];
  const blk = await provider.getBlock(last.blockNumber);
  return {
    known: true, source: "投保时刻最近的 RainfallUpdated(链上)", time: Number(blk.timestamp),
    ageSeconds: asOfSec - Number(blk.timestamp), block: last.blockNumber, txHash: last.transactionHash,
    confidence: Number(last.args.confidence),
  };
}

/* ------------------------------------------------------------------ 复核一份保单 */

/* -------------------------------------------------- review / observed 分家（A7）
 * review 进哈希：只有「投保那一刻就固定」的东西 —— 保单结构体、投保区块、喂价事件、三模型快照。
 * observed 不进哈希：重跑一次才会得到的东西 —— 链上实时读数、保单状态、复核结论。
 * 分开之后「同一份保单重跑」哈希不变，而当下状态变没变仍然看得见。
 *   ⚠️ 判断标准是「这个值会不会随时间变」，不是「重不重要」。verdict 很重要，但它取决于
 *      onchainCumulativeMm，所以它也只能在 observed 里。
 */
function splitRecord({ id, chainId, addr, kind, txHash, blockNumber, asOfSec, s, feed, models, v, reviewVersion }) {
  const review = {
    hook: "PolicyBought",
    policyId: id,
    chainId,
    contract: addr,
    abi: kind,
    txHash,
    blockNumber,
    asOf: iso(asOfSec),
    rider: s.p.rider,
    regionId: s.regionId,
    regionKey: s.region.key,
    regionName: s.region.name,
    startTime: s.startTime,
    endTime: s.endTime,
    windowHours: s.windowHours,
    thresholdMm: s.thresholdMm,
    premiumWei: s.premiumWei,
    payoutWei: s.payoutWei,
    rainfallAtBuyMm: s.rainfallAtBuyMm,
    feed: feed.known
      ? { source: feed.source, lastFeedTime: iso(feed.time), ageSeconds: feed.ageSeconds, blockNumber: feed.block, txHash: feed.txHash, confidence: feed.confidence }
      : { source: null, note: feed.note },
    models: models
      ? {
          status: models.status,
          agree: models.agree,
          medianMm: models.medianMm,
          spreadMm: models.spreadMm,
          toleranceMm: models.toleranceMm,
          perModelMm: models.perModelMm,
          usable: models.usableModels,
          missing: models.missingModels,
          outlierModels: models.outlierModels,
          window: models.window,
        }
      : null,
    reviewVersion,
  };
  const observed = {
    policyStatus: s.status,
    onchainCumulativeMm: s.onchainMm,
    incrementMm: s.onchainMm - s.rainfallAtBuyMm,
    baselineDeviationPct: v.deviationPct,
    checks: v.checks,
    flagged: v.flagged,
    verdict: v.verdict,
  };
  return { review, observed };
}

async function buildRecord({ c, provider, kind, noModels, chainId, addr, log, fromBlock, toBlock }) {
  const id = Number(log.args.policyId);
  const s = await surfaceOf(c, id, kind);
  const blk = await provider.getBlock(log.blockNumber);
  const asOfSec = Number(blk.timestamp);          // ★ 观察时刻 = 投保交易所在区块的时间（不可变、可复算）

  // ★ 起点固定为「投保区块往前 FEED_LOOKBACK_BLOCKS 块」，不用扫描游标 fromBlock：
  //   否则同一份保单换个扫描窗口重跑会得到不同的 note、进而不同的 reviewHash。
  const feed = await feedInfo({
    c, provider, kind, regionId: s.regionId, asOfSec,
    fromBlock: Math.max(0, log.blockNumber - FEED_LOOKBACK_BLOCKS), toBlock: log.blockNumber,
  });

  let models = null;
  let modelsError = null;
  if (!noModels) {
    try {
      models = gradeModels(await fetchModelSeries(s.region, ymd(asOfSec)));
    } catch (e) {
      modelsError = e.shortMessage || e.message;
    }
  }

  const v = reviewPolicy({
    kind,
    windowHours: s.windowHours,
    rainfallAtBuyMm: s.rainfallAtBuyMm,
    onchainMm: s.onchainMm,
    feedAgeSec: feed.known ? feed.ageSeconds : null,
    models,
  });

  const { review, observed } = splitRecord({
    id, chainId, addr, kind,
    txHash: log.transactionHash, blockNumber: log.blockNumber, asOfSec,
    s, feed, models, v, reviewVersion: REVIEW_VERSION,
  });

  const reviewHash = evidenceHashOf(review);
  const record = {
    schema: RECORD_SCHEMA,
    review,
    reviewHash,
    observed,                               // ← 不进哈希：链上实时读数、保单状态、复核结论
    reviewedAt: new Date().toISOString(),   // ★ 易变字段放 review 之外：重跑不会改变 reviewHash
    ...(modelsError ? { modelsError } : {}),
  };
  return { record, review, reviewHash };
}

/* ------------------------------------------------------------------ 打印 */

function printReview(r, reviewHash, record, modelsError) {
  // 可变量（保单状态 / 链上读数 / 结论）在 record.observed 里，不在进哈希的 review 里
  const o = (record && record.observed) || {};
  const tag = o.verdict === "REVIEW_OK" ? "✅ 复核通过"
    : o.verdict === "REVIEW_PARTIAL" ? "◻️ 部分复核（三模型未取数，只查了链上参数与喂价新鲜度）"
    : "⚠️ 复核存疑";
  console.log(`[${ts()}] 🪝 保单 #${r.policyId} · ${r.regionName}(#${r.regionId}) · ${r.windowHours}h · ${o.policyStatus}`);
  console.log(`           链上：投保时 ${r.rainfallAtBuyMm}mm → 现 ${o.onchainCumulativeMm}mm（本轮增量 ${o.incrementMm}mm，阈值 ${r.thresholdMm}mm）`);
  if (r.feed.source) {
    const age = r.feed.ageSeconds < 3600 ? `${Math.round(r.feed.ageSeconds / 60)} 分钟` : `${(r.feed.ageSeconds / 3600).toFixed(1)} 小时`;
    console.log(`           喂价：${r.feed.source} 距投保时刻 ${age}${r.feed.confidence === null ? "" : ` · 置信 ${r.feed.confidence}`}${r.feed.txHash ? ` · ${r.feed.txHash.slice(0, 14)}…` : ""}`);
  } else {
    console.log(`           喂价：未知 —— ${r.feed.note}`);
  }
  if (r.models) {
    const per = r.models.perModelMm.map((m) => `${m.label} ${m.mm}`).join(" / ");
    console.log(`           三模型：${r.models.status} 中位数 ${r.models.medianMm}mm（${per}）· 离散 ${r.models.spreadMm}mm · 容差 ${r.models.toleranceMm}mm`);
  } else {
    console.log(`           三模型：未取数${modelsError ? `（${modelsError}）` : "（--no-models）"}`);
  }
  if (o.baselineDeviationPct !== null && o.baselineDeviationPct !== undefined) {
    console.log(`           基线背离：链上 ${o.onchainCumulativeMm}mm vs 三模型中位数 ${r.models.medianMm}mm → ${o.baselineDeviationPct}%（阈值 ${DEVIATION_LIMIT_PCT}%）`);
  }
  console.log(`           ${tag}${(o.flagged || []).length ? "：" + o.flagged.join("、") : ""}`);
  if ((o.flagged || []).includes("baseline-deviates-from-models")) {
    console.log(`           ${" ".repeat(11)}（若该区域曾用 --demo 注入过模拟雨量，这个背离是预期的 —— 链上值来自模拟，模型不覆盖模拟数据）`);
  }
  console.log(`           留痕 ${path.relative(path.join(__dirname, ".."), record.file) || "（未写盘）"} · reviewHash ${reviewHash}`);
}

/* ------------------------------------------------------------------ 主流程 */

async function sweep({ c, provider, kind, noModels, dry, force, chainId, addr, fromBlock, toBlock }) {
  const logs = await c.queryFilter(c.filters.PolicyBought(), fromBlock, toBlock);
  let written = 0, skipped = 0;
  for (const log of logs) {
    const id = Number(log.args.policyId);
    const file = path.join(OUT_DIR, `承保复核-chain${chainId}-policy${id}.json`);   // 带链号：同址两条链是两个合约
    if (fs.existsSync(file) && !force) {
      // B6：留痕是「当时」的读数快照 —— 上游离线时写下的 REVIEW_PARTIAL 不自动补
      // （补写会把当时看到的链上读数换成现在这一刻的，反而失真）。这里至少把「这份是半张」说出来。
      let verdict = "";
      try { verdict = JSON.parse(fs.readFileSync(file, "utf8")).observed?.verdict || ""; } catch { /* 读不动就不猜 */ }
      const partial = verdict === "REVIEW_PARTIAL";
      console.log(`[${ts()}] 🪝 保单 #${id} 已经复核过（${path.basename(file)}）${partial ? " —— 这份是 REVIEW_PARTIAL（当时三模型没取到数）" : ""}，跳过（要重做加 --force）`);
      if (partial) {
        console.log(`           ${" ".repeat(11)}半张留痕不自动补（它记的是「当时」的链上读数）；要完整三模型复核请 --force 重跑，新记录会反映现在的读数`);
      }
      skipped++;
      continue;
    }
    const { record, review, reviewHash } = await buildRecord({ c, provider, kind, noModels, chainId, addr, log, fromBlock, toBlock });
    record.file = file;
    if (!dry) {
      fs.mkdirSync(OUT_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(record, null, 2));
      written++;
    }
    printReview(review, reviewHash, record, record.modelsError);
  }
  if (!logs.length) console.log(`[${ts()}] 🪝 区块 ${fromBlock}~${toBlock} 里没有新保单`);
  return { found: logs.length, written, skipped };
}

async function main() {
  // ABI 版本：默认靠链上指纹自动识别（见 detectKind）；--abi=v1|v2|v3 或
  // 旧写法 --v1/--v2/--v3 可强制指定，仅在指纹探测本身有争议时才需要。
  const forced = arg("--abi", has("--v3") ? "v3" : has("--v2") ? "v2" : has("--v1") ? "v1" : null);
  const addr = arg("--addr", process.env.CONTRACT_ADDRESS);
  if (!addr) throw new Error("请先在 .env 里填 CONTRACT_ADDRESS（或用 --addr=）");
  const noModels = has("--no-models");
  const dry = has("--dry-run");
  const force = has("--force");
  const watchSec = Number(arg("--watch", 0));
  const once = has("--once") || !watchSec;

  const provider = new JsonRpcProvider(process.env.SEPOLIA_RPC || process.env.RPC_URL);
  const net = await provider.getNetwork();
  const { kind, c } = await detectKind(addr, provider, forced);
  const head = await provider.getBlockNumber();
  let cursor = arg("--from", null) !== null
    ? Number(arg("--from"))
    : Math.max(0, head - Number(arg("--blocks", DEFAULT_BLOCKS)));

  console.log(`hook-watch 启动 · chainId ${net.chainId} · ${kind} ABI（${forced ? "手工指定" : "指纹自动识别"}）· 合约 ${addr}`);
  console.log(`  监听 PolicyBought · 从区块 ${cursor} 起${once ? "（扫一遍就退）" : ` · 每 ${watchSec} 秒扫一次`}\n`);

  for (;;) {
    const to = once ? head : await provider.getBlockNumber();
    if (to >= cursor) {
      const r = await sweep({ c, provider, kind, noModels, dry, force, chainId: Number(net.chainId), addr, fromBlock: cursor, toBlock: to });
      if (r.found) console.log(`[${ts()}] 本轮：发现 ${r.found} 份保单，新写留痕 ${r.written}，已存在跳过 ${r.skipped}\n`);
      cursor = to + 1;   // 只记已处理过的块号，避免重复拉同一段日志
    }
    if (once) return;
    await new Promise((r) => setTimeout(r, Math.max(2, watchSec) * 1000));
  }
}

/* ------------------------------------------------- 自检（--self-check，不联网不写盘）
 * 窗口白名单是随合约版本变的（v1/v2 = 24/48/72，v3 = 12/24）。钉住三版口径，
 * 顺便钉住「缺省不带 kind 时按 v1/v2」这条向后兼容约定。
 *   node hook-watch.js --self-check
 */
// require.main 守卫：check-feed-verify.js 会 require 本文件拿 reviewPolicy。
// 少了这道守卫，只要 argv 里带 --self-check（例如有人把 --self-check 透传给整个门禁），
// 自检就会在**别人**的进程里跑完并 process.exit —— 门禁提前结束、后面的断言全不执行，
// 拿到一个漂亮的假绿。直接 `node hook-watch.js --self-check` 时 self 仍是 main，自检照跑。
if (require.main === module && process.argv.includes("--self-check")) {
  let pass = 0, fail = 0;
  const ok = (n, c, extra = "") => { c ? pass++ : fail++; console.log(`${c ? "✅" : "❌"} ${n}${extra ? "  " + extra : ""}`); };
  const base = { rainfallAtBuyMm: 0, onchainMm: 5, feedAgeSec: 600, models: { status: "agree", medianMm: 5, agree: true } };
  const win = (kind, hours) => reviewPolicy(kind ? { ...base, kind, windowHours: hours } : { ...base, windowHours: hours });
  const oob = (r) => r.flagged.includes("window-out-of-range");

  ok("WINDOWS_BY_KIND.v3 = [12,24]", JSON.stringify(WINDOWS_BY_KIND.v3) === "[12,24]");
  ok("v1 12h → 越界", oob(win("v1", 12)));
  ok("v2 12h → 越界", oob(win("v2", 12)));
  ok("v3 12h → 通过（v3 国标两档）", !oob(win("v3", 12)));
  ok("v1/v2/v3 24h → 都通过", !oob(win("v1", 24)) && !oob(win("v2", 24)) && !oob(win("v3", 24)));
  ok("v3 48h → 越界（v3 只有 12/24）", oob(win("v3", 48)));
  ok("v2 48h/72h → 通过", !oob(win("v2", 48)) && !oob(win("v2", 72)));
  ok("不带 kind（旧调用点）→ 按 v1/v2：12h 越界、24/48/72 通过",
    oob(win(null, 12)) && !oob(win(null, 24)) && !oob(win(null, 48)) && !oob(win(null, 72)));
  const r = win("v3", 12);
  ok("判定仍返回完整形状（checks/flagged/deviationPct/verdict）",
    r.checks && Array.isArray(r.flagged) && typeof r.verdict === "string");

  // ── A7：哈希只覆盖「投保那一刻就固定」的字段 ──────────────────────────────
  const mkS = (over = {}) => ({
    p: { rider: "0xrider" }, regionId: 1, region: { key: "wuhan", name: "武汉" },
    startTime: 1791000000, endTime: 1791086400, windowHours: 24, thresholdMm: 50,
    premiumWei: "340", payoutWei: "5000000000000000",
    rainfallAtBuyMm: 30, onchainMm: 80, status: "active", ...over,
  });
  const feed = { known: true, source: "投保时刻最近的 RainfallUpdated(链上)", time: 1791000000, ageSeconds: 600, block: 1, txHash: "0xfeed", confidence: 90 };
  const models = { status: "agree", agree: true, medianMm: 78, spreadMm: 2, toleranceMm: 5, perModelMm: [], usableModels: 3, missingModels: [], outlierModels: [], window: "10-06~10-07" };
  const args = (s) => ({
    id: 1, chainId: 968, addr: "0xc", kind: "v2", txHash: "0xtx", blockNumber: 10, asOfSec: 1791000000,
    s, feed, models, reviewVersion: REVIEW_VERSION,
    v: reviewPolicy({ kind: "v2", windowHours: 24, rainfallAtBuyMm: s.rainfallAtBuyMm, onchainMm: s.onchainMm, feedAgeSec: 600, models }),
  });
  const a = splitRecord(args(mkS()));
  const b = splitRecord(args(mkS({ onchainMm: 999, status: "paid" })));
  ok("A7 可变量一个都不在 review 里（状态/链上读数/结论都在 observed）",
    MUTABLE_KEYS.every((k) => !(k in a.review)) && MUTABLE_KEYS.every((k) => k in a.observed));
  ok("A7 链上读数与保单状态变了 → reviewHash 一个字节都不动",
    evidenceHashOf(a.review) === evidenceHashOf(b.review), evidenceHashOf(a.review).slice(0, 18) + "…");
  ok("A7 但当下状态仍然看得见（observed 跟着变）",
    a.observed.onchainCumulativeMm === 80 && b.observed.onchainCumulativeMm === 999 && b.observed.policyStatus === "paid");
  ok("A7 投保基线变了 → reviewHash 必须变（否则哈希就没意义）",
    evidenceHashOf(splitRecord(args(mkS({ rainfallAtBuyMm: 31 }))).review) !== evidenceHashOf(a.review));

  console.log(`\n${fail ? "❌" : "✅"} hook-watch 自检：${pass} 项通过 / ${fail} 项失败`);
  process.exit(fail ? 1 : 0);
}

if (require.main === module) {
  main().catch((e) => { console.error("💥", e.shortMessage || e.message); process.exit(1); });
}

module.exports = { reviewPolicy, splitRecord, REVIEW_VERSION, RECORD_SCHEMA, MUTABLE_KEYS, STALE_FEED_SEC, DEVIATION_LIMIT_PCT, WINDOWS_BY_KIND, detectKind };
