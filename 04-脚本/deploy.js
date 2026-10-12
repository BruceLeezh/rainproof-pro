/**
 * 把合约部署到 Sepolia / BOT Chain（不依赖任何浏览器插件）
 *
 * 用法：
 *   1) npm install
 *   2) 把 .env.example 复制成 .env，填上 PRIVATE_KEY（可选 SEPOLIA_RPC / CONTRACT_ADDRESS）
 *   3) 先编译：在 07-测试工具 里跑
 *        node compile_sol.js ../03-合约/RainDeliveryInsurance.sol      （v1）
 *        npm run compile:v2                                             （v2）
 *      （产物直接落在 03-合约/，这个脚本就从那里读，不需要手工复制粘贴）
 *   4) node deploy.js --v3         ← 部署 v3（现行产品合约：968 与主网 677 上跑的就是它）
 *      node deploy.js --v2         ← 部署 v2（968 上的演示留痕那版）
 *      node deploy.js --v1         ← 部署 v1（2026-10-06 第一阶段留在 Sepolia 的那版）
 *
 * ★ 版本必须显式给（A18）：以前不给旗标就默认部署 v1 —— 一条 `node deploy.js` 会在主网上
 *   把已经过时的 v1 部署出去、还花真 gas（撤不回来）。现在不给旗标直接报错。
 *
 * 部署到 BOT Chain 主网（chainId 677，原生代币 BOT）：
 *      $env:SEPOLIA_RPC='https://rpc.botchain.ai'; node deploy.js --v3 --yes-mainnet
 *      （主网要额外一次显式确认，与 04-脚本/deploy-multisig.js:147 是同一道闸）
 *   （变量名叫 SEPOLIA_RPC 是历史包袱：它只是一条"RPC 地址"，是哪条链由节点自己答，
 *     脚本会用 chainId + 块高双重确认身份，认不出来就拒绝部署。）
 *
 * 这个脚本会把合约地址打印出来，并告诉你用「链上核验台」怎么验证。
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { JsonRpcProvider, Wallet, ContractFactory } = require("ethers");

// ★ 唯一真相：编译产物只放在 03-合约/。
//   以前这里读 04-脚本/abi.json + 04-脚本/bytecode.txt，而 compile_sol.js 是把产物写进
//   03-合约/ 的 —— 两边一旦不同步，部署用的就是【旧字节码】，而且不会有任何报错。
//   现在 ABI/bytecode 只有一处，物理上不可能再对不上。
//
// ★ 部署哪一版：默认 v1（RainDeliveryInsurance），加 --v2 部署 v2（RainDeliveryInsuranceV2）。
//   v2 必须先编译：cd 07-测试工具 && npm run compile:v2
const SOL_DIR = path.join(__dirname, "..", "03-合约");
const ARGV = process.argv.slice(2);
const YES_MAINNET = ARGV.includes("--yes-mainnet");
// A18：不给旗标就默认 v1 是个陷阱 —— 主网上一发就是真 gas + 一个过时合约。
// 现在三版都要显式点名（--v1 的 VARIANT 是空串：v1 的文件名没有后缀）。
const VARIANT = ARGV.includes("--v3") ? "V3" : ARGV.includes("--v2") ? "V2" : ARGV.includes("--v1") ? "" : null;
if (VARIANT === null) {
  console.error("❌ 必须显式指定要部署哪一版：--v3（现行产品）/ --v2（968 演示留痕）/ --v1（第一阶段留痕，别用于新链）");
  process.exit(2);
}
const CONTRACT_NAME = "RainDeliveryInsurance" + VARIANT;
const ABI_FILE = path.join(SOL_DIR, `${CONTRACT_NAME}.abi.json`);
const BYTECODE_FILE = path.join(SOL_DIR, `${CONTRACT_NAME}.bytecode.txt`);
const COMPILE_HINT = VARIANT === "V3"
  ? "先在 07-测试工具 里跑：node compile_sol.js ../03-合约/RainDeliveryInsuranceV3.sol --via-ir"
  : VARIANT
    ? "先在 07-测试工具 里跑：npm run compile:v2"
    : "先在 07-测试工具 里跑：node compile_sol.js ../03-合约/RainDeliveryInsurance.sol";

function readAbi() {
  if (!fs.existsSync(ABI_FILE)) throw new Error("找不到编译产物：" + ABI_FILE + "\n  " + COMPILE_HINT);
  const raw = fs.readFileSync(ABI_FILE, "utf8").trim();
  if (!raw || raw === "[]") {
    throw new Error("ABI 是空的：" + ABI_FILE + "\n  " + COMPILE_HINT);
  }
  try {
    const abi = JSON.parse(raw);
    if (!Array.isArray(abi) || abi.length === 0) {
      throw new Error("不是非空数组");
    }
    return abi;
  } catch (e) {
    throw new Error("ABI 不是合法的 JSON：" + e.message);
  }
}

function readBytecode() {
  if (!fs.existsSync(BYTECODE_FILE)) throw new Error("找不到编译产物：" + BYTECODE_FILE + "\n  " + COMPILE_HINT);
  const raw = fs.readFileSync(BYTECODE_FILE, "utf8").trim();
  if (!raw || raw === "0x" || raw.length < 10) {
    throw new Error("bytecode 是空的：" + BYTECODE_FILE + "\n  " + COMPILE_HINT);
  }
  if (!raw.startsWith("0x")) {
    throw new Error("bytecode.txt 应该以 0x 开头");
  }
  return raw;
}

// 已知真链：chainId → 显示名。RPC 由 .env 的 SEPOLIA_RPC 指定（变量名沿用，指哪条链由它自己答）。
// 968 = BOT Chain 测试网（rpc.bohr.life，有免费水龙头）；677 = BOT Chain 主网（rpc.botchain.ai，主网 BOT 只能从官方 DEX 换）
const KNOWN_CHAINS = { 11155111: "Sepolia", 677: "BOT Chain Mainnet", 968: "BOT Chain Testnet" };

// 读操作自动重试：BOT Chain 主网 RPC 从本机实测会偶发 timeout（同一台机器上
// 裸 POST 1 秒就回，ethers 连打几个请求时会挂住），所以读一次不成就再读，别让部署栽在
// "读网络" 这种无副作用的一步上。★ 发交易不在这里自动重试 —— 重试可能变成重复部署。
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
  const rpc = process.env.SEPOLIA_RPC || "https://ethereum-sepolia-rpc.publicnode.com";

  if (!process.env.PRIVATE_KEY || !process.env.PRIVATE_KEY.startsWith("0x")) {
    throw new Error("请先在 .env 里填好 PRIVATE_KEY（0x 开头）");
  }

  const abi = readAbi();
  const bytecode = readBytecode();
  console.log("合约       :", CONTRACT_NAME + (VARIANT ? `（${VARIANT.toLowerCase()}）` : "（v1）"));
  console.log("ABI 条目数 :", abi.length);
  console.log("Bytecode   :", bytecode.length, "字符");
  console.log("RPC        :", rpc);

  // staticNetwork：ether 默认每次请求前后都要 eth_chainId/块高来回确认，链一慢就 timeout；
  // 固定住网络后只问一次，身份仍然照旧由 chainId + 块高双重确认（见下）。
  const provider = new JsonRpcProvider(rpc, undefined, { staticNetwork: true });
  const net = await retry("读网络", () => provider.getNetwork());
  const chainId = Number(net.chainId);
  const chainName = KNOWN_CHAINS[chainId];
  if (!chainName) {
    throw new Error(`⚠️ 当前 RPC 不是已知的真链（chainId=${chainId}）。已知：` +
      Object.entries(KNOWN_CHAINS).map(([k, v]) => `${v}(${k})`).join(" / "));
  }
  // A18：主网必须显式确认一次（deploy-multisig.js:147 已经有同一道闸）——
  // 误部署 = 一笔真 gas + 一个多出来的合约，发出去撤不回来。
  if (chainId === 677 && !YES_MAINNET) {
    throw new Error("主网 677 要加 --yes-mainnet 才发交易（防误发）");
  }
  // chainId 能被本地假链伪装（07-测试工具/prep_local_chain.js 就设成 11155111），块高不能：
  // 2026-10-06 实测 Sepolia 块高 1185 万+、BOT Chain 主网 2573 万+，本地假链从 0 开始。这里只把身份说清楚，本地联调照样能跑。
  const blockNumber = await retry("读块高", () => provider.getBlockNumber());
  const isRealChain = blockNumber >= 1000000;
  // A18：块高认不出真链时，原来只打印一句 ⚠️ 就照样往下部署 —— RPC 被指到一个伪装的链
  // （或配错成某个高度为 0 的链）上时，脚本会把合约"部署"到一个假地方还报成功。
  // 唯一的例外是本机回放（历史回放/分镜里的 http://127.0.0.1:8545|8546），按 RPC 是否本机放行。
  const isLocalRpc = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(rpc);
  if (!isRealChain && !isLocalRpc) {
    throw new Error(`块高只有 ${blockNumber}（< 1000000）且 RPC 不是本机地址：这不是真链，拒绝部署。` +
      `本机回放请把 SEPOLIA_RPC 指向 http://127.0.0.1:8545`);
  }
  const sym = chainId === 677 || chainId === 968 ? "BOT" : "SepETH";   // BOT Chain（主网 677 / 测试网 968）的原生代币叫 BOT，不是 SepETH
  console.log("网络       : " + (isRealChain
    ? `${chainName} (${chainId})`
    : `⚠️ 本地假链（块高 ${blockNumber}，chainId 被伪装成 ${chainId} = ${chainName}）—— 不是真链！`));

  const wallet = new Wallet(process.env.PRIVATE_KEY, provider);
  const balance = await retry("读余额", () => provider.getBalance(wallet.address));
  console.log("部署账户   :", wallet.address);
  console.log("账户余额   :", (Number(balance) / 1e18).toFixed(6), sym);

  if (balance === 0n) {
    throw new Error(`账户余额为 0 —— 这个地址在 ${chainName} 上没有 ${sym} 可付 gas，先领/申请 gas`);
  }

  console.log("\n正在部署，请稍候...");
  const factory = new ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy();
  const tx = contract.deploymentTransaction();
  console.log("交易哈希   :", tx.hash);
  console.log("等待确认（约 10~30 秒）...");

  // ★ 交易已经发出去了，这里再超时也【绝不能重发】—— 重发就是第二个合约、两笔 gas。
  //   万一超时，就拿上面这个哈希自己去浏览器查。
  try {
    await contract.waitForDeployment();
  } catch (e) {
    console.error(`\n⚠️ 等确认超时/失败：${e.shortMessage || e.message}`);
    console.error("   交易可能已经上链了 —— 别重跑本脚本，先拿这个哈希去浏览器查：");
    console.error("   " + tx.hash);
    process.exit(2);
  }
  const address = await contract.getAddress();

  console.log("\n✅ 部署成功");
  console.log("合约地址   :", address);
  console.log("交易哈希   :", tx.hash);

  console.log("\n【接下来三件事，按顺序做】");
  console.log("  ① 把合约地址填进 .env 的 CONTRACT_ADDRESS");
  console.log("  ② 喂价前必须先把资金池喂饱 —— 收到 1 份保费（0.001）却要赔 10 倍（0.01），");
  console.log("     池子是空的，第一笔赔付就会因 insufficient funds 失败。三种注资方式任选：");
  console.log(`       · 打开演示页面 → 「资金池」卡片 → 点「注资 0.05 ${sym}」`);
  console.log("       · 或 Remix 上调 fundPool() 并附带 value");
  console.log("  ③ npm run status   ← 确认合约状态、operator、池子余额都对");
  console.log("     npm run demo     ← 注入模拟暴雨，把 5 个区域的降雨推上去");

  console.log("\n【怎么确认链上真有了】");
  console.log("  双击  " + path.join(__dirname, "..", "06-核验台单文件", "汉客松-链上核验台.html"));
  console.log("  把上面那个合约地址粘进去 → 应该看到：");
  console.log("    这是不是合约 → 是合约 ✅");
  console.log("    合约代码长度 → 正整数（不是 0）");
  console.log("\n  （不要用 sepolia.otterscan.io —— 10/4 起它的后端节点挂了，页面会一直转圈）");

  console.log("\n【演示页面现在就打开】");
  console.log("  双击  " + path.join(__dirname, "..", "05-演示站点", "index.html"));
  console.log("  （或直接开线上版，手机也能看）");
}

main().catch((e) => {
  console.error("\n❌ 失败：", e.message || e);
  process.exit(1);
});
