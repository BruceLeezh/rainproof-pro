"use strict";
// 上台读数卡（2026-11-13）：把「上台前 60 分钟要核对的链上事实」一次打出来。
// 只读，不发交易。用法：
//   cd 04-脚本 && node ../07-测试工具/stage-card.js            # 打印
//   cd 04-脚本 && node ../07-测试工具/stage-card.js --write    # 另存 02-作战与答辩/上台读数卡-<日期>.md
// 为什么单独写：彩排时要核的东西散在 preflight、核验台、浏览器三个地方，台上只想要一张纸。
// 2026-11-13 晚加固：rpc.bohr.life 会间歇性 TCP 超时（curl 000 → 3s 后 200），
// 原来 Promise.all 一挂全挂、一个字都打不出来。现在每个读取都带重试，读不到就标「—」继续，宁缺不崩。
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const { ethers } = require(path.join(ROOT, "04-脚本", "node_modules", "ethers"));
const dep = require(path.join(ROOT, "deployment.json"));
const REGIONS = require(path.join(ROOT, "04-脚本", "v5-regions.json"));
const ABI = require(path.join(ROOT, "03-合约", "RainDeliveryInsuranceV6.abi.json"));

const WATCH = [
  [420100, "武汉（主城）"], [420113, "汉南区"], [420116, "黄陂区"],
  [440100, "广州"], [110100, "北京"], [310100, "上海"], [510100, "成都"],
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const retry = async (fn, tries = 4, wait = 900) => {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { last = e; if (i < tries - 1) await sleep(wait * (i + 1)); }
  }
  throw last;
};
const safe = async (fn, tries = 3) => { try { return await retry(fn, tries); } catch { return null; } };

