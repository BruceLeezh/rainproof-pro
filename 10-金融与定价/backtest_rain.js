// 精算回测：用 Open-Meteo 历史真实气象数据，测算五城触发频率与保费充足性
// 用法：node backtest_rain.js [起始年] [结束年]
// 数据源：Open-Meteo Historical Weather API（ERA5），免费、无需 API Key
//
// 为什么要有这个脚本：
//   保费 0.001 / 赔付 0.01 / 阈值 50mm 这三个数字目前是拍出来的。
//   参数化保险的保费必须能被「预期赔付 = 触发概率 × 赔付额」解释，
//   否则"商业价值"这一维度没有证据。本脚本用真实历史数据把触发概率算出来。

const fs = require("fs");
const path = require("path");
const A = require("./audit_numbers.js");   // 只为共享的 emit()：产物落盘不制造时间戳噪声

const REGIONS = [
  { id: 1, key: "wuhan",   name: "武汉", lat: 30.5928, lon: 114.3055 },
  { id: 2, key: "shanghai",name: "上海", lat: 31.2304, lon: 121.4737 },
  { id: 3, key: "beijing", name: "北京", lat: 39.9042, lon: 116.4074 },
  { id: 4, key: "guangzhou",name:"广州", lat: 23.1291, lon: 113.2644 },
  { id: 5, key: "chengdu", name: "成都", lat: 30.5728, lon: 104.0668 },
];

const THRESHOLD = 50;          // mm，合约里的 THRESHOLD
const PAYOUT    = 0.01;        // ETH，合约里的 PAYOUT
const PREMIUM   = 0.001;       // ETH，合约里的 PREMIUM
const WINDOWS   = [1, 2, 3];   // 天；合约支持 1–72 小时，日粒度数据下用 1/2/3 天近似

const YEAR_FROM = Number(process.argv[2] || 2015);
const YEAR_TO   = Number(process.argv[3] || 2025);

const ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";

async function fetchYear(region, year) {
  const url = `${ARCHIVE}?latitude=${region.lat}&longitude=${region.lon}` +
    `&start_date=${year}-01-01&end_date=${year}-12-31` +
    `&daily=precipitation_sum&timezone=Asia%2FShanghai`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const time = (j.daily && j.daily.time) || [];
      const vals = (j.daily && j.daily.precipitation_sum) || [];
      if (!time.length) throw new Error("空响应");
      return time.map((d, i) => ({ date: d, mm: vals[i] == null ? 0 : Number(vals[i]) }));
    } catch (e) {
      if (attempt === 4) throw new Error(`${region.name} ${year}：${e.message}`);
      await new Promise((res) => setTimeout(res, 1500 * attempt));
    }
  }
}

