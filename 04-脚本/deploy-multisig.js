/**
 * 部署 OperatorMultisig（A-4）—— **默认只做演练，不发交易**
 * ============================================================================
 * 为什么单独一个脚本：`deploy.js` 的工厂调用是 `factory.deploy()`（无构造参数），
 * 多签的构造器要 (address[] owners, uint256 threshold)，塞进去会把两条路径都弄乱。
 *
 * 用法（在 04-脚本 目录）：
 *   # 演练（默认）：读链、算预测地址、估 gas，一分钱不花
 *   $env:SEPOLIA_RPC='https://rpc.bohr.life'; node deploy-multisig.js --owners 0xA,0xB,0xC --threshold 2
 *   ⚠️ PowerShell 里 owners 必须整体加引号：不加引号会被当成数组拆成三个参数（实测报「不是合法地址：1」）
 *
 *   # 真发（需要 --send；主网 677 还要额外 --yes-mainnet）
 *   $env:SEPOLIA_RPC='https://rpc.botchain.ai'; node deploy-multisig.js --owners 0xA,0xB,0xC --threshold 2 --send --yes-mainnet
 *   ⚠️ 估 gas 失败（构造器会 revert）时默认**拒绝广播** —— 确认要试才加 --force
 *
 * ★ 与演示的关系（2026-10-07 审计 A6）：**演示前不要 transferOperator**。
 *   `04-脚本/push-rainfall.js` 与演示期所有写交易都走 .env 里的单私钥；
 *   把 operator 换成多签，单私钥立刻失去写权限，10-08 09:00 的保鲜喂价会直接 revert。
 *   正确顺序：先部署多签（本脚本）→ 演示结束 → 再用当前 operator 调
 *   `transferOperator(<多签地址>)`（v2 `RainDeliveryInsuranceV2.sol:419` / v3 `:569`，都是 onlyOperator）。
 *   换成多签之后，喂价/判定也必须改走 `submit()`，否则脚本会 revert。
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { JsonRpcProvider, Wallet, ContractFactory, isAddress, getCreateAddress } = require("ethers");

const SOL_DIR = path.join(__dirname, "..", "03-合约");
const NAME = "OperatorMultisig";
const ABI_FILE = path.join(SOL_DIR, `${NAME}.abi.json`);
const BYTECODE_FILE = path.join(SOL_DIR, `${NAME}.bytecode.txt`);
const COMPILE_HINT = "先在 07-测试工具 里跑：npm run compile:multisig";

const KNOWN_CHAINS = { 11155111: "Sepolia", 677: "BOT Chain Mainnet", 968: "BOT Chain Testnet" };

const argOf = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const SEND = process.argv.includes("--send");
const YES_MAINNET = process.argv.includes("--yes-mainnet");
const FORCE = process.argv.includes("--force");   // 估 gas 失败也照发（默认不发，见 :150）

function readProducts() {
  if (!fs.existsSync(ABI_FILE)) throw new Error("找不到编译产物：" + ABI_FILE + "\n  " + COMPILE_HINT);
  if (!fs.existsSync(BYTECODE_FILE)) throw new Error("找不到编译产物：" + BYTECODE_FILE + "\n  " + COMPILE_HINT);
  const abi = JSON.parse(fs.readFileSync(ABI_FILE, "utf8").trim());
  const bytecode = fs.readFileSync(BYTECODE_FILE, "utf8").trim();
  if (!Array.isArray(abi) || abi.length === 0) throw new Error("ABI 是空的：" + ABI_FILE + "\n  " + COMPILE_HINT);
  if (!bytecode.startsWith("0x") || bytecode.length < 10) throw new Error("bytecode 是空的：" + BYTECODE_FILE + "\n  " + COMPILE_HINT);
  return { abi, bytecode };
}

// 与合约构造器的守卫一一对应（no owners / bad threshold / zero owner / duplicate owner），
// 目的是把错误拦在发交易之前 —— 构造器 revert 走 CREATE，错误原因传不回来，只有在本地才看得见。
function readOwners() {
  const raw = argOf("--owners");
  if (!raw) throw new Error("必须显式给 owners：--owners 0xA,0xB,0xC（脚本不替你编地址）");
  const owners = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (owners.length === 0) throw new Error("owners 为空");
  for (const o of owners) {
    if (!isAddress(o)) throw new Error("不是合法地址：" + o);
    if (/^0x0{40}$/i.test(o)) throw new Error("owner 不能是零地址");
  }
  if (new Set(owners.map((o) => o.toLowerCase())).size !== owners.length) throw new Error("owner 有重复");
  const threshold = Number(argOf("--threshold") ?? 2);
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > owners.length) {
    throw new Error(`threshold=${argOf("--threshold")} 不合法：必须是 1..${owners.length} 的整数`);
  }
  return { owners, threshold };
}

async function retry(label, fn, n = 3) {
  let last;
  for (let i = 1; i <= n; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      console.log(`  ⚠️ ${label} 第 ${i}/${n} 次失败：${e.shortMessage || e.message}`);
      if (i < n) await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw last;
}

async function main() {
  const rpc = process.env.SEPOLIA_RPC || "https://rpc.bohr.life";
  if (!process.env.PRIVATE_KEY || !process.env.PRIVATE_KEY.startsWith("0x")) {
    throw new Error("请先在 .env 里填好 PRIVATE_KEY（0x 开头）");
  }
  const { abi, bytecode } = readProducts();
  const { owners, threshold } = readOwners();

  console.log(`${NAME} 部署${SEND ? "（★ 真发交易）" : "演练（不发交易）"}`);
  console.log("=".repeat(64));
  console.log("owners     :", owners.join("\n             "));
  console.log("threshold  :", threshold, `（${owners.length} 个 owner，${threshold} 票执行）`);
  console.log("ABI 条目数 :", abi.length);
  console.log("Bytecode   :", bytecode.length, "字符");
  console.log("RPC        :", rpc);

  const provider = new JsonRpcProvider(rpc, undefined, { staticNetwork: true });
  const net = await retry("读网络", () => provider.getNetwork());
  const chainId = Number(net.chainId);
  const chainName = KNOWN_CHAINS[chainId];
  if (!chainName) {
    throw new Error(`当前 RPC 不是已知的真链（chainId=${chainId}）。已知：` +
      Object.entries(KNOWN_CHAINS).map(([k, v]) => `${v}(${k})`).join(" / "));
  }
  const blockNumber = await retry("读块高", () => provider.getBlockNumber());
  const isRealChain = blockNumber >= 1000000;
  const sym = chainId === 677 || chainId === 968 ? "BOT" : "SepETH";
  console.log("网络       : " + (isRealChain ? `${chainName} (${chainId})`
    : `⚠️ 本地假链（块高 ${blockNumber}，chainId 伪装成 ${chainName}）—— 不是真链！`));

  const wallet = new Wallet(process.env.PRIVATE_KEY, provider);
  const [balance, nonce, fee] = await Promise.all([
    retry("读余额", () => provider.getBalance(wallet.address)),
    retry("读 nonce", () => provider.getTransactionCount(wallet.address)),
    retry("读 gas 价", () => provider.getFeeData()),
  ]);
  const predicted = getCreateAddress({ from: wallet.address, nonce });
  console.log("部署账户   :", wallet.address);
  console.log("账户余额   :", (Number(balance) / 1e18).toFixed(6), sym);
  console.log("nonce      :", nonce);
  if (balance === 0n) throw new Error(`账户余额为 0 —— 这个地址在 ${chainName} 上没有 ${sym} 可付 gas`);

  const factory = new ContractFactory(abi, bytecode, wallet);
  const deployTx = await factory.getDeployTransaction(owners, threshold);
  const gasPrice = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
  let gas = null;
  try { gas = await retry("估 gas", () => provider.estimateGas({ from: wallet.address, data: deployTx.data })); }
  catch (e) { console.log("  ⚠️ 估 gas 失败（构造器会 revert？）：" + (e.shortMessage || e.message)); }

  console.log("\n预测合约地址:", predicted, "  ← nonce=" + nonce + "（同 nonce 三链同址，与 v2 在 968/677 的规律一致）");
  if (gas !== null) {
    console.log("估算 gas   :", gas.toString());
    console.log("预估成本   :", (Number(gas * gasPrice) / 1e18).toFixed(9), sym,
      `（余额的 1/${(Number(balance) / Number(gas * gasPrice)).toFixed(0)}）`);
  }

  if (!SEND) {
    console.log("\n【演练结束，没有发任何交易】要真发就在同一行后面加 --send" +
      (chainId === 677 ? " 与 --yes-mainnet（主网还要额外确认一次）" : ""));
    return;
  }
  if (!isRealChain) throw new Error("块高 < 1000000：这是本地假链，拒绝发交易");
  if (chainId === 677 && !YES_MAINNET) throw new Error("主网 677 需要 --yes-mainnet 才发（防止误发）");
  // 估 gas 失败几乎只有一个原因：构造器会 revert（owners / threshold 不合法）。
  // 演练时告警无妨，真发则是烧掉一笔注定失败的交易（CREATE 里 revert 连原因都传不回来）。
  if (gas === null && !FORCE) {
    throw new Error("估 gas 失败 ⇒ 构造器多半会 revert，拒绝广播这笔注定失败的主网交易（确认要试再加 --force）");
  }

  console.log("\n正在部署，请稍候...");
  const contract = await factory.deploy(owners, threshold);
  const tx = contract.deploymentTransaction();
  console.log("交易哈希   :", tx.hash);
  try { await contract.waitForDeployment(); }
  catch (e) {
    console.error(`\n⚠️ 等确认超时/失败：${e.shortMessage || e.message}`);
    console.error("   别重跑本脚本（重跑 = 第二个多签），先拿这个哈希去浏览器查：\n   " + tx.hash);
    process.exit(2);
  }
  const address = await contract.getAddress();
  console.log("\n✅ 多签部署成功");
  console.log("多签地址   :", address);
  console.log("交易哈希   :", tx.hash);
  console.log("\n【演示之后再做的两件事 —— 演示前做这两件事会打断 09:00 的保鲜喂价】");
  console.log("  ① 用当前 operator 调目标合约的 transferOperator(" + address + ")");
  console.log("     （v2 在 RainDeliveryInsuranceV2.sol:419，v3 在 RainDeliveryInsuranceV3.sol:569，都是 onlyOperator）");
  console.log("  ② 之后喂价 / 提交判定必须改走多签的 submit(target,value,data) ——");
  console.log("     直接在 push-rainfall.js / submit-judgement.js 里用单私钥发交易会 revert（已不是 operator）。");
  console.log("  ③ 多签要能代付 value，得先给它转 " + sym + "（它没有自动注资路径，只有 receive()）。");
}

main().catch((e) => {
  console.error("\n❌ 失败：", e.message || e);
  process.exit(1);
});
