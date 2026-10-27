/**
 * 历史回放 · v3 链上准备：给资金池注资 + 用骑手私钥买一份保单
 *
 * 为什么单独写一个：04-脚本/rehearse-v2.js 是面向 968 的 v2 全动线体检（打的是 v2 的 ABI 与
 * 终身限购语义），而历史回放要的是 v3（国标两档、hours 只允许 12/24、12h/24h 每单计数按未结清算）。
 * 这里只做两件不可逆的事：fundPool() 与 buyPolicy(2, 24)，每一步都把 tx 哈希、区块号、
 * 链上读回来的保单字段打印出来，供 08-截图存证/历史回放-*.md 直接引用。
 *
 * 用法（本地回放链，先起 07-测试工具/replay_chain.js serve "<买保险那一刻>"）：
 *   $env:SEPOLIA_RPC='http://127.0.0.1:8546'
 *   $env:CONTRACT_ADDRESS='0x…v3 地址'
 *   node replay_v3_setup.js [regionId=2] [hours=24] [fundEth=0.05]
 *
 * 私钥从 04-脚本/.env 读（这里不 require('dotenv')：07-测试工具 里没装那个包，
 * 装了反而多一个依赖；.env 就是几行 KEY=VALUE，自己解析更省事）。
 */
const fs = require("fs");
const path = require("path");
const { JsonRpcProvider, Wallet, Contract, parseEther, formatEther } = require("ethers");

const ENV = {};
for (const line of fs.readFileSync(path.join(__dirname, "..", "04-脚本", ".env"), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
  if (m) ENV[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const ABI = JSON.parse(fs.readFileSync(
  path.join(__dirname, "..", "03-合约", "RainDeliveryInsuranceV3.abi.json"), "utf8"));

const args = process.argv.slice(2).filter((a) => /^\d+(\.\d+)?$/.test(a));
const REGION = Number(args[0] || 2);
const HOURS = Number(args[1] || 24);
const FUND = args[2] || "0.05";

const RPC = process.env.SEPOLIA_RPC || "http://127.0.0.1:8546";
const ADDR = (process.env.CONTRACT_ADDRESS || "").trim();

async function main() {
  if (!/^0x[0-9a-fA-F]{40}$/.test(ADDR)) throw new Error("先设 CONTRACT_ADDRESS（v3 地址）");
  if (!ENV.PRIVATE_KEY || !ENV.RIDER_KEY) throw new Error("04-脚本/.env 里缺 PRIVATE_KEY 或 RIDER_KEY");

  const provider = new JsonRpcProvider(RPC, undefined, { staticNetwork: true });
  const op = new Wallet(ENV.PRIVATE_KEY, provider);      // 部署者 = operator（v3 构造器里 operator = msg.sender）
  const rider = new Wallet(ENV.RIDER_KEY, provider);
  const c = new Contract(ADDR, ABI, op);

  const net = await provider.getNetwork();
  const block = await provider.getBlockNumber();
  const head = await provider.getBlock(block);
  const clock = new Date((head.timestamp + 8 * 3600) * 1000).toISOString().replace("T", " ").slice(0, 19);
  console.log("=".repeat(74));
  console.log("历史回放 · v3 链上准备");
  console.log("=".repeat(74));
  console.log(`合约      ${ADDR}`);
  console.log(`链        chainId ${net.chainId} · 块高 ${block} · 链上时钟 ${clock} (+0800)`);
  console.log(`operator  ${await c.operator()}`);
  console.log(`注资账户  ${op.address}  ${formatEther(await provider.getBalance(op.address))} ETH`);
  console.log(`骑手账户  ${rider.address}  ${formatEther(await provider.getBalance(rider.address))} ETH`);
  console.log(`池子(前)  ${formatEther(await c.poolBalance())} ETH`);

  // ① 注资：池子是空的，第一笔赔付会因 insufficient funds 失败
  const poolBefore = await c.poolBalance();
  if (poolBefore === 0n) {
    const t1 = await c.fundPool({ value: parseEther(FUND) });
    const r1 = await t1.wait();
    console.log(`\n① fundPool(${FUND} ETH)  tx ${t1.hash}  区块 ${r1.blockNumber}  gas ${r1.gasUsed}`);
  } else {
    console.log(`\n① 池子已有 ${formatEther(poolBefore)} ETH —— 跳过注资（这一步不可逆，重跑不要重复注）`);
  }
  console.log(`   池子(现)  ${formatEther(await c.poolBalance())} ETH`);

  // ② 报价（v3 的 premiumOf 有两个重载：5 参版才是「档位 × 渠道 × 份数」，2 参版是兼容旧口径）
  const quote = await c["premiumOf(uint8,uint256,uint8,uint8,uint256)"](REGION, HOURS, 0, 0, 1);
  const price = typeof quote === "bigint" ? quote : quote[0];   // 5 参版只返回价格；返回元组时取第一个
  console.log(`\n② 报价 premiumOf(${REGION}, ${HOURS}h, tier0, channel0, 1) = ${formatEther(price)} ETH  ` +
              `raw=${JSON.stringify(quote, (k, v) => (typeof v === "bigint" ? v.toString() : v))}`);

  // ③ 骑手投保（链上只按单元成交：count 必须为 1）
  const before = Number(await c.nextPolicyId());
  const cr = new Contract(ADDR, ABI, rider);
  const t2 = await cr.buyPolicy(REGION, HOURS, { value: price });
  const r2 = await t2.wait();
  const id = before;
  const p = await c.policies(id);
  const stamp = (s) => new Date((Number(s) + 8 * 3600) * 1000).toISOString().replace("T", " ").slice(0, 19);

  console.log(`\n③ buyPolicy(${REGION}, ${HOURS})  tx ${t2.hash}  区块 ${r2.blockNumber}  gas ${r2.gasUsed}`);
  console.log(`   保单 #${id}`);
  console.log(`     rider(受益人)     ${p.rider}`);
  console.log(`     payer(付费人)     ${p.payer}`);
  console.log(`     regionId         ${p.regionId}`);
  console.log(`     windowHours      ${p.windowHours}`);
  console.log(`     保费             ${formatEther(p.premium)} ETH`);
  console.log(`     thresholdMm      ${p.thresholdMm}`);
  console.log(`     rainfallAtBuy    ${p.rainfallAtBuy} mm`);
  console.log(`     startTime        ${stamp(p.startTime)} (+0800)`);
  console.log(`     endTime          ${stamp(p.endTime)} (+0800)`);
  console.log(`     状态             ${await c.policyStatus(id)}`);
  console.log(`    openPoliciesOf    ${await c.openPoliciesOf(rider.address)}`);
  console.log(`    pendingExposure   ${formatEther(await c.pendingExposureOf(rider.address))} ETH`);
  console.log(`\n下一步：把链上时钟拨到保单到期前 30 分钟，再喂一次价（--until=<判定当天>），然后跑 AI 三件套。`);
}

main().catch((e) => {
  console.error("💥 " + (e.shortMessage || e.message || e));
  process.exit(1);
});
