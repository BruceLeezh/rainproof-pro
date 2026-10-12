#!/usr/bin/env node
/**
 * rehearse-v2 —— 在 BOT Chain 测试网(968) 上把 v2 合约完整跑一遍
 * ============================================================================
 *
 * 【为什么要有这个脚本】
 *   "部署成功" 只证明地址上有字节码，不证明 A1–A9 那九项改动能在真链上跑。
 *   这个脚本按 v2 的语义走一条完整动线，每一步都从链上读回来断言：
 *
 *     ① A1 保费网格（区域 × 24/48/72）+ 地板          → premiumOf(region, hours)
 *     ② A4 冷静期（生产 3 天 / 演示设 0）              → policyStatus("pending" / "active")
 *     ③ A7 分档赔付（国标三级，纯链上）                → tierOf / tierBps / 池子支出
 *     ④ A5 sources 上链                               → judgements(id).sources
 *     ⑤ A6 敞口账本 + A3 限购                          → pendingExposureOf / reserveOf / 闸门文案
 *     ⑥ 第三方可代为触发赔付（claim 无权限修饰器）      → operator 调 claim，钱进骑手
 *
 * 【口径来源】保费不是手填：p 来自 `10-金融与定价/actuary-output.json`（B 产出），
 *   公式 `建议保费 = 上整到 0.0001( p × 赔付额 ÷ 目标赔付率 0.60 )`，且不低于合约地板。
 *
 * 【骑手地址每次运行都是新的 —— 这是 A3 的必然结果】
 *   `MAX_POLICIES_PER_RIDER` 是**终身计数**（`_byRider` 只增不减），同一个地址跑第二遍就会被
 *   `too many policies` 拦住。所以脚本默认 `ethers.Wallet.createRandom()` 现场造一个新骑手，
 *   由 operator 转 0.05 BOT 给它。
 *   ⚠️ 演示同理：每场演示要用**新地址**（或用 `--rider=<私钥>` 指定一个还有名额的地址）。
 *
 * 【用法】必须在 04-脚本 目录下跑（否则读不到 .env）
 *   node rehearse-v2.js            # 只读体检（默认，安全）——RPC 取 BOT_RPC/V2_RPC，缺省 https://rpc.bohr.life
 *   node rehearse-v2.js --apply    # 真的发交易
 *   可选：--rider=<私钥> 固定骑手   /   --use-env-rider 用 .env 的 RIDER_KEY   /   --any-chain 不在 968 上也跑
 *   合约地址可用 $env:V2_ADDRESS 覆盖 .env 里的 CONTRACT_ADDRESS
 *
 * 【环境变量】.env：CONTRACT_ADDRESS / PRIVATE_KEY / RIDER_KEY；RPC 用 BOT_RPC（或 V2_RPC）
 *   ⚠️ 本脚本**不读** `SEPOLIA_RPC`。那个变量名是全局历史包袱（deploy / push / keeper / hook 都共用它，
 *   值填「当前目标链」），而 `.env.example` 里它指的恰恰是 Sepolia。v2 合约在 **BOT Chain 测试网 968**，
 *   照抄 .env 会连到 Sepolia → 地址上没有合约 → 深处报 `missing revert data`（exit 2），
 *   症状和「合约没这个函数」一模一样，极难查。所以这里只认 BOT_RPC / V2_RPC，并对 chainId 与合约代码做前置检查。
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { REGIONS } = require("./regions");

const ROOT = path.join(__dirname, "..");
const ABI_FILE = path.join(ROOT, "03-合约", "RainDeliveryInsuranceV2.abi.json");
const ACTUARY_FILE = path.join(ROOT, "10-金融与定价", "actuary-output.json");

const ARGV = process.argv.slice(2);
const APPLY = ARGV.includes("--apply");
const RIDER_ARG = (ARGV.find((a) => a.startsWith("--rider=")) || "").slice("--rider=".length);
const TARGET_LOSS_RATIO = 0.6;
const TICK = 0.0001;
const POOL_TOPUP = ethers.parseEther("0.1");    // 池子目标：够赔 10 笔满额
const RIDER_GAS = ethers.parseEther("0.05");    // 每笔投保约 34 万 gas，多给点免得半途没油

const WINDOWS = [24, 48, 72];
const DECISION_PAY = 1;

const pct = (x) => (x * 100).toFixed(3) + "%";
const ceilTick = (raw) => Math.ceil(raw / TICK - 1e-9) * TICK;
const eth = (w) => ethers.formatEther(w);

/** 直接发一次 JSON-RPC（用全局 fetch，因此会走 NODE_USE_ENV_PROXY 设的代理），带重试 */
async function rpcCall(url, method, params = [], tries = 8) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const j = await r.json();
      if (j.result !== undefined) return j.result;
      last = new Error(JSON.stringify(j.error || j));
    } catch (e) { last = e; }
    await new Promise((r) => setTimeout(r, 700 * (i + 1)));
  }
  throw last;
}

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };
const eq = (label, got, want) => {
  const g = typeof got === "bigint" ? got.toString() : String(got);
  const w = typeof want === "bigint" ? want.toString() : String(want);
  g === w ? ok(`${label} = ${g}`) : bad(`${label} = ${g}（期望 ${w}）`);
};

