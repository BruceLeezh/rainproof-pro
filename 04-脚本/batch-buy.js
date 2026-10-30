#!/usr/bin/env node
/**
 * batch-buy.js —— 平台批量投保执行器（buyFor · 平台团体/代付段，2026-10-25）
 *
 * 平台控制台（console.html）生成计划后由本脚本落地：读骑手地址名单 → 一次性 approve 总额
 * → 逐行 buyFor(骑手, 城市, 时长, riderTier=2, channel=1, count=1)。
 * 计价 RDROP（分）。平台钱包 = .env 的 PRIVATE_KEY（需有少量原生币付 gas 与足量 RDROP）。
 *
 * 用法：node batch-buy.js --city=2 --hours=12 --file=riders.txt [--dry]
 *   riders.txt：每行一个 0x 地址；--dry 只算价与总额，不发包。
 */
"use strict";
const path = require("path");
const fs = require("fs");
require(path.join(__dirname, "node_modules", "dotenv")).config({ path: path.join(__dirname, ".env") });
const ACTIVE = require("./active-deployment").applyDeployment();
const { ethers } = require(path.join(__dirname, "node_modules", "ethers"));

const argv = Object.fromEntries(process.argv.slice(2).filter(a => a.includes("=")).map(a => [a.split("=")[0].replace(/^-+/, ""), a.split("=")[1] ?? true]));
// v5：regionId = 民政部区划码（不是 1..5 序号）。--city 可写序号 1..6 或直接写区划码。
const CITIES = [
  { code: 420100, name: "武汉" }, { code: 310100, name: "上海" }, { code: 110100, name: "北京" },
  { code: 440100, name: "广州" }, { code: 510100, name: "成都" }, { code: 330782, name: "义乌" },
];
const cityArg = Number(argv.city || 2);
const city = CITIES[cityArg - 1] && cityArg >= 1 && cityArg <= CITIES.length
  ? CITIES[cityArg - 1].code
  : cityArg;
const hours = Number(argv.hours || 12);
const dry = argv.dry !== undefined || process.argv.includes("--dry");

(async () => {
  if (!Number.isInteger(city) || city < 100000 || city > 999999) throw new Error("--city <1..6 序号 或 区划码>");
  if (![12, 24].includes(hours)) throw new Error("--hours 12|24");
  const file = argv.file;
  if (!file || !fs.existsSync(file)) throw new Error("--file=<地址名单路径>（每行一个 0x 地址）");
  const riders = require("../05-演示站点/runtime.js").addresses(fs.readFileSync(file, "utf8"), ethers);
  if (!riders.length) throw new Error("名单里没有合法地址");
  const dup = riders.length !== new Set(riders.map(r => r.toLowerCase())).size;
  if (dup) throw new Error("名单里有重复地址（同一骑手会被限购闸挡住，先去重）");

  const p = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC || "https://rpc.bohr.life", undefined, { staticNetwork: true });
  if(Number((await p.getNetwork()).chainId)!==968) throw new Error("batch-buy requires chain 968");
  const w = new ethers.Wallet(process.env.PRIVATE_KEY, p);
  const V = new ethers.Contract(process.env.CONTRACT_ADDRESS, require(path.join(__dirname, "..", "03-合约", (ACTIVE.version === "V6" ? "RainDeliveryInsuranceV6.abi.json" : "RainDeliveryInsuranceV5.abi.json"))), w);
  const T = new ethers.Contract(process.env.TOKEN_ADDR, require(path.join(__dirname, "..", "03-合约", "RainToken.abi.json")), w);

  const unit = await V.premiumOf(city, hours, 2, 1, 1);       // 平台团体·代付段
  const total = unit * BigInt(riders.length);
  console.log(`平台 ${w.address}`);
  console.log(`${(CITIES.find((c) => c.code === city) || {}).name || city} ${hours}h · 单价 ${unit} 分（${(Number(unit) / 100).toFixed(2)} 元）× ${riders.length} 人 = ${total} 分（${(Number(total) / 100).toFixed(2)} 元）`);
  const bal = await T.balanceOf(w.address);
  console.log(`平台 RDROP 余额 ${bal} 分 ${bal < total ? "· ⚠️ 不足，先找多签铸造" : "· 足够"}`);
  if (dry) { console.log("（--dry：不发包）"); return; }

  console.log("① approve 总额 …");
  await (await T.approve(await V.getAddress(), total)).wait();
  console.log("② 逐行 buyFor …");
  let done = 0;
  for (const r of riders) {
    const tx = await V.buyFor(r, city, hours, 2, 1, 1);
    await tx.wait(); done++;
    console.log(`  ${done}/${riders.length} ${r} · tx ${tx.hash}`);
  }
  console.log(`✅ 批量完成：${riders.length} 份，合计 ${total} 分。池前余额复核：平台剩 ${await T.balanceOf(w.address)} 分。`);
})().catch(e => { console.error("💥 " + (e.shortMessage || e.message)); process.exit(1); });
