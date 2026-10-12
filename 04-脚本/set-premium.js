#!/usr/bin/env node
/**
 * set-premium —— 把《精算口径》的触发概率落到链上，作为各城市的差异化保费
 * ============================================================================
 *
 * 【为什么要有这个脚本】
 *   链上保费如果靠人手填，就没人能说清它从哪来。这个脚本把它变成一条可复算的链路：
 *
 *       10-金融与定价/actuary-output.json     （11 年逐小时实测，B 产出）
 *                    ↓  p = regions[key].windows["72"].p
 *       建议保费 = 上整( p × PAYOUT ÷ 目标赔付率 0.60 )，网格 0.0001 ETH
 *                    ↓  setUnderwriting(regionId, level, premium, reasonHash)
 *       Sepolia 合约 premiumOf(regionId)      （演示页读的就是它）
 *
 *   reasonHash 不是随手一个常量，而是把**这次实际用到的 p、窗口、目标赔付率、
 *   取整网格**拼成稳定串再哈希。任何第三方照着复算，必然得到同一个 hash；
 *   一旦精算数据更新，hash 自己就会变 —— 链上留痕能证明"价格随精算走"。
 *
 *   ⚠️ 哈希口径别混（C12）：这里的 reasonHash 用 **SHA256**（`04-脚本/rehearse-v2.js:114`
 *   同一套，第三方照抄依据串就能复算）；`04-脚本/canonical.js:51` 的 `evidenceHashOf` 用
 *   **keccak256** —— 那是 AI 判定证据（快照/判定 JSON）的哈希，另有 `07-测试工具/check-ai.js`
 *   逐个复算。两套哈希各有各的验证方，别互换、也别合并成一套。
 *   下面的 fileHash（精算文件的 SHA256）只打印、不写链也不落盘：链上承诺的是依据串 reasonHash，
 *   它已经把 p / 窗口 / 阈值 / 赔付 / 目标赔付率 / 网格全钉进去了，再存一份文件哈希只是多个没人读的产物。
 *
 * 【口径】
 *   窗口固定 72 小时（与合约 MAX_HOURS 一致，也是提交材料统一引用的口径）；
 *   概率越过 10% 保本线的城市标 RISK_LOADED，其余 RISK_NORMAL。
 *
 * 【用法】必须在 04-脚本 目录下跑（否则读不到 .env）
 *   node set-premium.js            只算不算，打印派生表（默认，安全）
 *   node set-premium.js --apply    真的发交易（写上链后逐区域回读断言，对不上就报错退出）
 *   node set-premium.js --apply --yes-mainnet   主网 677 必须额外确认这一次（与 deploy.js 同一道闸）
 *   node set-premium.js --hours=48 换窗口看看（只影响本次计算，链上仍应保持 72h）
 *
 * 【环境变量】.env：SEPOLIA_RPC / CONTRACT_ADDRESS / PRIVATE_KEY
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { REGIONS } = require("./regions");

const ROOT = path.join(__dirname, "..");
// 三版 ABI 都从 03-合约 读，不手抄。
// 原来这里只挂 v1：v1 是 premiumOf(regionId)（一参），v2/v3 是 premiumOf(regionId, hours)（两参）。
// 拿 v1 的签名去问 v2/v3 合约，selector 打空 → 读不到真实现值（或直接抛 CALL_EXCEPTION），
// 而 setUnderwriting 三版签名完全相同，于是「比对过了、写进去了」全程不报错 —— 静默用错口径定价。
const ABI_BY_KIND = {
  v1: path.join(ROOT, "03-合约", "RainDeliveryInsurance.abi.json"),
  v2: path.join(ROOT, "03-合约", "RainDeliveryInsuranceV2.abi.json"),
  v3: path.join(ROOT, "03-合约", "RainDeliveryInsuranceV3.abi.json"),
};
const ACTUARY_FILE = path.join(ROOT, "10-金融与定价", "actuary-output.json");

const ARGV = process.argv.slice(2);
const APPLY = ARGV.includes("--apply");
const HOURS = (ARGV.find((a) => a.startsWith("--hours=")) || "").split("=")[1] || "72";
// --v1/--v2/--v3 显式钉版本；不给就问链（见 pickKind）。留在 ARGV 里不参与 plan()，只影响读链。
const FORCED_KIND = (ARGV.find((a) => /^--v[123]$/.test(a)) || "").slice(2) || null;

const TARGET_LOSS_RATIO = 0.6;   // 目标赔付率：收 100 元赔 60 元，留 40 元做费用与风险附加
const TICK = 0.0001;             // 保费取整网格（上整，定价只许往上不许往下）
const LOSS_RED_LINE = 0.1;       // 触发概率红线：越过 10% 必亏（0.001 保费 / 0.01 赔付）

const pct = (x) => (x * 100).toFixed(3) + "%";

/** 上整到 TICK 网格。减去一个极小量，避免浮点让正好落在网格上的值多进一格 */
function ceilTick(raw) {
  return Math.ceil(raw / TICK - 1e-9) * TICK;
}

