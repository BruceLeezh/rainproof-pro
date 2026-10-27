/**
 * AI 判定 · 第 2 步 —— 由证据快照得出「赔 / 不赔」（judgement）
 * ============================================================================
 *
 * 【本脚本的判定核心是确定性的，不是「问一下大模型」】
 *   原因有三条，都是硬理由：
 *   1. 可复算。链上只写了 32 字节哈希，谁都能拿同一份快照重跑本脚本，
 *      必须得到逐字节相同的结果 —— 大模型的输出做不到这一点。
 *   2. 可解释。赔付是钱的事，结论必须能拆成「哪几条规则命中了」。
 *   3. 不依赖外部。现场没网、没 API key、模型下线，判定照样跑得出来。
 *   大模型的角色是【写人话解释】（rationale），不参与也不影响决定 —— 配了 key 就调，
 *   没配就用规则拼一段。两种情况的结论完全一致（这点由 07-测试工具/check-ai.js 钉住）。
 *
 * 【判定规则（按顺序短路，全部写死在代码里）】
 *   R1 链上官方增量 < 阈值          → DENY（雨量本身没达标，与模型无关）
 *   R2 预言机与三模型中位数背离 > 60% → DENY（★ 这才是 AI 真正值钱的地方：
 *                                       写数的预言机是单一运营方，第二个独立意见发现它在瞎写）
 *   R3 达标模型数 ≤ 1               → DENY（三家模型里只有一家支持赔付）
 *   R4 离散度 ≥ 中位数             → 置信度压到 < 阈值 → DENY（模型自己都吵翻天，不敢拍板）
 *   R5 以上都不命中                 → PAY
 *
 * 【硬约束】
 *   绝不允许输出「PAY 且置信度 < MIN_CONFIDENCE」—— 合约里 claim() 会因此 revert
 *   （AI: low confidence）。真出现这种情况一律降级为 DENY，宁可不赔也不留一笔
 *   「链上判赔、点了却报错」的保单。
 *
 * 【用法】
 *   node ai-judge.js 0                # 读 09-AI判定留痕/snapshot-policy0.json
 *   node ai-judge.js 0 --llm          # 额外让大模型写一段解释（需要 LLM_API_KEY）
 */

try { require("dotenv").config(); } catch (_) { /* dotenv 可选 */ }
const fs = require("fs");
const path = require("path");
const { evidenceHashOf } = require("./canonical");

const OUT_DIR = process.env.AI_OUT_DIR || path.join(__dirname, "..", "09-AI判定留痕");
const JUDGE_VERSION = "ai-judge-v1";

const DECISION = { DENY: 0, PAY: 1 };
const LABEL = { 0: "DENY", 1: "PAY" };

/** 中位数（偶数个取中间两个的平均），6 位小数对齐 canonical 口径 */
function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  const v = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  return Math.round(v * 1e6) / 1e6;
}

/** 只有真取到数的来源才算来源：缺 inWindowMm 的那一项既不能进中位数，也不该算进 sources
 *  （正常路径下三家都在；这条防的是「快照里混进取数失败的项」把中位数/离散度算成 NaN）。 */
const usableModels = (snap) => (snap.weather.models || []).filter((m) => Number.isFinite(m.inWindowMm));