/** 保费网格计划：5 城 × 24/48/72，用 B 的 p 算，再按合约地板抬起 */
function planGrid(act) {
  const payoutEth = act.meta.payoutEth;
  const rows = [];
  for (const h of WINDOWS) {
    for (const r of REGIONS) {
      const p = act.regions[r.key].windows[String(h)].p;
      const need = (p * payoutEth) / TARGET_LOSS_RATIO;
      const premium = Math.max(ceilTick(need), 0.0002);
      const reason = [
        "rainproof/underwriting@2",
        "source=10-金融与定价/actuary-output.json",
        `window=${h}h`,
        `thresholdMm=${act.meta.threshold}`,
        `payout=${payoutEth}`,
        `targetLossRatio=${TARGET_LOSS_RATIO.toFixed(2)}`,
        `tick=${TICK}`,
        "p=" + REGIONS.map((x) => `${x.key}:${act.regions[x.key].windows[String(h)].p}`).join(","),
      ].join("|");
      rows.push({
        id: r.id, key: r.key, name: r.name, hours: h, p, need, premium,
        clamped: ceilTick(need) < 0.0002,
        level: p > 0.1 ? 1 : 0,
        reasonHash: ethers.sha256(ethers.toUtf8Bytes(reason)),
      });
    }
  }
  return rows;
}

