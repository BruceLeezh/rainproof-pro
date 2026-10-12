/**
 * 把 `10-金融与定价/ref/PricingV3.sol`（v3 五维定价模块）部署到 BOT Chain 测试网 968。
 *
 * 为什么不复用 04-脚本/deploy.js：那个脚本只部署 `03-合约/` 里的产品合约（v1/v2），
 * 从 `03-合约/*.abi.json` 读 `07-测试工具` 的编译产物。定价模块是 `10-金融与定价/ref/`
 * 下的独立件（B 写的、自包含、不继承 v2、不碰判定链），产物不在 `03-合约/`，所以这里自己编译。
 *
 * ★ 演示基线不受影响：部署这个模块**不动** 968 上的 v2 产品合约（`0x89e7…596a`），
 *   两者互不引用 —— 模块只是把 60 格五维定价表放到链上，让"可复算"这件事也能被链上核验。
 *
 * 用法（在 04-脚本/ 下）：
 *   node deploy-pricing-v3.js            # 部署到 968（用 .env 的 PRIVATE_KEY 付 gas）
 *   node deploy-pricing-v3.js --dry      # 只编译 + 报字节码长度，不广播
 *   node deploy-pricing-v3.js --rpc=https://... --chain=968
 *
 * 部署完：
 *   ① 把地址记进 `.env`：`PRICING_V3_ADDR=0x...`
 *   ② `cd ../10-金融与定价 && node ref/apply-pricing-v3.js --addr=0x... --apply`    （60 笔 setPremiumRow）
 *   ③ `cd ../10-金融与定价 && node ref/apply-pricing-v3.js --addr=0x... --verify`   （读回 240 项比对）
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { JsonRpcProvider, Wallet, ContractFactory } = require("ethers");
// 锚到脚本自己旁边的 .env，而不是 cwd —— 否则从别处跑就静默读不到 PRIVATE_KEY
require("dotenv").config({ path: path.join(__dirname, ".env") });

const TOOLS = path.join(__dirname, "..", "07-测试工具", "node_modules");
const solc = require(path.join(TOOLS, "solc"));
const SOL_PATH = path.join(__dirname, "..", "10-金融与定价", "ref", "PricingV3.sol");

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const has = (name) => process.argv.includes(`--${name}`);

const KNOWN_CHAINS = { 11155111: "Sepolia", 677: "BOT Chain 主网", 968: "BOT Chain 测试网 968" };

function compile() {
  const input = {
    language: "Solidity",
    sources: { "PricingV3.sol": { content: fs.readFileSync(SOL_PATH, "utf8") } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // deployedBytecode 也一起要：PricingV3 没有构造函数参数、没有 immutable，
      // 所以链上 getCode() 应当与它逐字节相同 —— 部署前拿它跟目标地址比对才有意义。
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
    },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errs = (out.errors || []).filter((e) => e.severity === "error");
  if (errs.length) throw new Error(errs.map((e) => e.formattedMessage).join("\n"));
  const c = out.contracts["PricingV3.sol"].PricingV3;
  return { abi: c.abi, bytecode: "0x" + c.evm.bytecode.object, runtime: "0x" + c.evm.deployedBytecode.object };
}

// 读操作自动重试（BOT Chain RPC 偶发 timeout）。★ 发交易不自动重试 —— 重试就是重复部署。
async function retry(label, fn, n = 3) {
  let last;
  for (let i = 1; i <= n; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      console.log(`  ⚠️ ${label} 第 ${i}/${n} 次失败：${e.shortMessage || e.message}`);
      if (i < n) await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw last;
}

async function main() {
  const target = Number(arg("chain", "968"));
  const rpc = arg("rpc", process.env.PRICING_V3_RPC || process.env.SEPOLIA_RPC || "https://rpc.bohr.life");
  const { abi, bytecode, runtime } = compile();
  // 源码 sha256：源码在仓库外的 10-金融与定价/ref/ 下，随时可能被人改一行再跑本脚本，
  // 打印出来（连同编译器版本）才说得清「这次部署的到底是哪个版本」，复盘时能对上。
  const srcSha = crypto.createHash("sha256").update(fs.readFileSync(SOL_PATH)).digest("hex");

  console.log("合约       : PricingV3（v3 五维定价模块，自包含、不继承 v2）");
  console.log("源码       : 10-金融与定价/ref/PricingV3.sol");
  console.log("源码 SHA256:", srcSha);
  console.log("编译器     : solc", solc.version());
  console.log("ABI 条目数 :", abi.length);
  console.log("Bytecode   :", (bytecode.length - 2) / 2, "字节（部署用）");
  console.log("运行时代码 :", (runtime.length - 2) / 2, "字节（部署后 getCode 应逐字节相同）");
  console.log("RPC        :", rpc);
  if (has("dry")) {
    console.log("\n--dry：只编译，不广播。");
    return;
  }
  if (!process.env.PRIVATE_KEY || !process.env.PRIVATE_KEY.startsWith("0x")) {
    throw new Error("请先在 .env 里填好 PRIVATE_KEY（0x 开头）");
  }

  const provider = new JsonRpcProvider(rpc, undefined, { staticNetwork: true });
  const net = await retry("读网络", () => provider.getNetwork());
  const chainId = Number(net.chainId);
  const blockNumber = await retry("读块高", () => provider.getBlockNumber());
  console.log("网络       :", `${KNOWN_CHAINS[chainId] || "未知链"} (chainId ${chainId}) · 块高 ${blockNumber}`);
  if (chainId !== target) {
    throw new Error(`⚠️ 当前 RPC 是 chainId=${chainId}，不是要部署的 ${target}（${KNOWN_CHAINS[target] || "?"}）—— 拒绝部署`);
  }
  if (blockNumber < 1000000) {
    throw new Error(`⚠️ 块高只有 ${blockNumber}，像是本地假链 —— 拒绝部署`);
  }

  const wallet = new Wallet(process.env.PRIVATE_KEY, provider);
  const balance = await retry("读余额", () => provider.getBalance(wallet.address));
  const sym = chainId === 677 || chainId === 968 ? "BOT" : "SepETH";
  console.log("部署账户   :", wallet.address);
  console.log("账户余额   :", (Number(balance) / 1e18).toFixed(6), sym);
  if (balance === 0n) throw new Error(`部署账户在 ${KNOWN_CHAINS[chainId]} 上没有 ${sym} 可付 gas`);

  // 部署前先看「目标地址」上是不是已经有一份代码 —— CREATE 出来的地址不是自己挑的，
  // 所以这个地址只能是 apply-pricing-v3.js 认的那个（--addr= 或 .env 的 PRICING_V3_ADDR）。
  // 不看的话典型事故：重复跑一次 → 又部署一个副本 → PRICING_V3_ADDR 仍指旧的 → 60 笔写进旧合约。
  const targetAddr = arg("addr", process.env.PRICING_V3_ADDR || "");
  if (targetAddr) {
    const existing = await retry("读目标地址代码", () => provider.getCode(targetAddr));
    if (existing && existing !== "0x") {
      const same = existing.toLowerCase() === runtime.toLowerCase();
      console.log(`已有代码   : ${targetAddr} 上 ${(existing.length - 2) / 2} 字节 vs 本次运行时代码 ${(runtime.length - 2) / 2} 字节 → ${same ? "完全一致" : "不一致"}`);
      if (same) {
        console.log("\n目标地址上已经是这份源码的产物（逐字节相同），不重复部署。");
        return;
      }
      if (!has("force")) {
        throw new Error(
          `⚠️ 目标地址 ${targetAddr} 上已有**不同**的代码 —— 再部署只会得到一个新地址，` +
          `而 PRICING_V3_ADDR 仍然指向旧的，后续 60 笔写价会写错地方。\n` +
          `   确认要部署请加 --force，或先把 .env 里的 PRICING_V3_ADDR 清掉。`
        );
      }
      console.log("           --force：明知目标地址上是别的代码，仍然继续部署。");
    }
  }

  // gasLimit：默认仍是保守固定值 —— 本仓有过「双峰估 gas」的前科，不拿估出来的数直接发；
  // 需要时 --gaslimit=N 传参。顺手 estimateGas 一次只为**报个数**：估不出来通常说明这笔交易
  // 本身有问题（余额 / nonce / RPC），在广播之前就该知道。
  const gasLimit = arg("gaslimit", "") ? BigInt(arg("gaslimit", "")) : 2_000_000n;
  const factory = new ContractFactory(abi, bytecode, wallet);
  let estTxt;
  try {
    const est = await provider.estimateGas({ ...(await factory.getDeployTransaction()), from: wallet.address });
    estTxt = `${est}`;
    if (est > gasLimit) console.log(`  ⚠️ estimateGas = ${est} 已超过 gasLimit = ${gasLimit}，这笔部署会 out of gas`);
  } catch (e) {
    estTxt = `估算失败（${e.shortMessage || e.message}）`;
  }
  console.log(`\n正在部署（gasLimit ${gasLimit}${arg("gaslimit", "") ? " 来自 --gaslimit" : " 为保守回退值"}；estimateGas ${estTxt}）...`);
  const c = await factory.deploy({ gasLimit });
  const tx = c.deploymentTransaction();
  console.log("交易哈希   :", tx.hash);
  console.log("浏览器     :", `https://scan.bohr.life/tx/${tx.hash}`);

  // ★ 交易已经发出去了，这里再超时也【绝不能重发】—— 重发就是第二个合约、又一份 gas。
  try {
    await c.waitForDeployment();
  } catch (e) {
    console.error(`\n⚠️ 等确认超时/失败：${e.shortMessage || e.message}`);
    console.error("   交易可能已经上链 —— 别重跑本脚本，先拿上面的哈希去浏览器查。");
    process.exit(2);
  }

  const address = await c.getAddress();
  const code = await retry("读代码", () => provider.getCode(address));
  const operator = await c.operator();
  console.log("\n✅ 部署成功");
  console.log("合约地址   :", address);
  console.log("运行时代码 :", (code.length - 2) / 2, "字节");
  console.log(
    "operator   :",
    operator,
    operator.toLowerCase() === wallet.address.toLowerCase()
      ? "（= 部署账户 ✅ 60 笔 setPremiumRow 由它签名）"
      : "⚠️ 不是部署账户，写价会被 onlyOperator 拒掉"
  );
  console.log("浏览器     :", `https://scan.bohr.life/address/${address}`);
  console.log("\n接下来：");
  console.log(`  ① 记进 .env：PRICING_V3_ADDR=${address}`);
  console.log(`  ② cd ../10-金融与定价 && node ref/apply-pricing-v3.js --addr=${address} --apply`);
  console.log(`  ③ cd ../10-金融与定价 && node ref/apply-pricing-v3.js --addr=${address} --verify`);
}

main().catch((e) => {
  console.error("\n❌ 失败：", e.message || e);
  process.exit(1);
});