/** 确定性判定 —— 输入相同必然输出相同，这是它能上链的前提 */
function decide(snap) {
  const threshold = snap.thresholds.thresholdMm;
  const minConf = snap.thresholds.minConfidence;
  const models = usableModels(snap);
  const incs = models.map((m) => m.inWindowMm);
  const med = median(incs);
  const spread = Math.round((Math.max(...incs) - Math.min(...incs)) * 1e6) / 1e6;
  const agreeCount = incs.filter((v) => v >= threshold).length;
  const official = snap.oracle.officialIncrementMm;
  const divergencePct = official > 0 ? Math.round((Math.abs(med - official) / official) * 1000) / 10 : 0;

  const reasons = [];
  let decision;
  let confidence;

  // 置信度基线：三模型越一致越有把握。离散度占中位数的比例越低，越接近 99。
  const agreement = med > 0 ? Math.max(0, 1 - Math.min(1, spread / med)) : 1;
  confidence = Math.round(60 + 38 * agreement);
  if (agreeCount === 2) confidence -= 15;
  if (agreeCount <= 1) confidence -= 35;
  confidence = Math.max(0, Math.min(99, confidence));

  if (snap.simulated) reasons.push("⚠️ 本快照为演示用合成数据（simulated=true），不是真实气象观测。");

  if (official < threshold) {
    // R1
    decision = DECISION.DENY;
    confidence = 95;
    reasons.push(`链上官方增量 ${official}mm < 阈值 ${threshold}mm，雨量未达标。`);
  } else if (divergencePct > 60) {
    // R2 —— 独立复核发现预言机与模型严重不符
    // 原来这里带 `!snap.simulated` 旁路：快照只要打上 simulated=true，R2 就整条免检。
    // 合成数据该在 reasons 里被写明（上面那条），但不该让「链上数与模型严重不符」免检。
    decision = DECISION.DENY;
    confidence = 92;
    reasons.push(`预言机写入 ${official}mm，三模型中位数仅 ${med}mm，背离 ${divergencePct}% > 60%：`
      + "链上数据与独立气象模型不符，拒绝按链上数字赔付。");
  } else if (agreeCount <= 1) {
    // R3
    decision = DECISION.DENY;
    reasons.push(`三模型中只有 ${agreeCount} 个模型的窗口增量达到 ${threshold}mm，不支持赔付结论。`);
  } else if (spread >= med) {
    // R4
    decision = DECISION.DENY;
    confidence = Math.min(confidence, 45);
    reasons.push(`模型离散度 ${spread}mm ≥ 中位数 ${med}mm：三家模型分歧过大，置信度压到 ${confidence}，低于验收门槛 ${minConf}，不予赔付。`);
  } else {
    // R5
    decision = DECISION.PAY;
    reasons.push(`链上官方增量 ${official}mm ≥ 阈值 ${threshold}mm，且 ${agreeCount}/3 个独立模型一致支持。`);
    reasons.push(`模型窗口增量 ${incs.join(" / ")} mm（中位数 ${med}mm，离散度 ${spread}mm），与链上数字相符。`);
  }

  // 硬约束：PAY 必须过验收门槛，否则合约会 revert
  if (decision === DECISION.PAY && confidence < minConf) {
    reasons.push(`⚠️ 原判定为 PAY 但置信度 ${confidence} < 验收门槛 ${minConf}，已按硬约束降级为 DENY（避免链上判赔却点不动）。`);
    decision = DECISION.DENY;
  }

  return { decision, confidence, reasons, metrics: { thresholdMm: threshold, minConfidence: minConf, officialIncrementMm: official, modelIncrementsMm: incs, medianMm: med, spreadMm: spread, agreeCount, divergencePct } };
}

/** 规则拼一段人话解释 —— 没有大模型也要能自圆其说 */
function rulesRationale(snap, r) {
  const name = usableModels(snap).map((m) => m.label).join("、");
  return `保单 #${snap.policyId}（${snap.region.name}，窗口自 ${snap.policy.startDate} 起）：`
    + `链上官方累计增量 ${r.metrics.officialIncrementMm}mm，阈值 ${r.metrics.thresholdMm}mm；`
    + `独立复核取了 ${name} 三家模型，窗口增量分别为 ${r.metrics.modelIncrementsMm.join(" / ")} mm。`
    + `结论：${LABEL[r.decision]}，置信度 ${r.confidence}。`
    + (snap.simulated ? "（演示模式：快照为合成数据。）" : "");
}

/** 可选：让大模型把规则结论翻译成人话。它只能改措辞，改不了 decision / confidence。 */
async function llmRationale(snap, r) {
  const key = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) return null;
  const base = process.env.LLM_BASE_URL || "https://api.deepseek.com/v1";
  const model = process.env.LLM_MODEL || "deepseek-chat";
  const body = {
    model,
    temperature: 0,
    messages: [
      { role: "system", content: "你是参数化保险的理赔说明撰写员。只根据给定事实写 2-3 句中文说明，"
        + "不要改变结论、不要编造数字、不要给建议。结论和置信度已定，你只负责表述。" },
      { role: "user", content: JSON.stringify({ 结论: LABEL[r.decision], 置信度: r.confidence, 指标: r.metrics, 依据: r.reasons, 是否模拟数据: !!snap.simulated }) },
    ],
  };
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const txt = j?.choices?.[0]?.message?.content;
  if (!txt) throw new Error("LLM 返回里没有内容");
  return { text: txt.trim(), model, base };
}

/**
 * 组装一条判定记录。**易变字段一律放在被哈希对象之外**：
 *   · decidedAt    —— 每次跑都不一样的墙上时钟
 *   · rationale 等 —— 解释文字：deterministic 模式由规则拼出，--llm 模式下由大模型写措辞，
 *                     而大模型本来就无权改变结论（硬约束见 check-ai.js）
 * 它们只要进了 judgement，同一份快照重跑就会得到不一样的 outputHash，
 * 「第三方独立复算」这句话当场就不成立。judgement 里只留判定本身。
 */
