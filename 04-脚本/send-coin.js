#!/usr/bin/env node
/**
 * send-coin.js —— 从项目已托管的钱包向任意地址转原生 BOT 或 ERC20（如 RDROP）。
 *
 * 背景：官方水龙头 faucet.botchain.ai 在 2026-11-07 从本机不可达（scan.bohr.life 同），
 * 而 owner 三把钥匙由 fund-v6-ops-gas.js 每轮自动补到 0.5 BOT、无需水龙头；
 * 真正需要领币的是「个人钱包」（浏览器扩展新建的账户），本工具用它从项目钱包转币过去，
 * 代替水龙头。典型用法见文末示例。
 *
 * 安全：dry-run 是默认；加 --send 才发交易。任何模式都不打印私钥。
 * 密钥来源（三选一）：
 *   --from=deployer   用 .env 的 PRIVATE_KEY（keeper/部署用钥匙，转出前自己留 ≥1 BOT）
 *   --from=demo       用演示钱包文件（DEMO_WALLET_FILE 或 ../雨证密钥/demo-wallet-2026-11-03.json）
 *   --key-file=<路径>  直接指定 {privateKey} 或 {accounts:[{privateKey}]} 结构的钱包 JSON
 *                     （owner-keys 结构配 --index=N 选第 N 把，默认 0）
 * 金额口径：原生币按 BOT（18 位）；--token=<地址> 按该代币 decimals（RDROP=2，自动读取）。
 *
 * 用法：
 *   node send-coin.js --from=deployer --to=0x… --amount=0.5                 # 干跑
 *   node send-coin.js --from=deployer --to=0x… --amount=0.5 --send          # 转 BOT
 *   node send-coin.js --from=demo --to=0x… --amount=25 --token=RDROP --send # 转 RDROP
 *   node send-coin.js --token=0x23e928922711903607031378005DFe29D9b730bD …  # 等价于 RDROP
 */
"use strict";
const path = require("path"), fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const { ethers } = require("ethers");
const { withRetry, provider: readProvider } = require("./rpc-read");

const ROOT = path.join(__dirname, "..");
const RDROP = "0x23e928922711903607031378005DFe29D9b730bD";
const DEPLOYER_KEEP = ethers.parseEther("1.0"); // deployer 是 keeper 签名钥匙，转出后至少留 1 BOT

const arg = (name) => (process.argv.find(a => a.startsWith(`--${name}=`)) || "").slice(name.length + 3) || undefined;
const has = (name) => process.argv.includes(`--${name}`);
const SEND = has("send");
const TO = arg("to"), AMOUNT = arg("amount"), TOKEN = arg("token"), KEY_FILE = arg("key-file"), INDEX = Number(arg("index") || 0);

function loadWallet() {
  if (KEY_FILE) {
    const j = JSON.parse(fs.readFileSync(KEY_FILE, "utf8"));
    if (Array.isArray(j.accounts)) {
      const acc = j.accounts[INDEX];
      if (!acc) throw new Error(`--index=${INDEX} 超出 ${path.basename(KEY_FILE)} 的 accounts 范围`);
      return { pk: acc.privateKey, label: `${path.basename(KEY_FILE)}#${INDEX}` };
    }
    if (j.privateKey) return { pk: j.privateKey, label: path.basename(KEY_FILE) };
    throw new Error("key-file 结构不认识（需要 privateKey 或 accounts[]）");
  }
  if (arg("from") === "demo") {
    const f = process.env.DEMO_WALLET_FILE || path.join(ROOT, "..", "雨证密钥", "demo-wallet-2026-11-03.json");
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    if (!j.privateKey) throw new Error("演示钱包文件缺 privateKey 字段");
    return { pk: j.privateKey, label: "demo-wallet" };
  }
  // 默认 deployer：与 fund-v6-ops-gas.js 同源，转出前保留 keeper gas 底仓
  if (!process.env.PRIVATE_KEY) throw new Error(".env 缺 PRIVATE_KEY（或改用 --from=demo / --key-file=…）");
  return { pk: process.env.PRIVATE_KEY, label: "deployer" };
}

