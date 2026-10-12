/**
 * AI 判定 · 第 3 步 —— 把判定结果登记上链
 * ============================================================================
 *
 * 【上链的是什么、不是什么是关键】
 *   上链的只有：保单号 / 赔或不赔 / 置信度 / 两个 32 字节哈希 / 版本号。
 *   上链的【不是】判定过程，也【不是】钱。合约里 submitJudgement 只登记，不转账；
 *   要不要真的赔，仍然由 claim() 按写死的规则执行，而且要运营方另行触发。
 *
 *   这么切分是有意为之：
 *   · 链只担保「这个结论在某时刻被某个人提交过，且对应这份不可篡改的输入」；
 *   · 算错的后果不会自动变成资金损失；
 *   · 也因此不需要为「AI 判错」设计链上回滚 —— 那才是真的复杂且危险。
 *
 * 【第三方怎么验】
 *   1. 从链上读出 inputHash / outputHash；
 *   2. 拿到仓库里的 snapshot-policy<N>.json 与 judgement-policy<N>.json；
 *   3. 用 04-脚本/canonical.js 重算两个哈希，必须完全一致。
 *   本脚本在提交【之前】自己先做一遍第 3 步，对不上就拒绝提交 ——
 *   绝不把一笔哈希对不上的记录写进链，那等于自己给自己埋一个假证据。
 *
 * 【用法】
 *   node submit-judgement.js 0
 */

try { require("dotenv").config(); } catch (_) { /* dotenv 可选 */ }
const fs = require("fs");
const path = require("path");
const { JsonRpcProvider, Wallet, Contract } = require("ethers");
const { evidenceHashOf } = require("./canonical");

const RPC = process.env.SEPOLIA_RPC || process.env.RPC_URL || "http://127.0.0.1:8545";
const ADDR = process.env.CONTRACT_ADDRESS || "";
const KEY = process.env.PRIVATE_KEY || "";
const OUT_DIR = process.env.AI_OUT_DIR || path.join(__dirname, "..", "09-AI判定留痕");

// ABI 一律从 03-合约/*.abi.json 读，不手抄。
// 手抄的那份是 v1 的 submitJudgement（6 个参数），而 v2 在 confidence 后面多了
// uint8 sources（7 个参数）—— 用 v1 的签名去调 v2，会打到一个不存在的 selector 上，
// 回执只有 "execution reverted: 0x"，看不出是哪里错了（2026-10-07 在 968 上真踩到）。
const ABI_DIR = path.join(__dirname, "..", "03-合约");
const ABI_V1 = JSON.parse(fs.readFileSync(path.join(ABI_DIR, "RainDeliveryInsurance.abi.json"), "utf8"));
const ABI_V2 = JSON.parse(fs.readFileSync(path.join(ABI_DIR, "RainDeliveryInsuranceV2.abi.json"), "utf8"));
const ABI_V3 = JSON.parse(fs.readFileSync(path.join(ABI_DIR, "RainDeliveryInsuranceV3.abi.json"), "utf8"));

/* 指纹探测失败的两种原因必须分开：
   CALL_EXCEPTION / BAD_DATA = 这把 ABI 的函数在合约上真不存在 → 可以退回旧版；
   其它（超时 / ECONNREFUSED / 限流 / 节点 5xx）= 不知道链上是什么版本 → 必须抛出重试。
   原来一律 catch 成「不是 v3/v2」，等于把网络故障当成版本信号，接着用错版 ABI 去调
   submitJudgement —— 打到不存在的 selector，回执只有 "execution reverted: 0x"（10-07 在 968 上踩过）。 */
function isMissingFunction(e) {
  const code = (e && e.code) || (e && e.info && e.info.error && e.info.error.code);
  return code === "CALL_EXCEPTION" || code === "BAD_DATA";
}
function throwIfNetErr(kind, e) {
  if (isMissingFunction(e)) return;
  const err = new Error(
    `合约版本指纹探测失败（试 ${kind} 的只读函数时出错）：${(e && (e.shortMessage || e.message)) || e}\n` +
    `  这不是「链上没有这个函数」，是 RPC / 网络层面的问题 —— 不敢猜版本，请确认 RPC 可达后重跑。`
  );
  err.cause = e;
  throw err;
}

