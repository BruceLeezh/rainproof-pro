/**
 * AI 判定层的最小可运行检查
 * ============================================================================
 * 钉住 ai-judge.js 的判定规则：规则改了、顺序错了、硬约束漏了，这里必须红。
 * 不依赖链、不依赖网络、不依赖大模型 —— 纯函数，随时可跑。
 *
 * 用法：node check-ai.js
 */

const fs = require("fs");
const path = require("path");
const { decide, buildRecord, DECISION } = require("../04-脚本/ai-judge");
const { evidenceHashOf } = require("../04-脚本/canonical");

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${label}${extra ? "  " + extra : ""}`); }
  else { fail++; console.log(`  ❌ ${label}${extra ? "  " + extra : ""}`); }
}

/** 造一份最小快照：只填 decide() 会读的字段 */
function snap({ official, incs, threshold = 50, minConf = 60, simulated = false, policyId = 1 }) {
  return {
    schema: "rainproof/judge-input@1",
    policyId,
    simulated,
    region: { id: 2, key: "shanghai", name: "上海", lat: 31.2304, lon: 121.4737 },
    policy: { startDate: "2026-10-01" },
    oracle: { officialIncrementMm: official, cumulativeMm: official, contract: "0x", chainId: 11155111 },
    weather: {
      source: simulated ? "synthetic" : "open-meteo:...",
      models: incs.map((v, i) => ({ id: "m" + i, label: "M" + i, org: "x", sinceEpochMm: v, inWindowMm: v, days: [] })),
    },
    thresholds: { thresholdMm: threshold, minConfidence: minConf },
  };
}

console.log("=".repeat(74));
console.log("AI 判定层检查");
console.log("=".repeat(74));
console.log("\n[R1] 雨量本身没达标 —— 与模型无关，直接不赔");
{
  const r = decide(snap({ official: 30, incs: [30, 31, 29] }));
  ok("official 30 < 阈值 50 → DENY", r.decision === DECISION.DENY, `decision=${r.decision}`);
  ok("置信度给到 95（这是确定性的，不是推测）", r.confidence === 95, `confidence=${r.confidence}`);
  ok("理由里点名了阈值", r.reasons.some((s) => s.includes("阈值 50mm")));
}

console.log("\n[R2] ★ 独立复核发现预言机和模型严重不符 —— AI 真正值钱的地方");
{
  const r = decide(snap({ official: 80, incs: [20, 22, 21] }));
  ok("链上 80mm vs 三模型中位数 21mm（背离 73.8% > 60%）→ DENY",
    r.decision === DECISION.DENY, `decision=${r.decision} divergence=${r.metrics.divergencePct}%`);
  ok("背离时给高置信度 92（对『链上数据不可信』这件事很确定）", r.confidence === 92);
  ok("理由里写明了背离百分比", r.reasons.some((s) => s.includes("背离")));
  ok("反向验证：同样的数字打了 simulated=true，R2 的背离复核照样跑（模拟标记只写进理由，不再整条免检）",
    decide(snap({ official: 80, incs: [20, 22, 21], simulated: true })).decision === DECISION.DENY &&
    decide(snap({ official: 80, incs: [20, 22, 21], simulated: true })).reasons.some((s) => s.includes("背离")));
  ok("simulated=true 仍会在理由里如实写出「这是合成数据」",
    decide(snap({ official: 80, incs: [20, 22, 21], simulated: true })).reasons.some((s) => s.includes("simulated")));
  {
    // 取数失败的项目（inWindowMm 非有限）不得进中位数、也不得算进 sources，否则中位数/离散度变 NaN
    const s = snap({ official: 80, incs: [80, 84, 78] });
    s.weather.models.push({ id: "bad", label: "M-bad", org: "x", sinceEpochMm: null, inWindowMm: null, days: [] });
    const r = decide(s);
    ok("混进一个取数失败的模型：中位数仍是 80、判定仍是 PAY", r.metrics && r.decision === DECISION.PAY,
      `decision=${r.decision} metrics=${JSON.stringify(r.metrics)}`);
    ok("取数失败的模型不算来源（sources = 3，不是 4）",
      buildRecord({ policyId: 1, snapshot: s, r, inputHash: evidenceHashOf({ any: "thing" }),
        rationale: "规则文案", rationaleSource: "deterministic", decidedAt: "2026-10-06T13:35:00.259Z" }).judgement.sources === 3);
  }
}

console.log("\n[R3] 三家里只有 ≤1 家支持赔付");
{
  const r = decide(snap({ official: 50, incs: [30, 25, 20] }));
  ok("达标模型 0/3 → DENY", r.decision === DECISION.DENY, `agree=${r.metrics.agreeCount}`);
  ok("理由里报告了达标家数", r.reasons.some((s) => s.includes("0 个模型")));
}

console.log("\n[R4] 模型自己吵翻天 —— 置信度压到门槛以下，不敢拍板");
{
  const r = decide(snap({ official: 50, incs: [50, 90, 10] }));
  ok("离散度 80 ≥ 中位数 50 → DENY", r.decision === DECISION.DENY);
  ok("置信度被压到 45（< 验收门槛 60）", r.confidence === 45, `confidence=${r.confidence}`);
  ok("理由里说明了离散度与门槛", r.reasons.some((s) => s.includes("分歧过大")));
}

console.log("\n[R5] 正常赔付路径");
{
  const r = decide(snap({ official: 80, incs: [80, 84, 78] }));
  ok("3/3 模型一致且与链上相符 → PAY", r.decision === DECISION.PAY, `decision=${r.decision}`);
  ok("置信度 ≥ 门槛", r.confidence >= 60, `confidence=${r.confidence}`);
  ok("离散度越小置信度越高（单调性）",
    decide(snap({ official: 80, incs: [80, 80, 80] })).confidence > decide(snap({ official: 80, incs: [80, 86, 74] })).confidence);
}

console.log("\n[硬约束] 绝不允许输出「PAY 且置信度 < 门槛」");
{
  // 扫一遍参数网格，任何一格出现 PAY 且 conf < minConf 都算失败
  let violated = null, payCases = 0;
  for (const official of [0, 25, 49, 50, 55, 60, 80, 120, 200]) {
    for (const a of [0, 10, 30, 50, 60, 80, 100, 150]) {
      for (const b of [0, 20, 40, 55, 70, 90, 110]) {
        for (const c of [0, 15, 45, 52, 65, 85, 130]) {
          for (const minConf of [60, 75]) {
            for (const simulated of [false, true]) {
              const r = decide(snap({ official, incs: [a, b, c], minConf, simulated }));
              if (r.decision === DECISION.PAY) {
                payCases++;
                if (r.confidence < minConf) violated = { official, incs: [a, b, c], minConf, conf: r.confidence };
              }
              if (r.confidence < 0 || r.confidence > 99) violated = { official, incs: [a, b, c], conf: r.confidence, outOfRange: true };
            }
          }
        }
      }
    }
  }
  ok(`${payCases} 个 PAY 用例全部过门槛，且置信度都落在 0..99`, violated === null, violated ? JSON.stringify(violated) : "");
}

console.log("\n[可复算] 同一份快照必须得到逐字节相同的结果");
{
  const s = snap({ official: 80, incs: [80, 84, 78] });
  const a = decide(s), b = decide(JSON.parse(JSON.stringify(s)));
  ok("两次调用结果完全一致", JSON.stringify(a) === JSON.stringify(b));
  // decide 不得改写入参 —— 否则重算哈希会漂移
  ok("decide() 不修改输入快照", JSON.stringify(s) === JSON.stringify(snap({ official: 80, incs: [80, 84, 78] })));
}

console.log("\n[哈希绑定] 结论一变，outputHash 必变");
{
  const base = { schema: "rainproof/judgement@1", policyId: 1, decision: 1, confidence: 90, inputHash: "0x" + "ab".repeat(32), reasons: ["x"] };
  const h1 = evidenceHashOf(base);
  const h2 = evidenceHashOf({ ...base, decision: 0 });
  const h3 = evidenceHashOf({ ...base, confidence: 91 });
  ok("decision 变 → 哈希变", h1 !== h2);
  ok("confidence 变 → 哈希变", h1 !== h3);
  ok("键序不同、内容相同 → 哈希不变", evidenceHashOf({ ...base }) === evidenceHashOf(Object.fromEntries(Object.entries(base).reverse())));
}

console.log("\n[可复算] 换个运行时间、换段解释文字，outputHash 必须一个字节都不动");
{
  // 这条钉的就是「第三方拿同一份快照重跑，必然得到同一个 outputHash」这句卖点。
  // 曾经踩过：decidedAt 写在 judgement 里 → 同一份快照重跑，哈希每次都变。
  const s = snap({ official: 80, incs: [80, 84, 78] });
  const r = decide(s);
  const inputHash = evidenceHashOf({ any: "thing" });
  const mk = (extra) => buildRecord({
    policyId: 1, snapshot: s, r, inputHash,
    rationale: "规则文案", rationaleSource: "deterministic",
    decidedAt: "2026-10-06T13:35:00.259Z", ...extra,
  });
  const a = mk({});
  ok("decidedAt 变 → outputHash 不变", a.outputHash === mk({ decidedAt: "2027-01-01T00:00:00.000Z" }).outputHash, a.outputHash);
  ok("解释文字/来源变 → outputHash 不变",
    a.outputHash === mk({ rationale: "完全换一段解释", rationaleSource: "llm:deepseek-chat", llmInfo: { base: "b", model: "m" } }).outputHash);
  ok("judgement 对象里不含 decidedAt / rationale", !("decidedAt" in a.judgement) && !("rationale" in a.judgement));
  ok("同一份输入重跑 → 整条记录逐字节相同", JSON.stringify(mk({})) === JSON.stringify(a));
  const d = buildRecord({ policyId: 1, snapshot: s, r: decide(snap({ official: 80, incs: [80, 20, 78] })), inputHash, rationale: "规则文案", rationaleSource: "deterministic" });
  ok("指标（离散度）变 → outputHash 必变", d.outputHash !== a.outputHash);
}

console.log("\n[可复算·实证据] 仓库里每一条留痕，哈希都要能当场重算出来");
{
  const root = path.join(__dirname, "..", "09-AI判定留痕");
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      // 承保复核留痕（09-AI判定留痕/承保复核-chain*.json）也必须进复算：它们哈希的是 review 子树
      // （reviewHash = keccak256(canonical(review))，口径见 04-脚本/hook-watch.js:312）。
      else if (/^(snapshot|judgement)-policy\d+\.json$/.test(e.name)
               || /^承保复核-chain\d+-policy\d+\.json$/.test(e.name)) files.push(f);
    }
  })(root);
  ok(`找到 ${files.length} 个留痕文件`, files.length > 0);

  let bad = 0;
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    const [obj, key] = j.snapshot ? [j.snapshot, "inputHash"]
      : j.judgement ? [j.judgement, "outputHash"]
      : [j.review, "reviewHash"];   // 承保复核留痕：哈希的是 review 子树（不含 reviewedAt / observed）
    const again = evidenceHashOf(obj);
    if (again !== j[key]) { bad++; console.log(`     　 ${path.relative(root, f)}：文件写 ${j[key]}，重算 ${again}`); }
  }
  ok("所有留痕的哈希都能重算出来（含真链 #0/#1 的修复前留档、含承保复核的 reviewHash）", bad === 0, bad ? `${bad} 个对不上` : `${files.length} 个全对`);

  // 覆盖度自检：光「进了集合的都算对了」不够 —— 漏收文件同样会全绿。这里直接跟盘上对：
  // 09-AI判定留痕 根目录里每一个带 reviewHash 的留痕（= 承保复核那一批），都必须出现在复算集合里。
  const reviewOnDisk = fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".json")
      && "reviewHash" in JSON.parse(fs.readFileSync(path.join(root, e.name), "utf8")))
    .map((e) => e.name);
  const missed = reviewOnDisk.filter((n) => !files.includes(path.join(root, n)));
  ok(`带 reviewHash 的承保复核留痕（${reviewOnDisk.length} 个）一个都没漏进复算`,
     reviewOnDisk.length > 0 && missed.length === 0,
     missed.length ? `漏了 ${missed.join(",")}` : `${reviewOnDisk.length} 个全在`);

  // 布局契约：易变字段必须在被哈希对象【之外】。根目录下的 policy0/1 是修复前的
  // 真链留档，动了就跟链上对不上，所以只对它们查哈希自洽、不查布局。
  const fresh = files.filter((f) => path.dirname(f) !== root);
  const dirty = fresh.filter((f) => {
    const o = JSON.parse(fs.readFileSync(f, "utf8")).snapshot
      || JSON.parse(fs.readFileSync(f, "utf8")).judgement;
    return "collectedAt" in o || "decidedAt" in o || "rationale" in o;
  });
  ok(`新留痕（${fresh.length} 个）里没有易变字段`, dirty.length === 0, dirty.map((f) => path.basename(f)).join(","));
}

console.log("\n" + "=".repeat(74));
console.log(`结果：${pass} 项通过 / ${fail} 项失败`);
console.log(fail === 0 ? "✅ 全部通过 —— AI 判定规则可以拿去现场了" : "❌ 有失败项");
console.log("=".repeat(74));
process.exit(fail === 0 ? 0 : 1);