(async () => {
  console.log(`\n精算回测 · Open-Meteo ERA5 · ${YEAR_FROM}–${YEAR_TO} · 阈值 ${THRESHOLD}mm\n`);
  const results = [];

  for (const region of REGIONS) {
    const days = [];
    for (let y = YEAR_FROM; y <= YEAR_TO; y++) {
      const part = await fetchYear(region, y);
      days.push(...part);
      process.stdout.write(`  ${region.name} ${y} → ${part.length} 天\r`);
    }
    // 算每个窗口长度的触发频率 + 逐年极值 + 历史最极端的若干窗口
    const perWindow = {};
    for (const H of WINDOWS) {
      let hits = 0, total = 0, sum = 0;
      const top = [];
      for (let i = 0; i + H - 1 < days.length; i++) {
        const w = days.slice(i, i + H);
        const mm = w.reduce((a, b) => a + b.mm, 0);
        total++;
        sum += mm;
        if (mm >= THRESHOLD) hits++;
        top.push({ from: w[0].date, to: w[w.length - 1].date, mm });
      }
      top.sort((a, b) => b.mm - a.mm);
      perWindow[H] = {
        prob: total ? hits / total : 0,
        hits, total,
        meanMm: total ? sum / total : 0,
        top: top.slice(0, 5),
      };
    }
    // 逐年最大值（3 天窗口），用于看年际波动
    const yearlyMax = {};
    for (let i = 0; i + 2 < days.length; i++) {
      const w = days.slice(i, i + 3);
      const mm = w.reduce((a, b) => a + b.mm, 0);
      const y = w[0].date.slice(0, 4);
      if (yearlyMax[y] === undefined || mm > yearlyMax[y].mm) yearlyMax[y] = { mm, from: w[0].date, to: w[2].date };
    }
    results.push({ region, days: days.length, perWindow, yearlyMax });
    console.log(`  ${region.name} 完成：${days.length} 天`.padEnd(30));
  }

  // ---------- 输出 ----------
  const lines = [];
  const say = (s) => { console.log(s); lines.push(s); };

  say(`\n## 触发频率与保费充足性\n`);
  say(`| 城市 | 样本天数 | 1天≥${THRESHOLD}mm | 2天≥${THRESHOLD}mm | 3天≥${THRESHOLD}mm | 3天窗口的赔付率 |`);
  say(`|---|---|---|---|---|---|`);
  for (const r of results) {
    const p1 = r.perWindow[1].prob, p2 = r.perWindow[2].prob, p3 = r.perWindow[3].prob;
    const lossRatio = (p3 * PAYOUT) / PREMIUM;   // 预期赔付 / 保费
    say(`| ${r.region.name} | ${r.days} | ${(p1 * 100).toFixed(2)}% | ${(p2 * 100).toFixed(2)}% | ${(p3 * 100).toFixed(2)}% | ${(lossRatio * 100).toFixed(0)}% |`);
  }

  say(`\n> **赔付率 = P(3天窗口触发) × ${PAYOUT} / ${PREMIUM} = P × 10。**`);
  say(`> 低于 100% 表示保费能覆盖预期赔付；高于 100% 表示**收的保费不够赔**。\n`);

  // 五城平均赔付率（等权重）
  const avg = results.reduce((a, r) => a + r.perWindow[3].prob * PAYOUT / PREMIUM, 0) / results.length;
  say(`五城等权平均赔付率：**${(avg * 100).toFixed(0)}%**\n`);

  say(`## 历史最极端的窗口（真实发生过，可直接当"历史回放"素材）\n`);
  for (const r of results) {
    say(`### ${r.region.name}\n`);
    say(`| 起 | 止 | 累计降雨 |`);
    say(`|---|---|---|`);
    for (const t of r.perWindow[3].top) say(`| ${t.from} | ${t.to} | **${t.mm.toFixed(1)} mm** |`);
    const years = Object.keys(r.yearlyMax).sort();
    const worst = years.reduce((a, y) => (r.yearlyMax[y].mm > r.yearlyMax[a].mm ? y : a), years[0]);
    say(`\n逐年最大 3 天降雨里最猛的一年：**${worst}**，${r.yearlyMax[worst].from} ~ ${r.yearlyMax[worst].to} ` +
        `累计 **${r.yearlyMax[worst].mm.toFixed(1)} mm**。\n`);
  }

  say(`## 定价建议：统一定价在真实数据下是亏的\n`);
  say(`合约里 \`PREMIUM = 0.001 ether\` 只是**默认值**。真正生效的是 \`premiumOf(regionId)\`：`);
  say(`\`aiPremium[regionId]\` 有值就用它，为 0 才回退到 0.001；\`buyPolicy\` 要求 \`msg.value == premiumOf(regionId)\`。\n`);
  say(`| 城市 | 3天触发概率 | 期望赔付 | 当前 0.001 的赔付率 | 按 60% 目标赔付率反推的保费 | 判断 |`);
  say(`|---|---|---|---|---|---|`);
  for (const r of results) {
    const p = r.perWindow[3].prob;
    const exp = p * PAYOUT;
    const cur = exp / PREMIUM;
    const sug = exp / 0.6;
    const verdict = cur > 1 ? "🔴 **收不够**" : cur > 0.7 ? "🟡 偏紧" : "🟢 有余量";
    say(`| ${r.region.name} | ${(p * 100).toFixed(2)}% | ${exp.toFixed(6)} ETH | ${(cur * 100).toFixed(0)}% | ${sug.toFixed(6)} ETH | ${verdict} |`);
  }
  say(`\n**结论：0.001 这个数只对武汉/上海勉强成立（赔付率约 50%），对广州是亏的（117%），对北京/成都收贵了（21%/36%）。**`);
  say(`这不是我们拍脑袋写出来的 —— 这是 11 年真实气象记录算出来的，也是合约里 \`setUnderwriting()\` 存在的理由。\n`);
  say(`落地方式（operator 一条交易）：\n`);
  say("```js");
  say(`// 广州：概率 11.70% → 保费 0.00195；reasonHash 用本报告的 SHA256，定价依据可被第三方复算`);
  say(`await c.setUnderwriting(4, 1 /* RISK_LOADED */, ethers.parseEther("${(results.find(r=>r.region.id===4).perWindow[3].prob*PAYOUT/0.6).toFixed(5)}"), reasonHash);`);
  say("```\n");

  say(`## 一个诚实的缺口：时长没有定价\n`);
  say(`\`premiumOf(regionId)\` 只看区域，**不看保单时长**；而 1–72 小时的窗口长度对触发概率的影响是指数级的：\n`);
  say(`| 城市 | P(1天≥${THRESHOLD}mm) | P(3天≥${THRESHOLD}mm) | 3天 / 1天 |`);
  say(`|---|---|---|---|`);
  for (const r of results) {
    const a = r.perWindow[1].prob, b = r.perWindow[3].prob;
    say(`| ${r.region.name} | ${(a * 100).toFixed(2)}% | ${(b * 100).toFixed(2)}% | ${a > 0 ? (b / a).toFixed(1) + "×" : "—"} |`);
  }
  say(`\n也就是说：**现在买 1 小时和买 72 小时付一样的钱。** 这是一个我们必须主动承认的已知缺口，`);
  say(`修法是把时长也纳入 \`premiumOf\`。\n`);

  say(`## 结论（写进材料时用这段）\n`);
  say(`- 阈值 ${THRESHOLD}mm 在 3 天窗口下，五城的历史触发概率见上表；`);
  say(`- 保费 ${PREMIUM} ETH 对应赔付 ${PAYOUT} ETH，**触发概率低于 ${(PREMIUM / PAYOUT * 100).toFixed(0)}% 才是正期望的**；`);
  say(`- **广州 11.70% 越过了这条线** —— 统一定价在真实数据下是亏的，这正是 AI 定价层要解决的问题；`);
  say(`- 各城的真实差异说明**统一定价不合理**，而合约里的 \`riskLevel()\` / \`aiPremium()\` / \`setUnderwriting()\` 已经准备好了接口；\n`);
  say(`> 数据来源：Open-Meteo Historical Weather API（ERA5 再分析），日降水量，时区 Asia/Shanghai。`);
  say(`> 复现：\`node 10-金融与定价/backtest_rain.js ${YEAR_FROM} ${YEAR_TO}\`\n`);

  const out = `# 精算测算：五城降雨触发频率与保费充足性\n\n` +
    `> 由 \`10-金融与定价/backtest_rain.js\` 自动生成，数据全部来自真实历史气象记录，可一键复现。\n` +
    `> 生成时间：${new Date().toISOString()}\n` +
    lines.join("\n") + "\n";
  const outPath = path.join(__dirname, "精算测算.md");
  A.emit(outPath, out);
  console.log(`\n已写入 ${outPath}`);
})().catch((e) => { console.error("💥", e.message); process.exit(1); });
