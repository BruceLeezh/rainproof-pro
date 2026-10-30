#!/usr/bin/env node
/**
 * keeper —— 理赔触发者 + 到期敞口结算
 *
 * 合约里 `claim()` 没有权限修饰符（谁都可能帮骑手把赔款领出来），这是**有意设计**：
 * 理赔不该依赖某一家运营方在线。但"谁都能做"不等于"一定有人做"，
 * 所以补一个诚实的小 keeper：轮询链上状态，发现 claimable 的保单就替骑手领掉。
 *
 * ★ 它**不是**合约里的自动机制 —— 合约没有任何定时器，赔付与结算都由外部交易触发。
 *   对外只能说：「判定与结算由 operator 的两条脚本触发；`claim()` 无权限，任何人都能替骑手把钱领出来。」
 *
 * 用法（必须在 04-脚本 目录下跑，否则读不到 .env）：
 *   node keeper.js --once        扫一遍，赔掉所有 claimable 的保单，然后退出
 *   node keeper.js               常驻，默认每 30 分钟扫一遍
 *   node keeper.js --dry-run     只看不动手（扫一遍后退出）
 *   node keeper.js --settle      额外把「已到期未赔」的保单结算掉，回收在保敞口
 *                                （v2 的 `settleExpired` 是 onlyOperator，要 operator 私钥；
 *                                  v3 已经把这个修饰符去掉 —— 结算只减少敞口、不产生付款，
 *                                  谁调都安全，所以 v3 上任何钥匙都能跑）
 *   node keeper.js --interval=1800  改轮询间隔（秒）；默认 1800 = 30 分钟一轮，与全仓轮询口径一致
 *
 * 环境变量（.env）：SEPOLIA_RPC / CONTRACT_ADDRESS / PRIVATE_KEY；
 * 可选 KEEPER_KEY —— 单独给 keeper 一把钥匙。不给就用 PRIVATE_KEY。
 * keeper 领赔款不需要任何权限，用哪把钥匙都一样；**v2 上 --settle 才需要 operator 那把，v3 不需要**。
 *
 * 合约版本：v2（03-合约/RainDeliveryInsuranceV2.abi.json）。
 *   v1 的 payout 是全局常量 `PAYOUT`，v2 按国标档位算，逐单读 `payoutOf(id)`。
 *   v2 新增长期约束：`claim()` 要求 `block.timestamp <= endTime` —— **过期就再也赔不了**，
 *   所以「雨量已达标但还没判定」的保单，必须在到期前补判定，否则只能被 settleExpired 结算掉。
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { JsonRpcProvider, Wallet, Contract, formatEther } = require("ethers");

// 默认 v2 —— 那是 968 上留下的演示基线。**主网 677 现在跑的是 v3**（2026-10-08 部署），
// 对 677 要加 --v3 读 v3 的 ABI（v3 把阈值/赔付档改成国标两档，keeper 只用
// nextPolicyId / policyStatus / payoutOf / claim / settleExpired，两版都有）。
const ACTIVE = require("./active-deployment").applyDeployment();
const ARGV = process.argv.slice(2);
let VARIANT = ["V2", "V3", "V4", "V5", "V6"].find((v) => ARGV.includes(`--${v.toLowerCase()}`)) || (ACTIVE.version === "V6" ? "V6" : "V2");
// ★ 只认 v2/v3/v4/v5 四个已知版本：原来只判 v5/v3，敲 `--v4` 会静默落到 V2 ——
//   而 v2 的 policies() 是 15 字段、v4/v5 是 16 字段，解出来整体错位，页面不报错只报假数。
const KNOWN = ["V2", "V3", "V4", "V5", "V6"];
{
  const bad = ARGV.filter((a) => /^--v\d+$/.test(a) && !KNOWN.includes(a.slice(2).toUpperCase()));
  if (bad.length) {
    throw new Error(`${bad.join(", ")} 不是已知合约版本（只支持 --v2/--v3/--v4/--v5/--v6）。` +
      `静默落到 v2 会因字段数不同把 policies() 解错，宁可直接报错。`);
  }
}
const ABI_FILE = path.join(__dirname, "..", "03-合约", `RainDeliveryInsurance${VARIANT}.abi.json`);
const ONCE = ARGV.includes("--once");
const DRY = ARGV.includes("--dry-run");
const SETTLE = ARGV.includes("--settle");
// settleExpired 只有 v2 带 onlyOperator（v3/v4/v5 都没有）。写成「只有 v2 要」比
// 「不是 v3 就要」安全：后者会把 v4/v5 也拦下来。
const needsOperatorSettle = () => VARIANT === "V2";
const INTERVAL = (() => {
  const raw = (ARGV.find((a) => a.startsWith("--interval=")) || "").split("=")[1];
  if (raw === undefined) return 1800;   // 30 分钟：与计划任务 RainProof-Feed 的 PT30M 同口径
  const n = Number(raw);
  // A20：`Number("abc")` 是 NaN，`setTimeout(fn, NaN*1000)` 等于「立刻再来一次」——
  // 一个手滑的 --interval=abc 会把常驻模式变成对 RPC 的死循环扫射。非法值直接报错。
  if (!Number.isFinite(n) || n <= 0) throw new Error(`--interval= 需要一个正数秒，收到：${JSON.stringify(raw)}`);
  return n;
})();

const ts = () => new Date().toTimeString().slice(0, 8);

// BOT Chain（主网 677 / 测试网 968）的原生代币叫 BOT，不是 ETH —— 口径与
// deploy.js:149 / check-chain.js:42 一致（那里已按 chainId 取符号）。启动时按 chainId 定，
// scan() 里打印池子/赔付额时跟着它走，别再写死 "ETH"。
let SYM = "SepETH";
// ★ v5 起合约内金额单位是「分」（RDROP decimals=2，1 单位 = 1 元），不是 wei。
//   原来这里一律 formatEther()：495840 分被印成 0.00000000000049584 BOT，
//   而且 pool 用 provider.getBalance()（原生币余额 0）去比「分」→ 第一张就 break，一笔都赔不出去。
const CENTS = () => ["V4", "V5", "V6"].includes(VARIANT);
const yuan = (v) => (Number(v) / 100).toFixed(2);
/** 金额 → 人看的字符串：v5 按「分」，旧版按 wei */
const fmt = (v) => (CENTS() ? `${yuan(v)} 元` : `${formatEther(v)} ${SYM}`);
/** 池子读数：v5 读合约内 poolBalance()（分），旧版读链上原生币余额（wei） */
const readPool = async (c, provider) => (CENTS() ? c.poolBalance() : provider.getBalance(await c.getAddress()));