(async () => {
  if (!TO || !ethers.isAddress(TO)) throw new Error("缺 --to=<0x…> 或地址非法");
  if (!AMOUNT || !(Number(AMOUNT) > 0)) throw new Error("缺 --amount=<正数>");
  if (!["deployer", "demo", undefined].includes(arg("from")) && !KEY_FILE) throw new Error("--from 只支持 deployer|demo，或改用 --key-file=");

  const provider = readProvider(ethers, process.env.SEPOLIA_RPC || "https://rpc.bohr.life");
  try {
    if ((await withRetry(() => provider.getNetwork())).chainId !== 968n) throw new Error("仅限测试网 968");
    const { pk, label } = loadWallet();
    const wallet = new ethers.Wallet(pk, provider);
    const from = await withRetry(() => wallet.getAddress());
    const to = ethers.getAddress(TO);

    const isToken = !!TOKEN;
    const tokenAddr = isToken ? (TOKEN.toLowerCase() === "rdrop" ? RDROP : ethers.getAddress(TOKEN)) : null;
    let amount, unit, tokenMeta = "";
    if (isToken) {
      const t = new ethers.Contract(tokenAddr, [
        "function decimals() view returns(uint8)", "function symbol() view returns(string)",
        "function balanceOf(address) view returns(uint256)", "function transfer(address,uint256) returns(bool)",
      ], wallet);
      const [decimals, symbol, fromBal, toBal] = await Promise.all([
        withRetry(() => t.decimals()), withRetry(() => t.symbol()).catch(() => "TOKEN"),
        withRetry(() => t.balanceOf(from)), withRetry(() => t.balanceOf(to)),
      ]);
      amount = ethers.parseUnits(AMOUNT, decimals);
      unit = symbol;
      tokenMeta = ` · 对方现有 ${ethers.formatUnits(toBal, decimals)} ${symbol}`;
      console.log(`代币 ${symbol}(${tokenAddr}) · 精度 ${decimals}${tokenMeta}`);
      if (fromBal < amount) throw new Error(`余额不足：现有 ${ethers.formatUnits(fromBal, decimals)} ${symbol} < ${AMOUNT}`);
    } else {
      amount = ethers.parseEther(AMOUNT);
      unit = "BOT";
    }
    const fromBot = ethers.formatEther(await withRetry(() => provider.getBalance(from)));
    const toBot = ethers.formatEther(await withRetry(() => provider.getBalance(to)));
    console.log(`来源  : ${label} ${from}（${fromBot} BOT）`);
    console.log(`目标  : ${to}（${toBot} BOT）`);
    console.log(`转出  : ${AMOUNT} ${unit}${isToken ? "" : ""}`);
    if (!isToken) {
      if (from === to) throw new Error("来源与目标是同一地址");
      const bal = await withRetry(() => provider.getBalance(from));
      if (bal < amount) throw new Error(`余额不足：${fromBot} BOT < ${AMOUNT} BOT`);
      if (label === "deployer" && bal - amount < DEPLOYER_KEEP) {
        throw new Error(`deployer 转出后只剩 ${ethers.formatEther(bal - amount)} BOT，低于 keeper 底仓 1.0 —— 减小金额或先补水`);
      }
    }
    if (!SEND) {
      console.log("\n（干跑：确认无误后加 --send 发交易）");
      return;
    }
    let tx;
    if (isToken) {
      const t = new ethers.Contract(tokenAddr, ["function transfer(address,uint256) returns(bool)"], wallet);
      tx = await withRetry(() => t.transfer(to, amount));
    } else {
      tx = await wallet.sendTransaction({ to, value: amount });
    }
    console.log(`tx    : ${tx.hash} 已广播，等待确认…`);
    const rc = await tx.wait();
    if (!rc || rc.status !== 1) throw new Error("交易未成功确认");
    console.log(`✅ 已确认（区块 ${rc.blockNumber} · gas ${rc.gasUsed}）—— ${AMOUNT} ${unit} → ${to}`);
  } finally { provider.destroy(); }
})().catch(e => { console.error("💥", e.shortMessage || e.message); process.exitCode = 1; });