(async () => {
  const req = new ethers.FetchRequest(dep.rpc);
  req.timeout = 20000;
  const provider = new ethers.JsonRpcProvider(req, dep.chainId, { staticNetwork: true, batchMaxCount: 20 });
  try {
    const block = await retry(() => provider.getBlock("latest"), 5, 1200);
    const tag = { blockTag: block.number };
    const c = new ethers.Contract(dep.contract, ABI, provider);
    const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : "—");
    const money = n => (Number.isFinite(n) ? n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");
    const local = ts => new Date((ts + 8 * 3600) * 1000).toISOString().replace("T", " ").slice(0, 19);
    const [pool, exposure, maxAge, count] = await Promise.all([
      safe(() => c.poolBalance(tag)), safe(() => c.openExposure(tag)),
      safe(() => c.MAX_FEED_AGE(tag)), safe(() => c.nextPolicyId(tag)),
    ]);
    if (maxAge === null) throw new Error("合约读取失败（MAX_FEED_AGE 都读不到），RPC 可能整段不通，过 1 分钟再试");

    const feeds = await Promise.all(REGIONS.map(async r => {
      const at = await safe(() => c.lastFeedAt(r.code, tag), 2);
      return { code: r.code, name: r.name, at: at === null ? -1 : Number(at) };
    }));
    const nowSec = block.timestamp;
    const unread = feeds.filter(f => f.at < 0).length;
    const fresh = feeds.filter(f => f.at > 0 && nowSec - f.at <= Number(maxAge));
    const never = feeds.filter(f => f.at === 0).length;
    const newest = feeds.reduce((m, f) => Math.max(m, f.at), 0);
    const stale = feeds.filter(f => f.at > 0 && nowSec - f.at > Number(maxAge)).sort((a, b) => a.at - b.at);

    const rows = [];
    for (const [code, label] of WATCH) {
      const [rain, p12, p24] = await Promise.all([
        safe(() => c.rainfall(code, tag)), safe(() => c.premiumOf(code, 12, tag)), safe(() => c.premiumOf(code, 24, tag)),
      ]);
      const f = feeds.find(x => x.code === code);
      const age = f && f.at > 0 ? (nowSec - f.at) / 3600 : null;
      rows.push({
        label,
        rain: rain === null ? null : Number(rain),
        p12: p12 === null ? null : Number(p12) / 100,
        p24: p24 === null ? null : Number(p24) / 100,
        age,
      });
    }

    const pols = [];
    const nPol = count === null ? 0 : Math.min(Number(count), 10);
    for (let id = 0; id < nPol; id++) {
      const [row, status] = await Promise.all([
        safe(() => c.policies(id, tag)), safe(() => c.policyStatus(id, tag)),
      ]);
      if (!row) continue;
      pols.push({
        id, region: Number(row.regionId), hours: Number(row.windowHours), premium: Number(row.premium) / 100,
        anchor: row.anchored ? Number(row.rainfallAtEffective) : null,
        end: local(Number(row.endTime)),
        status: status ?? "—", payout: Number(row.payout) / 100,
      });
    }

    const lines = [];
    lines.push(`# 上台读数卡 · ${local(nowSec)}（北京）`, "");
    lines.push("> 只读生成，不含预测。数字与链上一致；页面若显示不同，以此表 + 当场刷新为准。", "");
    lines.push(`- 链：BOT Chain 测试网 ${dep.chainId} ｜ 区块 **${block.number}**`);
    lines.push(`- 合约：\`${dep.contract}\``);
    lines.push(`- 池子：**${money(pool === null ? NaN : Number(pool) / 100)}** 模拟元 ｜ 未结清敞口：${money(exposure === null ? NaN : Number(exposure) / 100)} ｜ 已签发保单：${count === null ? "—" : Number(count)} 张`);
    lines.push(`- 喂价新鲜：**${fresh.length}/${REGIONS.length}** 区划（上限 ${Number(maxAge) / 3600}h）｜ 最近一次成功喂价：${newest > 0 ? `${local(newest)}（${fmt((nowSec - newest) / 3600, 1)}h 前）` : "无"}`);
    if (unread > 0 || never > 0) lines.push(`- ⚠️ 本次读不到 ${unread} 个区划的喂价时间、${never} 个从未喂过（RPC 抖动或真的没喂），其余照常；重跑一次即可补上。`);
    lines.push("");
    lines.push("| 城市 / 区划 | 链上雨量 | 12h 保费 | 24h 保费 | 喂价年龄 | 能否投保 |");
    lines.push("|---|---|---|---|---|---|");
    for (const r of rows) {
      const ok = r.age !== null && r.age * 3600 <= Number(maxAge);
      const can = ok ? "✅ 可投" : (r.age === null ? "⚠️ 读不到年龄" : "⛔ 超 24h，合约会拒");
      lines.push(`| ${r.label} | ${r.rain === null ? "—" : `${r.rain} mm`} | ${fmt(r.p12, 1)} 元 | ${fmt(r.p24, 1)} 元 | ${fmt(r.age, 1)}h | ${can} |`);
    }
    const hn = rows.find(r => r.label === "汉南区"), hp = rows.find(r => r.label === "黄陂区");
    if (hn && hp && hn.p24 > 0 && hp.p24 > 0) lines.push("", `- 同城价差：汉南 ${fmt(hn.p24)} 元 ÷ 黄陂 ${fmt(hp.p24)} 元 = **${fmt(hn.p24 / hp.p24)}×**（讲 S15 用这个数）`);
    if (pols.length) {
      lines.push("", "| 保单 | 区划 | 时长 | 保费 | 锚值 | 到期（北京） | 状态 | 给付 |");
      lines.push("|---|---|---|---|---|---|---|---|");
      for (const p of pols) lines.push(`| #${p.id} | ${p.region} | ${p.hours}h | ${fmt(p.premium)} 元 | ${p.anchor ?? "—"} mm | ${p.end} | ${p.status} | ${fmt(p.payout)} 元 |`);
    } else {
      lines.push("", "- 链上目前 **0 张保单**（若你已按 A4 买第 3 单，这里应出现新行；没有就是还没上链）。");
    }
    if (stale.length) {
      lines.push("", `- 超 24h 的 ${stale.length} 个区划（多因三模型分歧被闸门拒收，非机器故障）；最老：` +
        stale.slice(0, 3).map(s => `${s.name} ${fmt((nowSec - s.at) / 3600, 0)}h`).join("、"));
    }
    lines.push("", "## 上台前 60 分钟照这个顺序做", "",
      "1. `cd 04-脚本 && node preflight.js` —— 只看 ❌ 行；⏳ 是数据未到，不用管。",
      "2. 本卡重跑一次，确认汉南/黄陂仍是 ✅。",
      "3. 浏览器打开 `rider.html`，切到要演示的钱包，确认「现在能买」按钮可点。",
      "4. 若汉南/黄陂变 ⛔：立刻 `node push-rainfall-v6.js --city=420113 --send`（约 0.013 BOT），再重跑本卡。",
      "");

    const out = lines.join("\n");
    console.log(out);
    if (process.argv.includes("--write")) {
      const d = new Date((nowSec + 8 * 3600) * 1000).toISOString().slice(0, 10);
      const f = path.join(ROOT, "02-作战与答辩", `上台读数卡-${d}.md`);
      fs.writeFileSync(f, out, "utf8");
      console.log(`\n已写入 ${path.relative(ROOT, f)}`);
    }
  } finally {
    provider.destroy();
  }
})().catch(e => { console.error("💥", e.shortMessage || e.message); process.exitCode = 1; });
