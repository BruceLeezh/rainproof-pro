// 通过 2/3 多签调用 v5 承保合约的 onlyOperator 动作（喂价/判定/设档/提款/暂停…都得走这里）。
// operator 是多签 0x21C8…0d98；.env 里的 PRIVATE_KEY/RIDER_KEY **不是** owner，直接发会 revert。
// 两票来自仓库外 密钥-本地/owner-keys-2026-10-24.json 的 accounts[0] 提交、accounts[1] 确认。
//
// 用法（默认干跑，只打印 calldata；加 --send 才真发）：
//   node 07-测试工具/multisig-call.js setCoolingPeriod 0
//   node 07-测试工具/multisig-call.js setPremiumGrid 330782 12 800 0x<32字节reason>
//   node 07-测试工具/multisig-call.js submitJudgement 0 1 91 3 0x… 0x… 0x… 553 --send
// 参数按 v5 ABI 的类型自动编码（数字→uint/int，true/false→bool，0x…按类型给 bytes32/address/string）。
// 环境变量：OWNER_KEY_FILE 换密钥文件；CONTRACT_ADDRESS 覆盖目标合约。
const path = require("path");
const fs = require("fs");
const SCRIPTS = path.join(__dirname, "..", "04-脚本");
const ROOT = path.join(__dirname, "..");
require(path.join(SCRIPTS, "node_modules", "dotenv")).config({ path: path.join(SCRIPTS, ".env") });
const { ethers } = require(path.join(SCRIPTS, "node_modules", "ethers"));

const argv = process.argv.slice(2);
const send = argv.includes("--send");
const rest = argv.filter((a) => a !== "--send");
const [fn, ...rawArgs] = rest;
if (!fn || fn.startsWith("--")) {
  console.error("用法：node 07-测试工具/multisig-call.js <v5 函数名> [参数…] [--send]");
  process.exit(1);
}

const KEY_FILE = process.env.OWNER_KEY_FILE || "C:/Users/lenovo/Desktop/汉客松/密钥-本地/owner-keys-2026-10-24.json";
const TARGET = process.env.CONTRACT_ADDRESS;

(async () => {
  if (!TARGET) throw new Error("04-脚本/.env 缺 CONTRACT_ADDRESS");
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC || "https://rpc.bohr.life", undefined, { staticNetwork: true });
  const abiV5 = JSON.parse(fs.readFileSync(path.join(ROOT, "03-合约", "RainDeliveryInsuranceV5.abi.json"), "utf8"));
  const abiMs = JSON.parse(fs.readFileSync(path.join(ROOT, "03-合约", "OperatorMultisig.abi.json"), "utf8"));
  const iface = new ethers.Interface(abiV5);

  const f = iface.getFunction(fn);
  if (!f) throw new Error(`v5 ABI 里没有 ${fn}`);
  if (rawArgs.length !== f.inputs.length) throw new Error(`${fn} 需要 ${f.inputs.length} 个参数，给了 ${rawArgs.length}`);

  const args = rawArgs.map((v, i) => {
    const type = f.inputs[i].type;
    if (type === "bool") return v === "true" || v === "1";
    if (type.startsWith("uint") || type.startsWith("int")) return BigInt(v);
    if (type === "address") return ethers.getAddress(v);
    return v; // bytes32 / bytes / string 原样
  });
  const data = iface.encodeFunctionData(fn, args);

  const ms = new ethers.Contract(process.env.MULTISIG_ADDR || "0x21C8520D486be3805Cf3FaA7cCab896241410d98", abiMs, provider);
  const threshold = Number(await ms.threshold());

  console.log(`目标 v5 : ${TARGET}`);
  console.log(`多签    : ${await ms.getAddress()}（${threshold}/${(await ms.getOwners()).length}）`);
  console.log(`调用    : ${fn}(${args.map((x) => (typeof x === "bigint" ? x.toString() : x)).join(", ")})`);
  console.log(`calldata: ${data}`);
  if (!send) { console.log("\n（干跑：加 --send 走两票上链）"); return; }

  const owners = JSON.parse(fs.readFileSync(KEY_FILE, "utf8")).accounts;
  if (owners.length < threshold) throw new Error(`密钥文件只有 ${owners.length} 把，阈值 ${threshold}`);
  const signers = owners.slice(0, threshold).map((k) => new ethers.Wallet(k.privateKey, provider));
  const ownerSet = new Set((await ms.getOwners()).map((x) => x.toLowerCase()));
  for (const s of signers) if (!ownerSet.has(s.address.toLowerCase())) throw new Error(`${s.address} 不是多签 owner`);

  const sTx = await ms.connect(signers[0]).submit(TARGET, 0, data);
  await sTx.wait();
  const txId = Number(await ms.txCount()) - 1;   // submit 已回到链上，txCount 递增 1
  console.log(`\nsubmit  : ${sTx.hash} ⇒ txId ${txId}`);
  for (const s of signers.slice(1)) {
    const cTx = await ms.connect(s).confirm(txId);
    const rc = await cTx.wait();
    console.log(`confirm : ${cTx.hash}（区块 ${rc.blockNumber} · gas ${rc.gasUsed} · ${s.address}）`);
  }
  const t = await ms.getTx(txId);
  console.log(`结果    : executed=${t[4]} · confirmations=${t[3]}`);
  if (!t[4]) console.log("⚠️ 还没执行 —— 票数不够？再看一眼 getTx / threshold。");
})().catch((e) => { console.error("💥 " + (e.shortMessage || e.message)); process.exit(1); });