(async () => {
  if (!fs.existsSync(ABI_FILE)) throw new Error(`缺少 v2 ABI：${ABI_FILE}（先 npm run compile:v2）`);
  const ABI = JSON.parse(fs.readFileSync(ABI_FILE, "utf8"));
  const act = JSON.parse(fs.readFileSync(ACTUARY_FILE, "utf8"));
  // ★ 不读 SEPOLIA_RPC（见文件头）：v2 合约在 968，.env.example 教的 SEPOLIA_RPC 是 Sepolia，
  //   照抄就会连错链。要换链请显式给 BOT_RPC / V2_RPC；本地 ganache 副本加 --any-chain。
  const url = process.env.BOT_RPC || process.env.V2_RPC || "https://rpc.bohr.life";
  const addr = process.env.V2_ADDRESS || process.env.CONTRACT_ADDRESS;
  if (!addr) {
    throw new Error("没给合约地址：在 04-脚本/.env 里填 CONTRACT_ADDRESS（968 的 v2 地址），" +
      "或临时 $env:V2_ADDRESS='0x…'（演示基线：0x89e7C942535930B61cB61631051E8b0bD670596a）");
  }

  // BOT Chain 的 RPC 本机得走系统代理（127.0.0.1:7890）：node 需要
  //   $env:NODE_USE_ENV_PROXY='1'; $env:HTTPS_PROXY='http://127.0.0.1:7890'
  // 而且必须先自己问出 chainId 再建 provider —— JsonRpcProvider 的"自动探测网络"这条路
  // 走的是没被重试包装保护的内部请求，代理偶发掉线时第一步就炸。
  const chainId = Number(await rpcCall(url, "eth_chainId"));
  // ★ 跑错链要当场喊停，而不是让它烂在合约调用里（原来就是后者：exit 2 + missing revert data）
  const ALLOW_ANY_CHAIN = ARGV.includes("--any-chain") || process.env.V2_ALLOW_ANY_CHAIN === "1";
  if (chainId !== 968 && !ALLOW_ANY_CHAIN) {
    throw new Error(
      `这个脚本跑的是 BOT Chain 测试网（chainId 968）—— v2 合约部署在那里；` +
      `当前 RPC（${url}）自己报的是 chainId=${chainId}。\n` +
      `  968：$env:BOT_RPC='https://rpc.bohr.life'（或 $env:V2_RPC=<任意 968 RPC>）\n` +
      `  真要在别的链上跑（例如本地 ganache 上的 v2 副本）：加 --any-chain`
    );
  }
  const provider = new ethers.JsonRpcProvider(url, { chainId, name: `chain-${chainId}` }, { staticNetwork: true });
  // 每次 RPC 调用再重试 6 次（只读与发送都安全：重试的是 RPC 请求本身，不是"重发交易"——
  // 广播与否由 ethers 自己决定）。
  const rpcSend = provider.send.bind(provider);
  provider.send = async (method, params) => {
    let last;
    for (let i = 0; i < 6; i++) {
      try { return await rpcSend(method, params); }
      catch (e) {
        last = e;
        if (i === 5) break;
        const wait = 800 * (i + 1);
        console.log(`    … RPC ${method} 第 ${i + 1} 次失败（${e.shortMessage || e.message}），${wait}ms 后重试`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    throw last;
  };
  const net = await provider.getNetwork();
  // ★ 地址与 RPC 必须同链：968 的合约地址 + Sepolia 的 RPC = 这个地址上没有代码，
  //   再往下第一个 ro.xxx() 就抛 `missing revert data`。—— 与其让人猜，不如这里直说。
  const code0 = await provider.getCode(addr);
  if (code0 === "0x" || code0 === "0x0") {
    throw new Error(
      `地址 ${addr} 在 chainId=${chainId}（RPC ${url}）上没有合约代码 —— 地址和 RPC 不是同一条链？\n` +
      `  演示基线：chainId 968 · RPC https://rpc.bohr.life · v2 合约 0x89e7C942535930B61cB61631051E8b0bD670596a\n` +
      `  若 .env 里的 CONTRACT_ADDRESS 是 968 的地址，就把 RPC 也指到 968（$env:BOT_RPC='https://rpc.bohr.life'）。`
    );
  }
  const ro = new ethers.Contract(addr, ABI, provider);

  console.log("=".repeat(74));
  console.log(`v2 真链彩排  RPC ${url}  chainId=${net.chainId}  区块 ${await provider.getBlockNumber()}`);
  console.log(`合约 ${addr}  代码长度 ${code0.length / 2 - 1} 字节`);
  console.log("=".repeat(74));

  // ---------- [0] 只读体检（不需要 --apply） ----------
  console.log("\n[0] 只读体检");
  const code = code0;
  code.length > 2 ? ok(`链上有字节码 ${(code.length - 2) / 2} 字节`) : bad("这个地址没有合约代码");
  // operator 是「谁能改承保参数」，只有拿到期望值才谈得上断言。
  // 原来是 `eq("operator", await ro.operator(), process.env.V2_OPERATOR || (await ro.operator()))`：
  // 右边没设环境变量时又读了一次同一个链上值，左右必然相等 —— 一条永远绿的假断言，
  // 正好盖住「operator 被转给了别人」这种最该报警的事。
  const wantOperator = process.env.V2_OPERATOR;
  if (wantOperator) {
    eq("operator", String(await ro.operator()).toLowerCase(), wantOperator.toLowerCase());
  } else {
    console.log(`  ◻️ [SKIP] operator = ${await ro.operator()}（未设 V2_OPERATOR，没有可比对的目标，不计入通过数）`);
  }
  eq("PAYOUT_MAX", eth(await ro.PAYOUT_MAX()), "0.01");
  eq("MIN_PREMIUM", eth(await ro.MIN_PREMIUM()), "0.0002");
  // 真读链：这一行原来两边都是脚本自拼的 —— `[24,48,72].map(h => String((50*h)/24)).join("/")`
  // 对 "50/100/150"，等于断言「脚本里的公式 = 脚本里的常数」，链上换成 60/110/160 也照样绿。
  eq("thresholdOf(24/48/72)（真读链）",
    (await Promise.all([24, 48, 72].map((h) => ro.thresholdOf(h)))).map(String).join("/"), "50/100/150");
  eq("tierBps(0/1/2)", `${await ro.tierBps(0)}/${await ro.tierBps(1)}/${await ro.tierBps(2)}`, "5000/7500/10000");
  eq("MAX_FEED_AGE（秒）", await ro.MAX_FEED_AGE(), 86400);
  eq("MAX_POLICIES_PER_RIDER", await ro.MAX_POLICIES_PER_RIDER(), 3);
  eq("MAX_OPEN_EXPOSURE_PER_RIDER", eth(await ro.MAX_OPEN_EXPOSURE_PER_RIDER()), "0.02");
  eq("eligibleRequired（默认关）", await ro.eligibleRequired(), false);

  // ---------- [1] 网格计划 ----------
  const grid = planGrid(act);
  console.log("\n[1] 保费网格计划（p 来自 actuary-output.json，p×赔付÷0.60 上整 0.0001，不低于地板 0.0002）");
  console.log("    城市      档位   触发概率p   应需保费    链上保费   说明");
  for (const g of grid) {
    console.log(`    ${g.name.padEnd(8)}${String(g.hours).padStart(2)}h   ${pct(g.p).padEnd(10)} ${g.need.toFixed(6).padEnd(11)} ${g.premium.toFixed(4).padEnd(10)} ${g.clamped ? "👈 触发地板（短窗口收不回 gas）" : ""}`);
  }
  console.log(`    （${grid.filter((g) => g.clamped).length}/15 档低于地板被抬起 —— 地板是定价下限，不是精算结果）`);

  if (!APPLY) {
    console.log("\n[默认] 只算不发。确认无误后加 --apply 真的发交易。");
    console.log(`通过 ${pass} / 失败 ${fail}`);
    process.exit(fail ? 1 : 0);
  }

  // ---------- 签名侧 ----------
  const op = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const c = new ethers.Contract(addr, ABI, op);
  const send = async (label, p) => {
    const tx = await p;
    const r = await tx.wait();
    console.log(`    ▸ ${label}\n        tx ${tx.hash}  区块 ${r.blockNumber}  gas ${r.gasUsed}`);
    return r;
  };
  /** 每次调用造一个全新骑手（A3 笔数上限是终身计数，旧地址会立刻被拦） */
  const freshRider = async (label) => {
    const w = RIDER_ARG ? new ethers.Wallet(RIDER_ARG, provider)
      : (ARGV.includes("--use-env-rider") && process.env.RIDER_KEY) ? new ethers.Wallet(process.env.RIDER_KEY, provider)
        : ethers.Wallet.createRandom().connect(provider);
    const b = await provider.getBalance(w.address);
    if (b < ethers.parseEther("0.02")) await send(`${label} 转 ${eth(RIDER_GAS)} BOT（${w.address}）`, op.sendTransaction({ to: w.address, value: RIDER_GAS }));
    return { w, c: new ethers.Contract(addr, ABI, w), addr: w.address };
  };

  console.log(`\noperator = ${op.address}  余额 ${eth(await provider.getBalance(op.address))} BOT`);

  // ---------- [2] A1 网格 + 区域档位 ----------
  console.log("\n[2] A1：写 15 格保费网格 + 5 个区域档位（已写过的跳过）");
  for (const g of grid) {
    const want = ethers.parseEther(g.premium.toFixed(4));
    if ((await ro.premiumOf(g.id, g.hours)) === want) continue;
    await send(`setPremiumGrid(${g.id} ${g.name} ${g.hours}h = ${g.premium.toFixed(4)})`, c.setPremiumGrid(g.id, g.hours, want, g.reasonHash));
  }
  for (const r of REGIONS) {
    const g = grid.find((x) => x.id === r.id && x.hours === 72);
    await send(`setUnderwriting(${r.id} ${r.name} level ${g.level} 参考价 ${g.premium.toFixed(4)})`, c.setUnderwriting(r.id, g.level, ethers.parseEther(g.premium.toFixed(4)), g.reasonHash));
  }
  console.log("    链上回读（网格优先于区域档位 —— A1 的优先级）");
  for (const r of REGIONS) {
    const row = [];
    for (const h of WINDOWS) row.push(`${h}h=${eth(await ro.premiumOf(r.id, h))}`);
    console.log(`      #${r.id} ${r.name}  ${row.join("  ")}`);
  }
  eq(`premiumOf(1,72) == 精算式`, eth(await ro.premiumOf(1, 72)), grid.find((g) => g.id === 1 && g.hours === 72).premium.toFixed(4));

  // ---------- [3] A4 冷静期 ----------
  console.log("\n[3] A4 冷静期");
  const cool = await ro.coolingPeriod();
  console.log(`    当前 coolingPeriod = ${cool} 秒（${Number(cool) / 86400} 天）`);
  if (cool !== 0n) await send("setCoolingPeriod(0)（演示必须设 0，否则现场买的保单停在 pending）", c.setCoolingPeriod(0));
  eq("coolingPeriod == 0", await ro.coolingPeriod(), 0);

  // ---------- [4] 资金池 ----------
  console.log("\n[4] 资金池");
  const pool0 = await provider.getBalance(addr);
  console.log(`    当前池子 ${eth(pool0)} BOT`);
  if (pool0 < ethers.parseEther("0.03")) await send(`fundPool(${eth(POOL_TOPUP)})`, c.fundPool({ value: POOL_TOPUP }));
  console.log(`    池子 = ${eth(await provider.getBalance(addr))} BOT`);

  // ---------- [5] 喂价（单调不减） ----------
  console.log("\n[5] 喂价（A4b 的新鲜度基准）");
  const MM = { 1: 24, 2: 34, 3: 0, 4: 50, 5: 120 };
  for (const r of REGIONS) {
    const cur = Number(await ro.rainfall(r.id));
    const target = Math.max(cur, MM[r.id]);
    if (target === cur) { console.log(`    · ${r.name} 已是 ${cur}mm，跳过`); continue; }
    await send(`updateRainfall(${r.id} ${r.name} → ${target}mm, conf 88, sources 3)`,
      c.updateRainfall(r.id, target, ethers.keccak256(ethers.toUtf8Bytes(`bot-rehearsal/${r.key}/${target}`)), 88, 3));
  }

  // ---------- [6] 窗口闸门 ----------
  const r1 = await freshRider("骑手1");
  console.log(`\n[6] 窗口闸门：非 24/48/72 必须被拒（A4b 的"喂价超 24h"分支真链上没法构造，由本地 e2e_v2.js 覆盖）`);
  let msg = "";
  try { await r1.c.buyPolicy.staticCall(1, 6, { value: await ro.premiumOf(1, 24) }); msg = "（没有 revert）"; }
  catch (e) { msg = e.shortMessage || e.message; }
  /hours must be 24\/48\/72/.test(msg) ? ok(`非三档窗口被拒：${msg}`) : bad(`非三档窗口未被拒：${msg}`);

  // ---------- [7] 完整动线（A7 分档赔付 + A5 sources + 第三方触发赔付） ----------
  console.log(`\n[7] 完整动线（骑手 ${r1.addr}）：买广州 24h → 投保后 +50mm → AI 判定 → operator 代为赔付`);
  const prem = await ro.premiumOf(4, 24);
  const before7 = await provider.getBalance(r1.addr);
  await send(`rider buyPolicy(4, 24) 付 ${eth(prem)} BOT`, r1.c.buyPolicy(4, 24, { value: prem }));
  const id = Number(await ro.nextPolicyId()) - 1;
  eq(`policyStatus(#${id})（冷静期已 0）`, await ro.policyStatus(id), "active");

  const gzBase = Number(await ro.rainfall(4));
  await send(`updateRainfall(4 广州 → ${gzBase + 50}mm，投保后 +50mm)`,
    c.updateRainfall(4, gzBase + 50, ethers.keccak256(ethers.toUtf8Bytes(`bot-rehearsal/guangzhou/+50/${gzBase + 50}`)), 90, 3));
  eq(`currentTier(#${id}) == 暴雨档`, await ro.currentTier(id), 0);
  const wantPayout = (await ro.PAYOUT_MAX()) / 2n;
  eq(`payoutOf(#${id}) 实时报价（赔付前就知道金额）`, await ro.payoutOf(id), wantPayout);
  eq(`policyStatus(#${id})`, await ro.policyStatus(id), "pending_judgement");

  await send(`submitJudgement(#${id}, PAY, conf 90, sources 3)`,
    c.submitJudgement(id, DECISION_PAY, 90, 3, ethers.keccak256(ethers.toUtf8Bytes(`input/${id}`)), ethers.keccak256(ethers.toUtf8Bytes(`output/${id}`)), "bot-rehearsal-v1"));
  eq(`judgements(#${id}).sources（A5 上链）`, (await ro.judgements(id))[3], 3);
  eq(`policyStatus(#${id})`, await ro.policyStatus(id), "claimable");

  const poolBefore = await provider.getBalance(addr);
  await send(`operator 代为触发 claim(#${id})（claim 无权限修饰器）`, c.claim(id));
  const poolDelta = poolBefore - (await provider.getBalance(addr));
  const riderNet = (await provider.getBalance(r1.addr)) - before7 + prem;
  poolDelta === wantPayout
    ? ok(`A7 分档赔付落地：池子支出 ${eth(poolDelta)} BOT = PAYOUT_MAX 的 50%（暴雨档）`)
    : bad(`池子支出 ${eth(poolDelta)} BOT，期望 0.005`);
  console.log(`    骑手那份账：赔付 0.005 − 它自付的 gas ≈ ${eth(riderNet)} BOT（gas 由骑手承担，赔付额不缩水）`);
  eq(`policyStatus(#${id})`, await ro.policyStatus(id), "paid");
  eq(`赔付后 pendingExposureOf 归零`, await ro.pendingExposureOf(r1.addr), 0n);

  // ---------- [8] A6 敞口账本 + A3 限购（用第二个全新骑手） ----------
  const r2 = await freshRider("骑手2");
  console.log(`\n[8] A6 敞口账本 + A3 限购（骑手 ${r2.addr}）`);
  const prem4 = await ro.premiumOf(4, 24);
  await send(`在保第 1 笔（24h 广州）`, r2.c.buyPolicy(4, 24, { value: prem4 }));
  const expo1 = await ro.pendingExposureOf(r2.addr);
  console.log(`    pendingExposureOf = ${eth(expo1)} BOT（1 笔在保 × 满额 ${eth(await ro.PAYOUT_MAX())}）`);
  await send(`在保第 2 笔（24h 广州）`, r2.c.buyPolicy(4, 24, { value: prem4 }));
  const expo2 = await ro.pendingExposureOf(r2.addr);
  eq("3 笔在保敞口到顶（2 笔）", expo2, await ro.MAX_OPEN_EXPOSURE_PER_RIDER());
  const res = await ro.reserveOf();
  res >= expo2 ? ok(`reserveOf() = ${eth(res)} BOT ≥ 在保敞口（A6：准备金跟着抬）`) : bad(`reserveOf ${eth(res)} < 敞口 ${eth(expo2)}`);
  let m2 = "";
  try { await r2.c.buyPolicy.staticCall(4, 24, { value: prem4 }); m2 = "（没有 revert）"; }
  catch (e) { m2 = e.shortMessage || e.message; }
  /open exposure cap exceeded/.test(m2) ? ok(`在保第 3 笔被敞口闸门拦下：${m2}`) : bad(`在保第 3 笔未被敞口闸门拦下：${m2}`);
  console.log(`    注：笔数闸门 MAX_POLICIES_PER_RIDER=${await ro.MAX_POLICIES_PER_RIDER()} 是终身计数，`);
  console.log(`        第 4 笔会先撞它（too many policies）—— 两条闸门在不同条件下各守一层。`);

  console.log("\n" + "=".repeat(74));
  console.log(`v2 真链彩排结束：通过 ${pass} / 失败 ${fail}`);
  console.log(`合约 ${addr}  chainId ${net.chainId}  池子 ${eth(await provider.getBalance(addr))} BOT`);
  console.log("=".repeat(74));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("💥", e.shortMessage || e.message); process.exit(2); });
