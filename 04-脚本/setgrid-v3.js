#!/usr/bin/env node
/**
 * setgrid-v3.js —— 给独立部署的 v3 写 10 格保费网格（12h/24h × 五城）
 *
 * 复刻 677 主网 v3 的那套网格值（README §3 记录），依据串 = 本文件内的 GRID 表 +
 * 数据来源说明，reasonHash = ethers.id(依据串)——任何人拿同一张表能算出同一个哈希。
 *
 * 用法（04-脚本 目录）：
 *   node setgrid-v3.js                 # 只读：逐格打印链上现价 vs 目标价
 *   node setgrid-v3.js --apply         # 真写（operator；多签接管前=deployer，接管后走 mscall）
 *   node setgrid-v3.js --contract=0x…  # 不设 CONTRACT_ADDRESS 时显式给
 */
"use strict";
const path = require("path");
const fs = require("fs");
const SCRIPTS = __dirname;
const ROOT = path.join(SCRIPTS, "..");
require(path.join(SCRIPTS, "node_modules", "dotenv")).config({ path: path.join(SCRIPTS, ".env") });
const { ethers } = require(path.join(SCRIPTS, "node_modules", "ethers"));

// 值与 677 主网 v3 网格一致（单位 wei）；区域号 = regions.js 的 1..5（武汉/上海/北京/广州/成都）
const GRID = {
  1: { 12: "760000000000000",  24: "1050000000000000" }, // 武汉
  2: { 12: "590000000000000",  24: "700000000000000"  }, // 上海
  3: { 12: "530000000000000",  24: "680000000000000"  }, // 北京
  4: { 12: "770000000000000",  24: "970000000000000"  }, // 广州
  5: { 12: "750000000000000",  24: "990000000000000"  }, // 成都
};
const REGION_NAME = { 1: "武汉", 2: "上海", 3: "北京", 4: "广州", 5: "成都" };
const BASIS = "rainproof-independent-968 grid baseline 2026-10-25 · values mirror BOT677 v3 grid (README §3) · source: 10-金融与定价 pricing engine";

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const addr = (argv.find((a) => a.startsWith("--contract=")) || "").slice(11) || process.env.CONTRACT_ADDRESS;
if (!addr) { console.error("缺合约地址：--contract=0x… 或 .env 里 CONTRACT_ADDRESS"); process.exit(1); }

(async () => {
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC || "https://rpc.bohr.life", undefined, { staticNetwork: true });
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const abi = JSON.parse(fs.readFileSync(path.join(ROOT, "03-合约", "RainDeliveryInsuranceV3.abi.json"), "utf8"));
  const c = new ethers.Contract(addr, abi, wallet);
  const reasonHash = ethers.id(BASIS);
  console.log(`合约 ${addr} · chainId ${(await provider.getNetwork()).chainId} · signer ${wallet.address}`);
  console.log(`依据串：${BASIS}\nreasonHash：${reasonHash}\n`);

  let diff = 0;
  for (const region of Object.keys(GRID)) {
    for (const hours of [12, 24]) {
      const target = GRID[region][hours];
      const cur = await c.premiumOf(region, hours);
      const same = cur.toString() === target;
      if (!same) diff++;
      console.log(`${REGION_NAME[region]} ${hours}h : 链上 ${ethers.formatEther(cur)} → 目标 ${ethers.formatEther(target)} ${same ? "✅一致" : "⬜待写"}`);
      if (apply && !same) {
        const tx = await c.setPremiumGrid(region, hours, target, reasonHash);
        const rc = await tx.wait();
        console.log(`   已写入 tx=${rc.hash} · gas ${rc.gasUsed}`);
      }
    }
  }
  console.log(apply ? "\n完成。" : `\n干跑：${diff} 格待写。加 --apply 真写（当前 signer 必须是 operator）。`);
})().catch((e) => { console.error("💥 " + (e.shortMessage || e.message)); process.exit(1); });