async function scan(c, provider, dry, doSettle) {
  // 本轮失败的操作数（结算 / 赔付）。>0 就在函数尾把退出码置 1：
  // 原来「一笔都没赔成」也退 0，--once / CI 里和「本无事发生」长得一模一样。
  let failed = 0;
  const n = Number(await c.nextPolicyId());
  if (!n) { console.log(`[${ts()}] 链上还没有任何保单`); return 0; }

  const paused = await c.paused();
  if (paused) { console.log(`[${ts()}] ⏸ 合约已暂停，跳过`); return 0; }

  const statuses = [];
  for (let id = 0; id < n; id++) statuses.push(await c.policyStatus(id));

  // ---- 到期未赔 → 结算敞口（A6；只对 block.timestamp > endTime 且未赔未结算的生效）----
  if (doSettle) {
    let expired = statuses.map((st, id) => (st === "expired" ? id : -1)).filter((id) => id >= 0);
    if (VARIANT === "V6") {
      const block = await provider.getBlock("latest"), grace = await c.CLAIM_GRACE();
      const due = [];
      for (const id of expired) if (BigInt(block.timestamp) > (await c.policies(id)).endTime + grace) due.push(id);
      expired = due; // V6 must retain exposure until the grace window ends.
    }
    if (!expired.length) {
      console.log(`[${ts()}] 没有到期未赔的保单，无需结算`);
    } else {
      // E5：结算前先查「已判定该赔、只是没被领」的单 —— 但**不跳过**它们，只把损失喊出来。
      //   理由（对着合约核过）：claim() 要求 block.timestamp <= endTime
      //   （V3.sol:447 "policy expired" / V2.sol:336），settleExpired 要求 block.timestamp > endTime
      //   （V3.sol:493），而 policyStatus 只在 > endTime 时才回 "expired"（V3.sol:694）——
      //   两个集合不相交，结算**不可能**销毁一张还能领的保单。反过来「payoutOf > 0 就跳过结算」
      //   会永久漏掉敞口了结：openExposure 只涨不落、openPoliciesOf[rider] 不减，
      //   该骑手此后买不了新单（MAX_POLICIES_PER_RIDER）。钱是在过了 endTime 那一刻丢的
      //   （claim 的到期硬闸），不是被这一步结算掉的 —— 所以这里只报告，让人看得见。
      const lost = [];
      for (const id of expired) {
        const amt = await c.payoutOf(id);
        const judgement = await c.judgements(id);
        if (amt > 0n && judgement.exists && Number(judgement.decision) === 1 && Number(judgement.confidence) >= 60) lost.push(`#${id}(${fmt(amt)})`);
      }
      if (lost.length) {
        console.log(`[${ts()}] ⚠️ ${lost.length} 张到期单已判定该赔却没人领，claim 已过期不可用（钱赔不出去了，结算只了结敞口）：${lost.join(" ")}`);
      }
      if (dry) {
        console.log(`[${ts()}] [dry-run] 到期未赔 ${expired.length} 张可结算：#${expired.join(" #")}`);
      } else {
        try {
          const tx = await c.settleExpired(expired);
          const rc = await tx.wait();
          console.log(`[${ts()}] 🧾 结算到期保单 ${expired.length} 张（#${expired.join(" #")}）` +
                      ` · 未了结敞口回到 ${fmt(await c.openExposure())}  tx ${tx.hash}  区块 ${rc.blockNumber}`);
        } catch (e) {
          // 整批里只要有一张不满足条件就整笔 revert —— 退化成逐张，别让一张坏单挡住其余
          console.log(`[${ts()}] ⚠ 批量结算失败（${e.shortMessage || e.message}），改为逐张重试`);
          for (const id of expired) {
            try {
              const tx = await c.settleExpired([id]);
              await tx.wait();
              console.log(`[${ts()}] 🧾 保单 #${id} 已结算  tx ${tx.hash}`);
            } catch (e2) {
              failed++;
              console.log(`[${ts()}] ❌ 保单 #${id} 结算失败：${e2.shortMessage || e2.message}`);
            }
          }
        }
      }
    }
  }

  // ---- 可赔 → 替骑手领（逐单读 payoutOf，v2 不再有全局 PAYOUT）----
  let paid = 0;
  const pending = [];
  for (let id = 0; id < n; id++) {
    const st = statuses[id];
    if (st !== "claimable") { if (st !== "paid") pending.push(`#${id}:${st}`); continue; }
    const amount = await c.payoutOf(id);
    // A16：`policyStatus()` 的「够不够阈值」那一半用的是**当前**读数，而 `claim()` 用的是
    // **判定当时**钉在链上的快照（合约里的 _readingFor）—— 判定之后又推过雨量时，状态会说
    // claimable、`payoutOf()` 却是 0、`claim()` 必 revert below threshold。
    // 所以以 payoutOf() > 0 为准（它与 claim() 同源），别让 keeper 每轮都去撞一次 revert。
    if (amount === 0n) {
      console.log(`[${ts()}] 保单 #${id} 状态说 claimable，但按判定快照未达档（payoutOf = 0）—— 合约 policyStatus 的读数口径差异，跳过`);
      pending.push(`#${id}:judgement-below-threshold`);
      continue;
    }
    // A19：池子余额必须在每次真赔之前重读 —— 原来在循环外只读一次，同一轮里前面几张单子
    // 赔掉的钱不会反映到后面几张上，可能把已经赔不起的单子也发出去。
    // ★ v5 的池子是合约内 poolBalance()（单位＝「分」），不是原生币余额 ——
    //   用 provider.getBalance() 会读到 BOT 余额 0，于是第一张就 break、一笔都赔不出去。
    const pool = await readPool(c, provider);
    if (pool < amount) {
      console.log(`[${ts()}] 保单 #${id} 可赔，但池子只剩 ${fmt(pool)} < ${fmt(amount)}，停手`);
      break;
    }
    if (dry) { console.log(`[${ts()}] [dry-run] 保单 #${id} 可赔 ${fmt(amount)} —— 真跑的话现在就 claim()`); paid++; continue; }
    try {
      const tx = await c.claim(id);
      const rc = await tx.wait();
      console.log(`[${ts()}] ✅ 保单 #${id} 已赔付 ${fmt(amount)}  tx ${tx.hash}  区块 ${rc.blockNumber}  gas ${rc.gasUsed}`);
      paid++;
    } catch (e) {
      failed++;
      console.log(`[${ts()}] ❌ 保单 #${id} 赔付失败：${e.shortMessage || e.message}`);
    }
  }
  console.log(`[${ts()}] 扫了 ${n} 张保单，本轮赔付 ${paid} 张${failed ? `，失败 ${failed} 笔` : ""}${pending.length ? `；未可赔：${pending.join(" ")}` : ""}`);
  if (failed) {
    console.log(`[${ts()}] ⚠ ${failed} 笔操作失败 ⇒ 退出码置 1（成功路径不变）`);
    process.exitCode = 1;
  }
  return paid;
}