function plan() {
  if (!fs.existsSync(ACTUARY_FILE)) throw new Error(`缺少精算输出：${ACTUARY_FILE}（先跑 10-金融与定价/actuary.js）`);
  const act = JSON.parse(fs.readFileSync(ACTUARY_FILE, "utf8"));
  const payoutEth = act.meta.payoutEth;

  const rows = REGIONS.map((r) => {
    const info = act.regions[r.key];
    if (!info) throw new Error(`精算输出里没有 ${r.key}`);
    const w = info.windows[HOURS];
    if (!w) throw new Error(`精算输出里没有 ${HOURS} 小时窗口：${r.key}`);
    const p = w.p;
    const need = (p * payoutEth) / TARGET_LOSS_RATIO;        // 打到目标赔付率所需的保费
    const premium = ceilTick(need);
    return {
      id: r.id, key: r.key, name: r.name, p, hits: w.hits, windows: w.windows,
      need, premium,
      premiumEth: premium.toFixed(4),
      // 按最终保费算的真实赔付率：p × 赔付额 ÷ 实收保费
      lossRatio: (p * payoutEth) / premium,
      level: p > LOSS_RED_LINE ? 1 : 0,   // 1 = RISK_LOADED
      // 用旧价 0.001 时的赔付率，用来解释"为什么必须差异化"
      lossRatioFlat: (p * payoutEth) / act.meta.premiumEth,
    };
  });

  const reason = [
    "rainproof/underwriting@1",
    "source=10-金融与定价/actuary-output.json",
    `window=${HOURS}h`,
    `thresholdMm=${act.meta.threshold}`,
    `payout=${payoutEth}`,
    `targetLossRatio=${TARGET_LOSS_RATIO.toFixed(2)}`,
    `tick=${TICK}`,
    "p=" + rows.map((r) => `${r.key}:${r.p}`).join(","),
  ].join("|");

  return { rows, reason, act };
}

/* 指纹探测的失败只有两种，混在一起就会退回错版 ABI 静默读错：
   CALL_EXCEPTION / BAD_DATA = 这个合约上真没有这个函数 → 可以安全降级；
   其它（超时 / ECONNREFUSED / 限流 / 节点 5xx）= 不知道链上是什么版本 → 抛出去重试。 */
function isMissingFunction(e) {
  const code = (e && e.code) || (e && e.info && e.info.error && e.info.error.code);
  return code === "CALL_EXCEPTION" || code === "BAD_DATA";
}
function netErr(kind, e) {
  const err = new Error(
    `合约版本指纹探测失败（试 ${kind} 的只读函数时出错）：${(e && (e.shortMessage || e.message)) || e}\n` +
    `  这不是「链上没有这个函数」，是 RPC / 网络层面的问题 —— 不敢猜版本，请确认 RPC 可达后重跑（或显式 --v1/--v2/--v3）。`
  );
  err.cause = e;
  return err;
}

