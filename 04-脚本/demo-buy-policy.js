#!/usr/bin/env node
/**
 * demo-buy-policy.js —— 演示钱包真实投保（A 方案）
 *
 * 在 968 测试网留下真实链上保单（模拟 RDROP 付款，非真实资金）：
 *   ① 生成/读取演示钱包（私钥存 Desktop/雨证密钥/，绝不入库）
 *   ② 部署器转 0.05 BOT gas 给演示钱包
 *   ③ 多签两票 mint 3000 分（30 元模拟 RDROP）给演示钱包
 *   ④ 演示钱包 approve + buyPolicy（默认：武汉 420100/24h + 广州 440100/12h）
 *   ⑤ 读回 policies()/policyStatus() 验证（T+1：effectiveFrom = 买入 + 86400s）
 *
 * 用法：
 *   node 04-脚本/demo-buy-policy.js            # 干跑：只打印计划
 *   node 04-脚本/demo-buy-policy.js --send     # 真发
 * 幂等：mint/approve 余额足够时跳过；买过的区划+时长组合不重复买。
 */
"use strict";
const fs = require("fs"), path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const { ethers } = require("ethers");
const { withRetry } = require("./rpc-read");
const { submittedTxId } = require("./multisig-receipt");

const ROOT = path.resolve(__dirname, "..");
const SEND = process.argv.includes("--send");
const V6 = process.env.CONTRACT_ADDRESS_V6;
const TOKEN = process.env.TOKEN_ADDR;
const MS = process.env.MULTISIG_ADDR || "0x21C8520D486be3805Cf3FaA7cCab896241410d98";
const KEY_FILE = path.join(ROOT, "..", "密钥-本地", "owner-keys-2026-10-24.json");
const DEMO_FILE = path.join(ROOT, "..", "雨证密钥", "demo-wallet-2026-11-03.json");
const GAS_TOPUP = ethers.parseEther("0.05");
const MINT_AMOUNT = 3000n; // 分 = 30 元模拟 RDROP
const BUYS = [
  { code: 420100, hours: 24, label: "武汉 24h" },
  { code: 440100, hours: 12, label: "广州 12h" },
];

const log = (...a) => console.log(...a);