// `--once` 只被计划任务调用。网络抖一下不该把整次运行记成失败：2026-10-29 09:43 就是一句
// `getaddrinfo ENOTFOUND rpc.bohr.life` 把 RainProof-Keeper-V6 打成了 0x1。先原地重试一次
// （够盖住秒级 DNS 抖动）；仍失败且属传输层错误 → 记警告并按成功返回，30 分钟后的下一轮就是
// 天然重试，且 V6 有 7 天领取宽限，漏一两轮不会让人领不到钱。非传输层错误照常抛。
const TRANSIENT_NET = /ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ECONNABORTED|EPIPE|ETIMEDOUT|TIMEOUT|SERVER_ERROR|NETWORK_ERROR|fetch failed|socket hang up/i;
const isTransient = (e) => TRANSIENT_NET.test(`${(e && e.code) || ""} ${(e && (e.shortMessage || e.message)) || e || ""}`);

async function runOnce(c, provider) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await scan(c, provider, DRY, SETTLE);
    } catch (e) {
      const msg = e.shortMessage || e.message || String(e);
      if (attempt === 1) {
        console.log(`[${ts()}] 扫描失败（${msg}），5 秒后原地重试一次`);
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      if (!isTransient(e)) throw e;
      console.log(`[${ts()}] ⚠ 传输层故障，本轮跳过：${msg}`);
      console.log(`[${ts()}]   下一轮 30 分钟后自动重试；V6 有 7 天领取宽限，不影响骑手拿钱`);
      return;
    }
  }
}

