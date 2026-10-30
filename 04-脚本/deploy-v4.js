#!/usr/bin/env node
/**
 * deploy-v4.js —— 独立部署「自造币栈」：RainToken + RainDeliveryInsuranceV4（2026-10-25）
 *
 * 顺序：检查余额 → 部署 RainToken（owner=deployer，可铸造演示资金）→ 部署 V4(token)
 *      → 打印两个地址与 .env 回填提示。不发其他交易（网格/注资/移交见带起手册）。
 *
 * 用法（04-脚本 目录）：
 *   node deploy-v4.js                 # 演练：只查链与余额
 *   node deploy-v4.js --send          # 真部署（968）；主网 677 另需 --yes-mainnet
 * 环境变量：PRIVATE_KEY（部署者）、SEPOLIA_RPC（目标链；968=https://rpc.bohr.life）
 */
"use strict";
const path = require("path");
const fs = require("fs");
const SCRIPTS = __dirname;
const ROOT = path.join(SCRIPTS, "..");
require(path.join(SCRIPTS, "node_modules", "dotenv")).config({ path: path.join(SCRIPTS, ".env") });
const { ethers } = require(path.join(SCRIPTS, "node_modules", "ethers"));

const send = process.argv.includes("--send");
const yesMainnet = process.argv.includes("--yes-mainnet");
const rpc = process.env.SEPOLIA_RPC || "https://rpc.bohr.life";

const T_ABI = JSON.parse(fs.readFileSync(path.join(ROOT, "03-合约", "RainToken.abi.json"), "utf8"));
const T_BIN = fs.readFileSync(path.join(ROOT, "03-合约", "RainToken.bytecode.txt"), "utf8").trim();
const V4_ABI = JSON.parse(fs.readFileSync(path.join(ROOT, "03-合约", "RainDeliveryInsuranceV4.abi.json"), "utf8"));
const V4_BIN = fs.readFileSync(path.join(ROOT, "03-合约", "RainDeliveryInsuranceV4.bytecode.txt"), "utf8").trim();

(async () => {
  const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true });
  const net = await provider.getNetwork();
  if (net.chainId === 677n && !yesMainnet) throw new Error("目标是主网 677：需要显式 --yes-mainnet");
  if (!process.env.PRIVATE_KEY) throw new Error("缺 PRIVATE_KEY（.env）");
  const w = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const bal = await provider.getBalance(w.address);
  console.log(`链 ${rpc} · chainId ${net.chainId}`);
  console.log(`部署者 ${w.address} · 余额 ${ethers.formatEther(bal)} 原生币`);
  console.log(`RainToken 运行时 ${fs.readFileSync(path.join(ROOT, "03-合约", "RainToken.runtime-size.txt"), "utf8").trim()} B · V4 运行时 ${fs.readFileSync(path.join(ROOT, "03-合约", "RainDeliveryInsuranceV4.runtime-size.txt"), "utf8").trim()} B`);
  if (bal === 0n) throw new Error("余额为 0：先到水龙头领取（968）或换有 gas 的账户");
  if (!send) { console.log("\n（演练通过。加 --send 真部署。）"); return; }

  console.log("\n① 部署 RainToken …");
  const tok = await new ethers.ContractFactory(T_ABI, T_BIN, w).deploy();
  await tok.waitForDeployment();
  const tokAddr = await tok.getAddress();
  console.log(`   RainToken = ${tokAddr} · tx ${tok.deploymentTransaction().hash}`);

  console.log("② 部署 RainDeliveryInsuranceV4(token) …");
  const v4 = await new ethers.ContractFactory(V4_ABI, V4_BIN, w).deploy(tokAddr);
  await v4.waitForDeployment();
  const v4Addr = await v4.getAddress();
  console.log(`   V4        = ${v4Addr} · tx ${v4.deploymentTransaction().hash}`);
  console.log(`   复核：token()=${await v4.token()} · PAYOUT_MAX=${await v4.PAYOUT_MAX()} 分 · operator=${await v4.operator()}`);

  console.log(`\n回填 04-脚本/.env：`);
  console.log(`TOKEN_ADDR=${tokAddr}`);
  console.log(`CONTRACT_ADDRESS=${v4Addr}`);
  console.log(`下一步（见 02-作战与答辩/独立部署-968-带起手册-2026-10-25.md）：部署多签 → transferOperator → setgrid-v4 → 注资喂价 → 闭环冒烟。`);
})().catch((e) => { console.error("💥 " + (e.shortMessage || e.message)); process.exit(1); });