/** 选版本：给了 --v1/--v2/--v3 就用它，否则从新到旧问链（v3 entryThresholdOf / v2 thresholdOf / v1 兜底） */
async function pickKind(provider) {
  if (FORCED_KIND) return FORCED_KIND;
  const probe = (kind, fn) => {
    const c = new ethers.Contract(process.env.CONTRACT_ADDRESS, JSON.parse(fs.readFileSync(ABI_BY_KIND[kind], "utf8")), provider);
    return c[fn](24);
  };
  try { await probe("v3", "entryThresholdOf"); return "v3"; } catch (e) { if (!isMissingFunction(e)) throw netErr("v3", e); }
  try { await probe("v2", "thresholdOf"); return "v2"; } catch (e) { if (!isMissingFunction(e)) throw netErr("v2", e); }
  return "v1";
}

(async () => {
  const { rows, reason, act } = plan();
  const reasonHash = ethers.sha256(ethers.toUtf8Bytes(reason));
  const fileHash = ethers.sha256(fs.readFileSync(ACTUARY_FILE));

  console.log(`精算输出 ${ACTUARY_FILE}`);
  console.log(`  数据区间 ${act.meta.start} ~ ${act.meta.end} · 阈值 ${act.meta.threshold}mm · 单笔赔付 ${act.meta.payoutEth} ETH`);
  console.log(`  窗口 ${HOURS}h · 目标赔付率 ${TARGET_LOSS_RATIO.toFixed(2)} · 取整网格 ${TICK} ETH\n`);

  console.log(`${"城市".padEnd(4)}  ${"触发概率".padEnd(10)} ${"应需保费".padEnd(11)} ${"链上保费".padEnd(10)} ${"真实赔付率".padEnd(12)} ${"按旧价0.001".padEnd(12)} 承保动作`);
  for (const r of rows) {
    console.log(
      `${r.name.padEnd(6)}${pct(r.p).padEnd(10)} ${r.need.toFixed(6).padEnd(11)} ${r.premiumEth.padEnd(10)} ` +
      `${pct(r.lossRatio).padEnd(12)} ${pct(r.lossRatioFlat).padEnd(12)} ${r.level ? "RISK_LOADED" : "NORMAL"}`
    );
  }

  console.log(`\n定价依据串（第三方照抄即可复算出同一个 hash）：`);
  console.log(`  ${reason}`);
  console.log(`reasonHash  ${reasonHash}`);
  console.log(`精算输出文件 SHA256（存档用，不写链）  ${fileHash}`);

  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC || "https://ethereum-sepolia-rpc.publicnode.com");
  const net = await provider.getNetwork();
  const kind = await pickKind(provider);
  const abi = JSON.parse(fs.readFileSync(ABI_BY_KIND[kind], "utf8"));
  const c = new ethers.Contract(process.env.CONTRACT_ADDRESS, abi, provider);
  console.log(`\n链 chainId=${net.chainId}  合约 ${process.env.CONTRACT_ADDRESS}  ABI ${kind}`);
  // v2/v3 的保费按 (regionId, hours) 二维定价：hours 传错不会报错，只会读到**另一个窗口的价**，
  // 然后被当成「已经是目标值」跳过，或把错价写成目标价。所以先照链上的 hoursAllowed 校验一遍。
  if (abi.some((x) => x.name === "hoursAllowed")) {
    if (!(await c.hoursAllowed(Number(HOURS)))) {
      const allowed = [];
      for (const h of [12, 24, 48, 72]) if (await c.hoursAllowed(h)) allowed.push(h);
      throw new Error(`--hours=${HOURS} 这个合约版本不接受（hoursAllowed(${HOURS}) = false）。链上合法值：${allowed.join(" / ") || "（一个都读不到，检查 RPC / 地址）"}`);
    }
  }

  // v1: premiumOf(regionId) ｜ v2/v3: premiumOf(regionId, hours)
  const readPremium = (id) => (kind === "v1" ? c.premiumOf(id) : c.premiumOf(id, Number(HOURS)));

  const onchain = [];
  for (const r of rows) {
    const cur = await readPremium(r.id);
    const lvl = await c.riskLevel(r.id);
    onchain.push({ ...r, cur, lvl });
    const same = cur === ethers.parseEther(r.premiumEth) && Number(lvl) === r.level;
    console.log(`  #${r.id} ${r.name}  现值 ${ethers.formatEther(cur)} → ${r.premiumEth}（level ${lvl} → ${r.level}）${same ? "  已是目标值" : ""}`);
  }

  if (!APPLY) { console.log("\n[默认] 只算不算。确认无误后加 --apply 真的发交易。"); return; }

  // E24：写路径先认链、再认主网 —— 与 deploy.js:127-136 / deploy-multisig.js:146-147 同一道闸。
  //   改价是花真 gas 的真交易：RPC 指到一条认不出的链上时，下面「比对过了、写进去了」
  //   全程不报错，等于把价写到了别处；677 是主网，要额外一次显式确认。
  const KNOWN_CHAINS = { 11155111: "Sepolia", 677: "BOT Chain 主网", 968: "BOT Chain 测试网" };
  if (!KNOWN_CHAINS[Number(net.chainId)]) {
    throw new Error(`chainId=${net.chainId} 不是已知的真链（${Object.values(KNOWN_CHAINS).join(" / ")}），拒绝写价`);
  }
  if (Number(net.chainId) === 677 && !ARGV.includes("--yes-mainnet")) {
    throw new Error("主网 677 改真价要加 --yes-mainnet（与 deploy.js 同一道闸，防误发）");
  }
  const sym = Number(net.chainId) === 677 || Number(net.chainId) === 968 ? "BOT" : "SepETH";

  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const wc = new ethers.Contract(process.env.CONTRACT_ADDRESS, abi, wallet);
  console.log(`\n签名账户 ${wallet.address}  余额 ${ethers.formatEther(await provider.getBalance(wallet.address))} ${sym}\n`);
  for (const r of onchain) {
    const want = ethers.parseEther(r.premiumEth);
    if (r.cur === want && Number(r.lvl) === r.level) { console.log(`  #${r.id} ${r.name} 已是目标值，跳过`); continue; }
    const tx = await wc.setUnderwriting(r.id, r.level, want, reasonHash);
    const rc = await tx.wait();
    // E24：写后必须回读断言 —— 「交易发出去 + 打印了哈希」不等于「链上真是这个价」。
    //   回读走只读合约 c（同一 provider，交易已确认）；读回来跟写入目标不一致就直接报错退出，
    //   别让人拿着「看起来成功」的日志去答辩。
    const back = await readPremium(r.id);
    const backLvl = Number(await c.riskLevel(r.id));
    if (back !== want || backLvl !== r.level) {
      throw new Error(`#${r.id} ${r.name} 写入后回读不一致：链上 ${ethers.formatEther(back)} / level ${backLvl}` +
        ` ≠ 目标 ${r.premiumEth} / ${r.level}。不要当成功 —— 先查这笔 tx：${tx.hash}`);
    }
    console.log(`  #${r.id} ${r.name}  ${ethers.formatEther(r.cur)} → ${ethers.formatEther(back)}` +
      `  level ${r.lvl} → ${backLvl}  ↩ 回读一致  tx ${tx.hash}  区块 ${rc.blockNumber}  gas ${rc.gasUsed}`);
  }

  console.log("\n最终链上状态：");
  for (let id = 1; id <= 5; id++) {
    console.log(`  #${id} premiumOf=${ethers.formatEther(await readPremium(id))}  riskLevel=${await c.riskLevel(id)}`);
  }
})().catch((e) => { console.error("💥", e.shortMessage || e.message); process.exit(1); });