function buildRecord({ policyId, snapshot, r, inputHash, rationale, rationaleSource, llmInfo, decidedAt }) {
  const judgement = {
    schema: "rainproof/judgement@1",
    judgeVersion: JUDGE_VERSION,
    policyId,
    decision: r.decision,
    decisionLabel: LABEL[r.decision],
    confidence: r.confidence,
    sources: usableModels(snapshot).length,     // 采信的独立数据源个数（不含取数失败的项）
    simulated: !!snapshot.simulated,
    metrics: r.metrics,
    reasons: r.reasons,
    inputHash,                                  // 绑定到快照：换一份数据，这个值必然变
  };
  return {
    judgement,
    decidedAt: decidedAt || new Date().toISOString(),
    rationale,
    rationaleSource,                            // 判定是谁下的、解释是谁写的，分得清清楚楚
    ...(llmInfo ? { llm: llmInfo } : {}),
    outputHash: evidenceHashOf(judgement),      // 只覆盖上面那个 judgement 对象
  };
}

async function main() {
  const ARGV = process.argv.slice(2);
  const policyId = Number(ARGV.find((a) => /^\d+$/.test(a)));
  const wantLlm = ARGV.includes("--llm");
  if (!Number.isInteger(policyId)) { console.error("用法：node ai-judge.js <policyId> [--llm]"); process.exit(2); }

  const snapFile = path.join(OUT_DIR, `snapshot-policy${policyId}.json`);
  if (!fs.existsSync(snapFile)) { console.error(`找不到 ${snapFile} —— 先跑 node ai-collect.js ${policyId}`); process.exit(2); }
  const { snapshot, inputHash } = JSON.parse(fs.readFileSync(snapFile, "utf8"));

  // 自检：文件里的快照必须真的等于它声称的哈希。不等说明文件被改过/口径变了，
  // 这时交上去的 inputHash 和链上对不上，等于给评委看一个假证据。
  const recomputed = evidenceHashOf(snapshot);
  if (recomputed !== inputHash) {
    console.error(`💥 快照哈希对不上：文件写的是 ${inputHash}，重算是 ${recomputed}`);
    process.exit(1);
  }

  const r = decide(snapshot);

  let rationale = rulesRationale(snapshot, r);
  let rationaleSource = "deterministic";
  let llmInfo = null;
  if (wantLlm) {
    try {
      const out = await llmRationale(snapshot, r);
      if (out) { rationale = out.text; rationaleSource = `llm:${out.model}`; llmInfo = { base: out.base, model: out.model }; }
      else { rationale += "（未配置 LLM_API_KEY，解释由规则生成。）"; }
    } catch (e) {
      // 大模型挂了不影响判定 —— 这正是把判定做成确定性的好处
      rationale += `（大模型解释生成失败，已回退到规则文案：${e.message}）`;
      rationaleSource = "deterministic:llm-failed";
    }
  }

  const record = buildRecord({ policyId, snapshot, r, inputHash, rationale, rationaleSource, llmInfo });
  const { judgement, outputHash } = record;
  const file = path.join(OUT_DIR, `judgement-policy${policyId}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2));

  console.log("=".repeat(74));
  console.log(`AI 判定（保单 #${policyId} · ${snapshot.region.name}）`);
  console.log("=".repeat(74));
  console.log(`结论      ${LABEL[r.decision]}    置信度 ${r.confidence}    采信源 ${judgement.sources}`);
  console.log(`指标      官方法 ${r.metrics.officialIncrementMm}mm / 三模型 ${r.metrics.modelIncrementsMm.join("·")}mm`
    + `  中位数 ${r.metrics.medianMm}  离散度 ${r.metrics.spreadMm}  达标模型 ${r.metrics.agreeCount}/3`);
  r.reasons.forEach((s) => console.log(`  · ${s}`));
  console.log(`解释[${rationaleSource}]  ${rationale}`);
  console.log(`inputHash  ${inputHash}`);
  console.log(`outputHash ${outputHash}`);
  console.log(`写入      ${file}`);
}

// ★ 被 require 时不要执行主流程 —— 否则测试脚本一 import 就会跑一遍判定并 process.exit
if (require.main === module) {
  main().catch((e) => {
    console.error("💥 判定失败：" + (e.message || e));
    process.exit(1);
  });
}

module.exports = { decide, buildRecord, DECISION, JUDGE_VERSION };