(async () => {
  const policyId = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)));
  if (!Number.isInteger(policyId)) { console.error("用法：node submit-judgement.js <policyId>"); process.exit(2); }
  if (!ADDR) { console.error("缺少 CONTRACT_ADDRESS"); process.exit(2); }
  if (!KEY) { console.error("缺少 PRIVATE_KEY（04-脚本/.env）"); process.exit(2); }

  const snapFile = path.join(OUT_DIR, `snapshot-policy${policyId}.json`);
  const judgeFile = path.join(OUT_DIR, `judgement-policy${policyId}.json`);
  for (const f of [snapFile, judgeFile]) {
    if (!fs.existsSync(f)) { console.error(`找不到 ${f}`); process.exit(2); }
  }
  const { snapshot, inputHash: snapHash } = JSON.parse(fs.readFileSync(snapFile, "utf8"));
  const { judgement, outputHash } = JSON.parse(fs.readFileSync(judgeFile, "utf8"));

  // ——— 提交前自检：两个哈希都要能重算出来 ———
  const recomputedIn = evidenceHashOf(snapshot);
  if (recomputedIn !== snapHash) { console.error(`💥 快照哈希对不上：${snapHash} ≠ ${recomputedIn}`); process.exit(1); }
  const recomputedOut = evidenceHashOf(judgement);
  if (recomputedOut !== outputHash) { console.error(`💥 判定哈希对不上：${outputHash} ≠ ${recomputedOut}`); process.exit(1); }
  if (judgement.inputHash !== snapHash) { console.error("💥 判定文件里记的 inputHash 与快照不匹配"); process.exit(1); }
  if (Number(judgement.policyId) !== policyId) { console.error("💥 判定文件里的保单号与参数不一致"); process.exit(1); }

  const provider = new JsonRpcProvider(RPC);
  const wallet = new Wallet(KEY, provider);
  // 按链上有没有 v2 的 thresholdOf() 选 ABI：两边的 submitJudgement 参数个数不同（v2 多 sources）。
  // 按链上有的「版本指纹」选 ABI：v3 entryThresholdOf(uint256)｜v2 thresholdOf(uint256)｜v1 THRESHOLD()。
  // 三版的 submitJudgement 参数个数都不同（v1 六参 / v2 七参 / v3 八参，v3 多 rainfallAtJudgement），
  // 签名错了会打到不存在的 selector 上，回执只有 "execution reverted: 0x"。
  let c = new Contract(ADDR, ABI_V3, wallet);
  let kind = "v3";
  try { await c.entryThresholdOf(24); }
  catch (e) {
    throwIfNetErr("v3", e);
    kind = "v2";
    c = new Contract(ADDR, ABI_V2, wallet);
    try { await c.thresholdOf(24); }
    catch (e2) { throwIfNetErr("v2", e2); kind = "v1"; c = new Contract(ADDR, ABI_V1, wallet); }
  }
  const isV2 = kind === "v2";

  const operator = (await c.operator()).toLowerCase();
  if (wallet.address.toLowerCase() !== operator) {
    console.error(`💥 这把私钥不是 operator。\n   operator = ${operator}\n   本私钥   = ${wallet.address.toLowerCase()}`);
    process.exit(1);
  }

  const before = await c.judgements(policyId);
  if (before.exists) {
    console.error(`💥 保单 #${policyId} 已有判定（合约规定一份保单只判一次），不重复提交。`);
    process.exit(1);
  }
  const statusBefore = await c.policyStatus(policyId);

  console.log("=".repeat(74));
  console.log(`提交 AI 判定上链（保单 #${policyId}）`);
  console.log("=".repeat(74));
  console.log(`结论      ${judgement.decisionLabel}  置信度 ${judgement.confidence}  版本 ${judgement.judgeVersion}`);
  console.log(`提交前状态 ${statusBefore}`);
  console.log(`inputHash  ${snapHash}`);
  console.log(`outputHash ${outputHash}`);

  const tx = await (kind === "v3"
    ? c.submitJudgement(policyId, judgement.decision, judgement.confidence, judgement.sources,
                        snapshot.oracle.cumulativeMm,   // v3：判定当时的链上读数（增量=它−买入基线）
                        snapHash, outputHash, judgement.judgeVersion)
    : isV2
    ? c.submitJudgement(policyId, judgement.decision, judgement.confidence, judgement.sources,
                        snapHash, outputHash, judgement.judgeVersion)
    : c.submitJudgement(policyId, judgement.decision, judgement.confidence,
                        snapHash, outputHash, judgement.judgeVersion));
  console.log(`交易已发出 ${tx.hash}  等待打包…`);
  const rc = await tx.wait();
  console.log(`✅ 已上链  区块 ${rc.blockNumber}  gas ${rc.gasUsed}`);

  // ——— 读回校验：链上存下来的必须与本地文件逐字段一致 ———
  const after = await c.judgements(policyId);
  const checks = [
    ["exists", after.exists === true],
    ["decision", Number(after.decision) === Number(judgement.decision)],
    ["confidence", Number(after.confidence) === Number(judgement.confidence)],
    ["inputHash", after.inputHash === snapHash],
    ["outputHash", after.outputHash === outputHash],
    ["modelVersion", after.modelVersion === judgement.judgeVersion],
  ];
  if (isV2) checks.push(["sources", Number(after.sources) === Number(judgement.sources)]);   // v2 才写 sources
  if (kind === "v3") checks.push(["rainfallAtJudgement",
    Number(after.rainfallAtJudgement) === Number(snapshot.oracle.cumulativeMm)]);
  const bad = checks.filter(([, ok]) => !ok).map(([k]) => k);
  console.log("读回校验    " + (bad.length ? `❌ 不一致：${bad.join(", ")}` : `✅ ${checks.length}/${checks.length} 个字段与本地文件一致`));
  console.log(`提交后状态 ${await c.policyStatus(policyId)}`);
  if (bad.length) process.exit(1);
})().catch((e) => {
  console.error("💥 提交失败：" + (e.shortMessage || e.message || e));
  const inner = e.info && e.info.error && e.info.error.message;
  if (inner) console.error("   链上原始回执: " + inner);
  process.exit(1);
});
