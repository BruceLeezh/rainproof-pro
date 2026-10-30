#!/usr/bin/env node
/**
 * setgrid-v4.js —— 给 v4 写 10 格人民币保费网格（12h/24h × 五城，单位=分）
 *
 * 值来自本仓人民币定价表（01-参赛材料/02-定价-人民币口径），取「众包·自助」段
 * （= v3 的 premiumOf(regionId, hours) 两参默认段，演示页与冒烟用的就是它）。
 * reasonHash = ethers.id(依据串)：同一张表任何人算出同一个哈希。
 *
 * 用法：node setgrid-v4.js [--apply] [--contract=0x…]
 */
"use strict";
const path = require("path");
const fs = require("fs");
const SCRIPTS = __dirname;
const ROOT = path.join(SCRIPTS, "..");
require(path.join(SCRIPTS, "node_modules", "dotenv")).config({ path: path.join(SCRIPTS, ".env") });
const { ethers } = require(path.join(SCRIPTS, "node_modules", "ethers"));

// 分（1 元 = 100）。来源：定价体系-人民币-数表.md「众包·自助」列，PAYOUT 满额 100 元口径
const GRID = {
  1: { 12: 590, 24: 880 }, // 武汉
  2: { 12: 420, 24: 530 }, // 上海
  3: { 12: 360, 24: 510 }, // 北京
  4: { 12: 590, 24: 790 }, // 广州
  5: { 12: 580, 24: 820 }, // 成都
};
const REGION_NAME = { 1: "武汉", 2: "上海", 3: "北京", 4: "广州", 5: "成都" };
const BASIS = "rainproof-v4 rmb grid 2026-10-25 · 众包自助段 · PAYOUT=10000分(100元) · source: rmb-pricing.js (E97.5 upper bound / R*=0.6)";

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const addr = (argv.find((a) => a.startsWith("--contract=")) || "").slice(11) || process.env.CONTRACT_ADDRESS;
if (!addr) { console.error("缺合约地址：--contract=0x… 或 .env 里 CONTRACT_ADDRESS"); process.exit(1); }

(async () => {
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC || "https://rpc.bohr.life", undefined, { staticNetwork: true });
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const abi = JSON.parse(fs.readFileSync(path.join(ROOT, "03-合约", "RainDeliveryInsuranceV4.abi.json"), "utf8"));
  const c = new ethers.Contract(addr, abi, wallet);
  const reasonHash = ethers.id(BASIS);
  console.log(`合约 ${addr} · signer ${wallet.address}`);
  console.log(`依据串：${BASIS}\nreasonHash：${reasonHash}\n`);
  let diff = 0;
  for (const region of Object.keys(GRID)) {
    for (const hours of [12, 24]) {
      const target = GRID[region][hours];
      const cur = await c.premiumOf(region, hours);
      const same = cur === BigInt(target);
      if (!same) diff++;
      console.log(`${REGION_NAME[region]} ${hours}h : 链上 ${cur} 分 → 目标 ${target} 分（${(target / 100).toFixed(2)} 元） ${same ? "✅" : "⬜待写"}`);
      if (apply && !same) {
        const tx = await c.setPremiumGrid(region, hours, target, reasonHash);
        const rc = await tx.wait();
        console.log(`   已写入 tx=${rc.hash}`);
      }
    }
  }
  console.log(apply ? "\n完成。" : `\n干跑：${diff} 格待写。加 --apply 真写（signer 须为 operator）。`);
})().catch((e) => { console.error("💥 " + (e.shortMessage || e.message)); process.exit(1); });