(async () => {
  const rpc = process.env.SEPOLIA_RPC || process.env.RPC_URL;
  const addr = (VARIANT === "V6" && process.env.CONTRACT_ADDRESS_V6) || (VARIANT === "V5" && process.env.CONTRACT_ADDRESS_V5) || process.env.CONTRACT_ADDRESS;
  const key = process.env.KEEPER_KEY || process.env.PRIVATE_KEY;
  if (!addr) throw new Error("请先在 .env 里填 CONTRACT_ADDRESS");
  if (!key && !DRY) throw new Error("请先在 .env 里填 PRIVATE_KEY（或 KEEPER_KEY）");

  // cacheTimeout 0：ethers v6 默认把 eth_getBalance 缓存 250ms，于是「每张保单结算前重读池子」
  // 在 250ms 内读到的还是同一个旧值 —— 重读就白写了（实测：默认缓存下 --dry-run 会拿开局那个
  // 池子余额一路放行）。keeper 是低频脚本，多几次 RPC 换「读到的就是当下」值得。
  const provider = new JsonRpcProvider(rpc, undefined, { cacheTimeout: 0 });
  const net = await provider.getNetwork();

  // 地址上没有代码的最坏情况：调 nextPolicyId() 返回空数据、被解成 0，keeper 就永远打印
  // 「链上还没有任何保单」并成功退出 —— 换了合约地址却忘改 .env 时，理赔静默停摆，最难发现。
  if ((await provider.getCode(addr)) === "0x") {
    throw new Error(`${VARIANT} 合约地址 ${addr} 上没有任何代码（链 ${net.chainId}）。` +
      `多半是 deployment.json（项目根）里的 contract 指向了别的链或旧地址 —— 以它为准，.env 只放钥匙。`);
  }
  SYM = net.chainId === 677n || net.chainId === 968n ? "BOT" : "SepETH";   // 与 deploy.js:149 同一口径
  const wallet = key ? new Wallet(key, provider) : null;
  let abi = JSON.parse(fs.readFileSync(ABI_FILE, "utf8"));
  let c = new Contract(addr, abi, wallet || provider);

  // ★ 版本探针：v5 才有 regionCount()。ABI 拿错时页面/脚本不报错，只会静默解错字段
  //   （v2 的 policies() 15 个字段 vs v5 的 16 个，整体错位），这种错最难在演示现场看出来。
  if (VARIANT !== "V6" && !ARGV.some(a => /^--v[2-6]$/.test(a))) {
    const v5 = new Contract(addr, JSON.parse(fs.readFileSync(
      path.join(__dirname, "..", "03-合约", "RainDeliveryInsuranceV5.abi.json"), "utf8")), provider);
    try {
      await v5.regionCount();   // 只有 v5 有
      abi = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "03-合约", "RainDeliveryInsuranceV5.abi.json"), "utf8"));
      c = new Contract(addr, abi, wallet || provider);
      VARIANT = "V5";
      console.log("检测到合约是 v5（有 regionCount()）—— 自动切到 V5 ABI（未加参数时的默认值是 v2，别用错）");
    } catch (e) { if (e.code !== "CALL_EXCEPTION") throw e; /* 只有合约不支持函数时保留旧版 */ }
  }
  const IS_V5 = CENTS;

  console.log(`keeper 启动 · chainId ${net.chainId} · 合约 ${addr}`);
  if (wallet) console.log(`  签名账户 ${wallet.address}（余额 ${formatEther(await provider.getBalance(wallet.address))} ${SYM}）`);
  console.log(`  池子 ${IS_V5() ? yuan(await c.poolBalance()) + " 元" : formatEther(await provider.getBalance(addr)) + " " + SYM}` +
              ` · 额度基数 ${IS_V5() ? yuan(await c.PAYOUT_MAX()) + " 元" : formatEther(await c.PAYOUT_MAX()) + " " + SYM}`);
  console.log(`  未了结敞口 ${IS_V5() ? yuan(await c.openExposure()) + " 元" : formatEther(await c.openExposure()) + " " + SYM}` +
              ` · 准备金 ${IS_V5() ? yuan(await c.reserveOf()) + " 元" : formatEther(await c.reserveOf()) + " " + SYM}`);
  if (!DRY) console.log("⚠️ 非 dry-run：本轮会真发交易（想只看不动就加 --dry-run）");
  // A26：`settleExpired` 只有 v2 带 onlyOperator（v3/v4/v5 都没有 —— 结算只把敞口减下来、
  // 不产生付款）。原来写的是 `VARIANT !== "V3"`，于是 v4/v5 也被要求 operator 钥匙，
  // 一把普通 keeper 钥匙会被直接拒掉，白丢一个合法能力。按「哪些版本真的要」写正向条件。
  if (SETTLE && needsOperatorSettle() && !DRY) {
    const op = await c.operator();
    if (!wallet || wallet.address.toLowerCase() !== op.toLowerCase()) {
      throw new Error(`--settle 在 ${VARIANT} 上需要 operator 私钥：合约的 operator 是 ${op}，当前签名账户是 ${wallet ? wallet.address : "(只读)"}。` +
        `（v3/v4/v5 已去掉 onlyOperator，加 --v3/--v4/--v5 就能用任意钥匙结算）`);
    }
  }
  console.log("");

  if (ONCE || DRY) { await runOnce(c, provider); return; }
  for (;;) {
    try { await scan(c, provider, false, SETTLE); } catch (e) { console.log(`[${ts()}] 扫描出错：${e.shortMessage || e.message}`); }
    await new Promise((r) => setTimeout(r, INTERVAL * 1000));
  }
})().catch((e) => {
  // 传输层故障可能发生在扫描之前的准备阶段（读 network / operator / 余额），那里没有重试循环，
  // 所以边界上再判一次：网络问题按「本轮跳过」处理，交给 30 分钟后的下一轮；真 bug 照旧红。
  const msg = e.shortMessage || e.message || String(e);
  if (isTransient(e)) {
    console.log(`[${ts()}] ⚠ 传输层故障，本轮跳过：${msg}`);
    console.log(`[${ts()}]   30 分钟后的下一轮自动重试；V6 有 7 天领取宽限，不影响骑手拿钱`);
    return;
  }
  console.error("💥", msg);
  process.exit(1);
});
