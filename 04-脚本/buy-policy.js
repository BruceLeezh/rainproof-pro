#!/usr/bin/env node
/**
 * buy-policy.js —— 单张投保（给现场/补单用，默认只预览）
 *
 * 用法（必须在本目录下跑，ethers 在 04-脚本/node_modules）：
 *   node buy-policy.js 420113 24            # 预览：价格、余额、授权、窗口、是否可投
 *   node buy-policy.js 420113 24 --send     # 真买（approve 不够就先 approve，再 buyPolicy）
 *   node buy-policy.js 420113 24 --key=../雨证密钥/xxx.json   # 换签名钱包（默认演示钱包）
 *
 * 这是 buyPolicy 直购（payer 与 rider 同一个人）。给骑手代买请走 buyFor（batch-buy.js）。
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const ROOT = path.resolve(__dirname, "..");
const DEP = JSON.parse(fs.readFileSync(path.join(ROOT, "deployment.json"), "utf8"));
const { REGION_BY_CODE } = require("./regions.js");
const ABI = JSON.parse(fs.readFileSync(path.join(ROOT, "03-合约/RainDeliveryInsuranceV6.abi.json"), "utf8"));

const args = process.argv.slice(2);
const regionId = Number(args[0]);
const hours = Number(args[1]);
const SEND = args.includes("--send");
const keyArg = (args.find(a => a.startsWith("--key=")) || "").slice(6);

if (!Number.isInteger(regionId) || regionId <= 0 || !Number.isInteger(hours) || hours <= 0) {
  console.error("用法: node buy-policy.js <regionId> <hours> [--send] [--key=path]");
  process.exit(1);
}

const KEY_FILE = keyArg
  ? path.resolve(__dirname, keyArg)
  : "C:/Users/lenovo/Desktop/雨证密钥/demo-wallet-2026-11-03.json";

function loadKey(file) {
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  // 兼容四种写法：裸私钥串 / {privateKey} / {accounts:[{privateKey}]}
  if (typeof j === "string") return j;
  if (j.privateKey) return j.privateKey;
  if (Array.isArray(j.accounts) && j.accounts[0] && j.accounts[0].privateKey) return j.accounts[0].privateKey;
  throw new Error("无法从密钥文件读出私钥: " + file);
}

const money = fen => Number(ethers.formatUnits(fen, 2)).toFixed(2);
const fmtTime = sec => {
  const d = new Date(Number(sec) * 1000 + 8 * 3600e3);
  return d.toISOString().replace("T", " ").slice(0, 19).replace(/-/g, "-") + " (北京)";
};

(async () => {
  const provider = new ethers.JsonRpcProvider(DEP.rpc, DEP.chainId, { staticNetwork: true });
  const wallet = new ethers.Wallet(loadKey(KEY_FILE), provider);
  const c = new ethers.Contract(DEP.contract, ABI, provider);
  const token = new ethers.Contract(DEP.token, [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
  ], provider);

  const [price, maxAge, maxPolicies, lastFeed, openCount, bal, allow, gas] = await Promise.all([
    c["premiumOf(uint32,uint256)"](regionId, hours),
    c.MAX_FEED_AGE(),
    c.MAX_POLICIES_PER_RIDER(),
    c.lastFeedAt(regionId),
    c.openPoliciesOf(wallet.address),
    token.balanceOf(wallet.address),
    token.allowance(wallet.address, DEP.contract),
    provider.getBalance(wallet.address),
  ]);

  const now = Math.floor(Date.now() / 1000);
  const ageH = Number(lastFeed) === 0 ? Infinity : (now - Number(lastFeed)) / 3600;
  const fresh = ageH <= Number(maxAge) / 3600;
  let name = (REGION_BY_CODE[regionId] || REGION_BY_CODE[String(regionId)] || {}).name || "";
  if (!name) { try { name = String((await c.regions(regionId))[0] || ""); } catch (_) {} }

  console.log("—— 投保预检 ——");
  console.log(`钱包        ${wallet.address}`);
  console.log(`区划        ${name || "?"} (${regionId})`);
  console.log(`时长        ${hours} 小时`);
  console.log(`保费        ${money(price)} RDROP`);
  console.log(`喂价年龄    ${Number(lastFeed) === 0 ? "从未喂价" : ageH.toFixed(1) + "h"}（上限 ${Number(maxAge) / 3600}h）→ ${fresh ? "✅ 可投" : "⛔ 不可投，先补喂"}`);
  console.log(`未结清保单  ${openCount} / ${maxPolicies}`);
  console.log(`RDROP       ${money(bal)}（${bal >= price ? "够" : "不够，差 " + money(price - bal)}）`);
  console.log(`已授权      ${money(allow)}${allow >= price ? "（够）" : "（需再授权）"}`);
  console.log(`BOT(gas)    ${Number(ethers.formatEther(gas)).toFixed(4)}`);

  const ok = fresh && bal >= price && Number(openCount) < Number(maxPolicies);
  if (!ok) {
    console.log("\n结论：现在不能买（见上面 ⛔/不够 的行）。");
    process.exit(2);
  }
  if (!SEND) {
    console.log("\n结论：可以买。加 --send 真正上链。");
    return;
  }

  // 1) 授权不够就先 approve
  if (allow < price) {
    console.log("\n① approve …");
    const t1 = await token.connect(wallet).approve(DEP.contract, ethers.MaxUint256);
    const r1 = await t1.wait();
    console.log(`   approve 上链 block ${r1.blockNumber} gasUsed ${r1.gasUsed}`);
  }

  // 2) 买
  console.log("② buyPolicy …");
  const cw = c.connect(wallet);
  const t2 = await cw["buyPolicy(uint32,uint256)"](regionId, hours);
  const r2 = await t2.wait();
  let policyId = null;
  for (const log of r2.logs) {
    try {
      const p = c.interface.parseLog(log);
      if (p && p.name && /PolicyBought|PolicyIssued/i.test(p.name)) policyId = p.args[0].toString();
    } catch (_) {}
  }
  if (policyId === null) policyId = (Number(await c.nextPolicyId()) - 1).toString();

  const p = await c.policies(policyId);
  console.log("\n—— 买到了 ——");
  console.log(`保单号      #${policyId}`);
  console.log(`交易        ${r2.hash}`);
  console.log(`区块        ${r2.blockNumber}（gasUsed ${r2.gasUsed}）`);
  console.log(`保费        ${money(p.premium)} RDROP`);
  console.log(`生效        ${fmtTime(p.effectiveFrom)}`);
  console.log(`到期        ${fmtTime(p.endTime)}`);
  console.log(`基线雨量    ${p.rainfallAtBuy} mm（买入时刻）`);
  console.log(`状态        ${p.settled ? "已结清" : "保障中/待生效"}`);
})().catch(e => {
  console.error("💥", e.shortMessage || e.message);
  process.exit(1);
});
