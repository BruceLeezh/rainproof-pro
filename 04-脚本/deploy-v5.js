#!/usr/bin/env node
/**
 * deploy-v5.js —— v5 全国区域版上线（2026-10-26）
 *
 * 步骤：① 部署 V5(RDROP) ② 注册 6 区域（5 城 + 县级市义乌 330782）
 *      ③ 五城网格（=setgrid-v4 同值）④ 基线喂价（v4 现值迁移 + 义乌按三模型全季累计，evidence 记来源）
 *      ⑤ transferOperator → 多签
 * 迁移说明：v5 是新合约，rainfall 从 0 起算 —— 用 v4 现值做种子（evidenceHash 写明
 *           "migrated-from-v4"，可复核）；v4 的保单与事件留在原合约，不作迁移。
 *
 * 用法：node deploy-v5.js --send    （不带 --send 只演练）
 */
"use strict";
const path = require("path");
const fs = require("fs");
require(path.join(__dirname, "node_modules", "dotenv")).config({ path: path.join(__dirname, ".env") });
const { ethers } = require(path.join(__dirname, "node_modules", "ethers"));

const send = process.argv.includes("--send");
const CITIES = [
  { code: 420100, name: "武汉市" }, { code: 310100, name: "上海市" }, { code: 110100, name: "北京市" },
  { code: 440100, name: "广州市" }, { code: 510100, name: "成都市" }, { code: 330782, name: "义乌市" },  // 县级市
];
const GRID = { 420100: { 12: 590, 24: 880 }, 310100: { 12: 420, 24: 530 }, 110100: { 12: 360, 24: 510 },
               440100: { 12: 590, 24: 790 }, 510100: { 12: 580, 24: 820 } };  // 义乌不设格 → 兜底价 10 元，待本地精算
const V4 = "0xd0f6C96292406509C601c3cB1DD77b8bF658fCA2";

(async () => {
  const p = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC, undefined, { staticNetwork: true });
  const w = new ethers.Wallet(process.env.PRIVATE_KEY, p);
  const rd = n => fs.readFileSync(path.join(__dirname, "..", "03-合约", n), "utf8");
  const T_ABI = JSON.parse(rd("RainToken.abi.json"));
  const V5_ABI = JSON.parse(rd("RainDeliveryInsuranceV5.abi.json"));
  const V5_BIN = rd("RainDeliveryInsuranceV5.bytecode.txt").trim();
  const V4_ABI = JSON.parse(rd("RainDeliveryInsuranceV4.abi.json"));
  const v4 = new ethers.Contract(V4, V4_ABI, p);
  const bal = await p.getBalance(w.address);
  console.log(`部署者 ${w.address} · 余额 ${ethers.formatEther(bal)} BOT · ${send ? "真发" : "演练"}`);

  let v5Addr, v5;
  if (!send) { console.log("(演练：只估基线)"); }
  else {
    console.log("① 部署 V5 …");
    const v5c = await new ethers.ContractFactory(V5_ABI, V5_BIN, w).deploy(process.env.TOKEN_ADDR);
    await v5c.waitForDeployment();
    v5Addr = await v5c.getAddress();
    v5 = v5c;
    console.log(`   V5 = ${v5Addr} · tx ${v5c.deploymentTransaction().hash}`);
  }

  // 基线：v4 五城现值 + 义乌三模型全季累计中位
  const baseline = [];
  for (const c of CITIES) {
    if (c.code === 330782) {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=29.31&longitude=120.08` +
        `&hourly=precipitation&timezone=Asia%2FShanghai&past_days=26&forecast_days=0&models=ecmwf_ifs025,gfs_seamless,icon_seamless`;
      const j = await (await fetch(url)).json();
      const nowIso = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 13) + ":00";
      const sums = ["ecmwf_ifs025", "gfs_seamless", "icon_seamless"].map(m => {
        let s = 0; (j.hourly[`precipitation_${m}`] || []).forEach((v, i) => {
          if (j.hourly.time[i] > "2026-10-01T00:00" && j.hourly.time[i] <= nowIso && v != null) s += Number(v);
        }); return s; }).sort((a, b) => a - b);
      baseline.push({ code: c.code, mm: Math.round(sums[1]), src: "open-meteo-3model-epoch-cumulative" });
    } else {
      const mm = Number(await v4.rainfall(c.code === 420100 ? 1 : c.code === 310100 ? 2 : c.code === 110100 ? 3 : c.code === 440100 ? 4 : 5));
      baseline.push({ code: c.code, mm, src: `migrated-from-v4-${V4.slice(0, 10)}` });
    }
  }
  console.log("② 基线：", baseline.map(b => `${b.code}=${b.mm}mm(${b.src.split("-")[0]})`).join(" · "));

  if (!send) { console.log("(演练结束)"); return; }

  console.log("③ 注册 6 区域 + 网格 + 基线喂价（deployer 仍是 operator，单钥直发）…");
  for (const c of CITIES) { const t = await (await v5.registerRegion(c.code, c.name)).wait(); console.log(`   register ${c.code} ${c.name} tx ${t.hash.slice(0, 16)}…`); }
  for (const [code, g] of Object.entries(GRID)) {
    for (const h of [12, 24]) {
      const t = await (await v5.setPremiumGrid(code, h, g[h], ethers.id("v5-grid-mirror-of-v4-2026-10-26"))).wait();
      console.log(`   grid ${code} ${h}h=${g[h]}分 tx ${t.hash.slice(0, 16)}…`);
    }
  }
  const ids = baseline.map(b => b.code), mms = baseline.map(b => BigInt(b.mm));
  const evs = baseline.map(b => ethers.id(`v5-baseline ${b.src} ${b.code} ${b.mm}mm ${new Date().toISOString().slice(0, 10)}`));
  const t2 = await (await v5.updateRainfallBatch(ids, mms, evs, baseline.map(() => 80), baseline.map(() => 3))).wait();
  console.log(`   基线批量喂价 tx ${t2.hash}`);

  console.log("④ transferOperator → 多签 …");
  const t3 = await (await v5.transferOperator(process.env.MULTISIG_ADDR)).wait();
  console.log(`   tx ${t3.hash} · operator=${await v5.operator()}`);

  console.log(`\n回填 .env：CONTRACT_ADDRESS_V5=${v5Addr}`);
  console.log("下一步：三笔两票把资金池从 v4 搬到 v5（withdrawPool → approve → fundPool），前端 index-v5.html 切地址。");
})().catch(e => { console.error("💥 " + (e.shortMessage || e.message)); process.exit(1); });
