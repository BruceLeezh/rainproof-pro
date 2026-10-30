// 生成 PPT 口径文件：链上实时读数 + 湖北定价分布 → deck-metrics.json
// 用法：cd 04-脚本 && node deck-metrics.js
const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const { ethers } = require(path.join(__dirname, "../07-测试工具/node_modules/ethers"));

const ABI = JSON.parse(fs.readFileSync(path.join(__dirname, "../03-合约/RainDeliveryInsuranceV5.abi.json"), "utf8"));
const PRICING = JSON.parse(fs.readFileSync(path.join(__dirname, "../10-金融与定价/hubei-pricing.json"), "utf8"));

(async () => {
  const provider = new ethers.JsonRpcProvider(
    process.env.SEPOLIA_RPC || "https://rpc.bohr.life", undefined, { staticNetwork: true });
  const c = new ethers.Contract(process.env.CONTRACT_ADDRESS, ABI, provider);

  const codes = { 110100: "北京", 420100: "武汉", 310100: "上海", 440100: "广州", 510100: "成都" };
  const rain = {}, p12 = {}, p24 = {};
  for (const id of Object.keys(codes)) {
    rain[id] = Number(await c.rainfall(id));
    p12[id] = Number(await c.premiumOf(id, 12));
    p24[id] = Number(await c.premiumOf(id, 24));
  }

  const p0 = await c.policies(0);
  const j0 = await c.judgements(0);
  const next = Number(await c.nextPolicyId());
  let claims = 0;
  for (let i = 0; i < next; i++) {
    const p = await c.policies(i);
    if (p.paid) claims++;
  }

  const p12s = PRICING.regions.map(r => r.grid["12"]);
  const p24s = PRICING.regions.map(r => r.grid["24"]);
  const min24 = Math.min(...p24s), max24 = Math.max(...p24s);
  const min12 = Math.min(...p12s);

  const out = {
    generatedAt: new Date().toISOString(),
    regionCount: Number(await c.regionCount()),
    hubCount: 118,
    rain, p12, p24,
    pool: Number(await c.poolBalance()),
    claims,
    policyCount: next,
    p0: { base: Number(p0.rainfallAtBuy), judge: Number(j0.rainfallAtJudgement), decision: Number(j0.decision), confidence: Number(j0.confidence) },
    price: { min12, min24, max24, cells: p12s.length * 2, ratio: +(max24 / min24).toFixed(1) },
  };
  fs.writeFileSync(path.join(__dirname, "deck-metrics.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