(async () => {
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC || "https://rpc.bohr.life", undefined, { staticNetwork: true });
  const abiV6 = JSON.parse(fs.readFileSync(path.join(ROOT, "03-合约/RainDeliveryInsuranceV6.abi.json"), "utf8"));
  const abiMs = JSON.parse(fs.readFileSync(path.join(ROOT, "03-合约/OperatorMultisig.abi.json"), "utf8"));
  const abiTok = JSON.parse(fs.readFileSync(path.join(ROOT, "03-合约/RainToken.abi.json"), "utf8"));
  const v6 = new ethers.Contract(V6, abiV6, provider);
  const token = new ethers.Contract(TOKEN, abiTok, provider);
  const ms = new ethers.Contract(MS, abiMs, provider);
  const deployer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  // ① 演示钱包
  let demo;
  if (fs.existsSync(DEMO_FILE)) {
    demo = new ethers.Wallet(JSON.parse(fs.readFileSync(DEMO_FILE, "utf8")).privateKey, provider);
    log(`演示钱包（已存在）：${demo.address}`);
  } else if (SEND) {
    const w = ethers.Wallet.createRandom();
    fs.mkdirSync(path.dirname(DEMO_FILE), { recursive: true });
    fs.writeFileSync(DEMO_FILE, JSON.stringify({ address: w.address, privateKey: w.privateKey, note: "雨证演示钱包（模拟资金）；勿删除、勿提交" }, null, 2));
    demo = new ethers.Wallet(w.privateKey, provider);
    log(`演示钱包（新生成）：${demo.address}`);
  } else {
    log("演示钱包：干跑模式尚未生成（--send 时生成到 Desktop/雨证密钥/）");
    demo = null;
  }

  const msBal = await withRetry(() => token.balanceOf(MS));
  const demoRd = demo ? await withRetry(() => token.balanceOf(demo.address)) : 0n;
  log(`多签 RDROP=${Number(msBal) / 100} 元 · 演示钱包 RDROP=${Number(demoRd) / 100} 元`);

  // ② gas 充值
  if (demo) {
    const gasBal = await withRetry(() => provider.getBalance(demo.address));
    log(`演示钱包 BOT=${ethers.formatEther(gasBal)}`);
    if (gasBal < ethers.parseEther("0.02")) {
      if (!SEND) log("  · [dry] deployer → demo 0.05 BOT");
      else {
        const tx = await deployer.sendTransaction({ to: demo.address, value: GAS_TOPUP });
        await tx.wait();
        log(`  ✓ gas 充值 ${tx.hash}`);
      }
    } else log("  · gas 充足，跳过充值");
  }

  // ③ 两票 mint（幂等：演示钱包已有 ≥3000 分则跳过）
  const owners = JSON.parse(fs.readFileSync(KEY_FILE, "utf8")).accounts;
  const threshold = Number(await withRetry(() => ms.threshold()));
  const signers = owners.slice(0, threshold).map((k) => new ethers.Wallet(k.privateKey, provider));
  const mintNeeded = Number(demoRd) < Number(MINT_AMOUNT);
  if (mintNeeded) {
    if (!SEND) log(`  · [dry] 两票 mint(demo, ${MINT_AMOUNT}) = ${Number(MINT_AMOUNT) / 100} 元`);
    else await twoVote(token, "mint", [demo.address, MINT_AMOUNT], "mint RDROP");
  } else log("  · RDROP 充足，跳过 mint");

  // ④ 授权 + 投保（owners/threshold/signers 已在 ③ 前初始化）
  async function twoVote(contract, fn, args, label) {
    const data = contract.interface.encodeFunctionData(fn, args);
    const tx = await ms.connect(signers[0]).submit(contract.target, 0, data);
    const rc1 = await tx.wait();
    const txId = await submittedTxId(ms, rc1, contract.target, data);
    let executed = false;
    for (const s of signers.slice(1)) {
      const c = await ms.connect(s).confirm(txId);
      const rc = await c.wait();
      if (rc.status === 1) { /* 继续 */ }
    }
    const t = await withRetry(() => ms.getTx(txId));
    executed = Boolean(t[4]);
    if (!executed) throw new Error(`${label} 两票后未执行`);
    log(`  ✓ ${label} txId=${txId} submit=${tx.hash.slice(0, 10)}… executed=true`);
    return txId;
  }

  for (const b of BUYS) {
    if (!demo) { log(`  · [dry] ${b.label}（${b.code}/${b.hours}h）`); continue; }
    let price;
    try { price = await withRetry(() => v6.premiumOf(b.code, b.hours)); } catch (e) { log(`  ✗ ${b.label} 读取保费失败：${e.message}`); continue; }
    const allowance = await withRetry(() => token.allowance(demo.address, V6));
    if (allowance < price) {
      if (!SEND) { log(`  · [dry] approve ${Number(MINT_AMOUNT) / 100} 元`); }
      else {
        const tx = await token.connect(demo).approve(V6, MINT_AMOUNT);
        await tx.wait();
        log(`  ✓ approve ${Number(MINT_AMOUNT) / 100} 元 ${tx.hash}`);
      }
    }
    if (!SEND) { log(`  · [dry] buyPolicy(${b.code}, ${b.hours}) 价格 ${Number(price) / 100} 元`); continue; }
    try {
      const tx = await v6.connect(demo).buyPolicy(b.code, b.hours);
      const rc = await tx.wait();
      const id = (await withRetry(() => v6.policiesOf(demo.address)));
      const pid = id.length ? Number(id[id.length - 1]) : null;
      log(`  ✓ ${b.label} 已投保 tx=${tx.hash} policyId=${pid} 价 ${Number(price) / 100} 元 gas=${rc.gasUsed}`);
    } catch (e) {
      const msg = e.shortMessage || e.message || "";
      log(`  ✗ ${b.label} 投保失败：${msg.slice(0, 120)}`);
      if (/already|duplicate|exist/i.test(msg)) continue;
      throw e;
    }
  }

  // ⑤ 读回验证
  if (SEND && demo) {
    const ids = await withRetry(() => v6.policiesOf(demo.address));
    log(`\n演示钱包保单数：${ids.length}`);
    for (const id of ids) {
      const p = await withRetry(() => v6.policies(id));
      const st = await withRetry(() => v6.policyStatus(id));
      log(`  #${id} rider=${p.rider} region=${p.regionId} ${p.windowHours}h premium=${Number(p.premium) / 100}元 effectiveFrom=${new Date(Number(p.effectiveFrom) * 1000 + 8 * 3600e3).toISOString().slice(0, 16)} status=${st}`);
    }
    log("\n提醒：保单 24h 后生效；材料「零保单」口径需改为「演示保单 " + ids.length + " 张」。");
  }
})().catch((e) => { console.error("💥 " + (e.shortMessage || e.message)); process.exit(1); });
