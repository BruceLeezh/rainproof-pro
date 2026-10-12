/**
 * 把 03-合约/*.abi.json 同步进前端 HTML 的内嵌 ABI —— 并当门禁用（--check）。
 *
 * 【为什么需要它】
 *   index.html 为了能单文件离线双击打开，把 ABI 内嵌在 `const ABI = [...]` 里。
 *   合约一改（改了事件参数、加了函数），ABI 如果没同步，页面**不会报任何错** ——
 *   它只会静默地解错字段、查不到记录、事件表少一类。这是最难在演示现场发现的一类故障。
 *   所以它既是一条同步命令，也是一道门禁：`--check` 挂进了 `npm test`。
 *
 * 【这个脚本踩过的两个坑，都记在这儿】
 *   坑 1（2026-10-08）：源文件写死 v1 ⇒ 跑一次 `npm run build`，页面上正在用的 v2 ABI 被 v1
 *     覆盖，页面不报错、只是静默少认一批事件与字段。当时的修法是「按签名集合认领来源」。
 *   坑 2（2026-10-12）：演示页要同时支持主网 677(v3) 与测试网 968(v2)，于是把两份 ABI 并成
 *     一个 99 条的**并集**。并集里 `judgements()` / `policies()` 只能留一个版本的 outputs ⇒
 *     在另一条链上按错误的字段表解码（judgements 少一个 rainfallAtJudgement、policies 少一个
 *     payer）；而且「按签名集合认领」从此谁也认不出（页面 = 95 ∪ 85，跟哪一份都不完全一样），
 *     sync-abi 长期 exit 1，门禁里又没挂它 —— 于是一直没被看见。
 *
 * 【现在的做法】两个块各认一个来源，来源写死在 BLOCKS 里，不猜：
 *   `const ABI`     ← 03-合约/RainDeliveryInsuranceV3.abi.json  （主网 677，页面第一目标）
 *   `const ABI_V2`  ← 03-合约/RainDeliveryInsuranceV2.abi.json  （测试网 968，自动降级时用）
 *   页面按链上探针选块（`entryThresholdOf(uint256)` 只有 v3 有），选错不会报错、只会解错，
 *   所以这道门禁是必要的：块必须与合约逐字节相同。
 *
 * 用法：
 *   node sync_abi.js              # 按 BLOCKS 把两个块同步成合约里的那一版（写盘）
 *   node sync_abi.js --check      # 只报告、不写盘；不一致就 exit 1（npm test 里的用法）
 *   node sync_abi.js --force      # 允许条目数变少（确认合约真的删了入口才用）
 *   node sync_abi.js --self-check # 自检（判定逻辑 + 临时文件上的真写盘）
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CONTRACT_DIR = path.join(ROOT, "03-合约");
const TARGETS = [path.join(ROOT, "05-演示站点", "index.html")];

/* 页面里每个 ABI 块 ← 哪个合约文件。顺序 = 页面按链上探针挑块的优先级。 */
const BLOCKS = [
  { varName: "ABI", dest: "RainDeliveryInsuranceV3", note: "主网 677 的 v3 合约（页面第一目标）" },
  { varName: "ABI_V2", dest: "RainDeliveryInsuranceV2", note: "测试网 968 的 v2 合约（主网连不上时自动降级用）" },
];

// 只匹配「整行就是一个 const X = [...];」，并用 $1 保留原文件的行尾（\r\n 或 \n）
function reFor(varName, flags) {
  return new RegExp(`^const ${varName} = \\[.*?\\];([ \\t]*\\r?)$`, flags);
}

/* ------------------------------------------------------------------ 纯逻辑 */

/** 一个 ABI 条目 → 可比对的签名串（函数/事件/错误各带前缀；其它类型用 type+name 兜底） */
function sigOf(e) {
  const ins = (e.inputs || []).map((i) => i.type).join(",");
  if (e.type === "function") return `fn ${e.name}(${ins})`;
  if (e.type === "event") return `ev ${e.name}(${ins})`;
  if (e.type === "error") return `er ${e.name}(${ins})`;
  return `${e.type} ${e.name || ""}(${ins})`;
}
const setOf = (abi) => new Set(abi.map(sigOf));
const sameAbi = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** 03-合约 下的候选源：名字 → {name, file, abi} */
function loadCandidates(dir = CONTRACT_DIR) {
  const out = new Map();
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".abi.json"))) {
    const file = path.join(dir, f);
    const name = f.replace(/\.abi\.json$/, "");
    out.set(name, { name, file, abi: JSON.parse(fs.readFileSync(file, "utf8")) });
  }
  return out;
}

function candFor(dest, cands = loadCandidates()) {
  const c = cands.get(dest);
  if (!c) throw new Error(`03-合约/${dest}.abi.json 不存在；候选：${[...cands.keys()].join(" / ")}`);
  return c;
}

/** 从 HTML 源码里取出某个块的 ABI（找不到 / 有多处都算致命，宁可不写） */
function extractAbi(src, rel, varName) {
  const hits = (src.match(reFor(varName, "gm")) || []).length;
  if (hits !== 1) {
    throw new Error(`${rel}: 期望恰好找到 1 处 const ${varName} = [...]，实际 ${hits} 处 —— 拒绝写入`);
  }
  return JSON.parse(src.match(reFor(varName, "m"))[0]
    .replace(new RegExp(`^const ${varName} = `), "")
    .replace(/;[ \t\r]*$/, ""));
}

/** 两份 ABI 的签名差（只用于打印人看的差集；判定用的是整份 JSON 逐字节相等） */
function delta(pageAbi, destAbi) {
  const P = setOf(pageAbi), D = setOf(destAbi);
  return { onlyPage: [...P].filter((s) => !D.has(s)), onlyDest: [...D].filter((s) => !P.has(s)) };
}

/** 单个块的判定（不写盘）。返回 {varName, dest, before, after, changed, next, delta} */
function planBlock(src, rel, block, { force = false, cands = loadCandidates() } = {}) {
  const cand = candFor(block.dest, cands);
  const current = extractAbi(src, rel, block.varName);
  const changed = !sameAbi(current, cand.abi);
  // ★ 降级守卫：块的条目数变少 = 要么合约真的删了入口，要么来源认错了。两者都要显式 --force。
  if (changed && cand.abi.length < current.length && !force) {
    throw new Error(
      `${rel}: 拒绝把 const ${block.varName} 从 ${current.length} 条换成 ${cand.abi.length} 条（${cand.name}）。\n` +
      `  条目变少通常是来源认错了（覆盖后页面不会报错，只会静默解错字段/漏事件）。` +
      `确认是合约真的删了入口，就加 --force。`
    );
  }
  const next = src.replace(reFor(block.varName, "m"), `const ${block.varName} = ${JSON.stringify(cand.abi)};$1`);
  return {
    varName: block.varName, dest: cand.name, note: block.note,
    before: current.length, after: cand.abi.length, changed, next,
    delta: changed ? delta(current, cand.abi) : null,
  };
}

/** 单个目标文件的同步。返回 {rel, blocks:[plan…], changed, wrote} */
function syncOne(file, { force = false, check = false, cands = loadCandidates(), blocks = BLOCKS } = {}) {
  const rel = path.relative(ROOT, file);
  let src = fs.readFileSync(file, "utf8");
  const plans = [];
  for (const b of blocks) {
    const p = planBlock(src, rel, b, { force, cands });
    src = p.next;          // 串行改写：第二个块在第一个块改完的文本上继续
    plans.push(p);
  }
  const changed = plans.some((p) => p.changed);
  const wrote = changed && !check;
  if (wrote) fs.writeFileSync(file, src, "utf8");
  return { rel, blocks: plans, changed, wrote };
}

/* ------------------------------------------------------------------ 命令行 */

const fmtList = (xs) =>
  xs.length === 0 ? "无" : xs.slice(0, 6).join(" ／ ") + (xs.length > 6 ? ` …（共 ${xs.length} 条）` : "");

function main() {
  const argv = process.argv.slice(2);
  const opts = { force: argv.includes("--force"), check: argv.includes("--check") };
  const total = TARGETS.length * BLOCKS.length;
  let drifted = 0;
  for (const file of TARGETS) {
    const r = syncOne(file, opts);
    console.log(r.rel);
    for (const p of r.blocks) {
      const tail = !p.changed
        ? `✅ const ${p.varName.padEnd(7)} ← ${p.dest}.abi.json（${p.after} 条，逐字节一致）`
        : (opts.check
          ? `❌ const ${p.varName.padEnd(7)} ← ${p.dest}.abi.json（页面 ${p.before} 条 → 合约 ${p.after} 条）`
          : `✅ const ${p.varName.padEnd(7)} ← ${p.dest}.abi.json（已写入 ${p.after} 条，原 ${p.before} 条）`);
      console.log("  " + tail);
      if (p.changed) {
        console.log(`      页面有、合约没有：${fmtList(p.delta.onlyPage)}`);
        console.log(`      合约有、页面没有：${fmtList(p.delta.onlyDest)}`);
        drifted++;
      }
    }
  }
  if (opts.check) {
    if (drifted) {
      console.error(
        `\n❌ 内嵌 ABI 与 03-合约 不一致（${drifted} / ${total} 个块）—— 页面不会报错，只会静默解错字段、少认事件。\n` +
        `   跑 node 07-测试工具/sync_abi.js（或 npm run sync-abi）同步后重跑门禁。`
      );
      process.exit(1);
    }
    console.log(`\n✅ 通过 ${total} 项 · 失败 0 项（${TARGETS.length} 个文件 × ${BLOCKS.length} 个 ABI 块：内嵌 ABI 与 03-合约 逐字节一致）`);
    return;
  }
  console.log(`\n共同步 ${TARGETS.length} 个文件 × ${BLOCKS.length} 个 ABI 块${drifted ? "" : "（本来就一致，未改动）"}`);
}

/* ------------------------------------------------------------------ 自检 */

function selfCheck() {
  let pass = 0, fail = 0;
  const ok = (m, c, extra = "") => { c ? (pass++, console.log(`  ✅ ${m}${extra ? "  " + extra : ""}`)) : (fail++, console.log(`  ❌ ${m}  ${extra}`)); };
  const throws = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };

  const F = (n, ins = []) => ({ type: "function", name: n, inputs: ins.map((t) => ({ type: t })) });
  const E = (n, ins = []) => ({ type: "event", name: n, inputs: ins.map((t) => ({ type: t })) });
  const A3 = [F("a"), F("b", ["uint256"]), E("e", ["address"])];
  const B2 = [F("a"), F("b", ["uint256"])];
  const mk = (n, abi) => ({ name: n, file: `/x/${n}.abi.json`, abi });
  const cands = new Map([["Alpha", mk("Alpha", A3)], ["Beta", mk("Beta", B2)]]);
  const blocks = [{ varName: "ABI", dest: "Alpha" }, { varName: "ABI_V2", dest: "Beta" }];

  ok("签名串区分类型与参数表（fn/ev 前缀）",
    sigOf(F("b", ["uint256"])) === "fn b(uint256)" && sigOf(E("e", ["address"])) === "ev e(address)");
  ok("差集按签名算（同名不同参数不算同一条）",
    delta([F("b", ["uint256"])], [F("b", ["uint8"])]).onlyPage.length === 1);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "syncabi-"));
  const tpl = (a1, a2) => `<!doctype html>\n<html><body>\nconst ABI = ${JSON.stringify(a1)};\nconst ABI_V2 = ${JSON.stringify(a2)};\n</body></html>\n`;
  const tmp = path.join(dir, "index.html");

  fs.writeFileSync(tmp, tpl(A3, B2), "utf8");
  const r1 = syncOne(tmp, { cands, blocks });
  ok("两块都对上合约 → 判定为无需改动（不产生无谓 diff）",
    r1.changed === false && r1.wrote === false && fs.readFileSync(tmp, "utf8") === tpl(A3, B2));
  ok("块名不会互相串（ABI 的正则不吃 ABI_V2）",
    (() => { const s = fs.readFileSync(tmp, "utf8"); return extractAbi(s, "x", "ABI").length === 3 && extractAbi(s, "x", "ABI_V2").length === 2; })());

  fs.writeFileSync(tmp, tpl(B2, B2), "utf8");      // ABI 块落后一版，ABI_V2 是对的
  const r2 = syncOne(tmp, { cands, blocks, check: true });
  ok("--check：认出 ABI 块不一致、且一个字节都不写",
    r2.changed === true && r2.wrote === false && fs.readFileSync(tmp, "utf8") === tpl(B2, B2));
  ok("--check 只把不一致的那个块报出来（ABI_V2 不动）",
    r2.blocks[0].changed === true && r2.blocks[1].changed === false);
  const r3 = syncOne(tmp, { cands, blocks });
  ok("正常同步：条目变多的那一块被写进去了",
    r3.wrote === true && fs.readFileSync(tmp, "utf8") === tpl(A3, B2));

  fs.writeFileSync(tmp, tpl(A3, A3), "utf8");      // ABI_V2 块里塞着条目更多的 Alpha，dest 却是 Beta
  const guardMsg = throws(() => syncOne(tmp, { cands, blocks })) || "";
  ok("降级守卫：条目数变少 → 抛错并告诉你怎么覆盖",
    /拒绝把 const ABI_V2 从 3 条换成 2 条/.test(guardMsg) && /--force/.test(guardMsg));
  ok("被守卫拦下时文件没被动过", fs.readFileSync(tmp, "utf8") === tpl(A3, A3));
  const r4 = syncOne(tmp, { cands, blocks, force: true });
  ok("--force 明确放行（A3 → B2 能写进去）",
    r4.wrote === true && fs.readFileSync(tmp, "utf8") === tpl(A3, B2));

  ok("块缺失 / 重复都拒绝（宁可不写）", (() => {
    const missing = `<!doctype html>\n<p>这里没有 ABI</p>\n`;
    const dup = `const ABI = [];\nconst ABI = [];\n`;
    const onlyOne = `const ABI = [];\n`;
    return !!throws(() => extractAbi(missing, "x", "ABI"))
      && !!throws(() => extractAbi(dup, "x", "ABI"))
      && !!throws(() => extractAbi(onlyOne, "x", "ABI_V2"));
  })());
  ok("来源名字打错时把候选列出来（不静默换版）",
    /候选/.test(throws(() => candFor("Nope", cands)) || ""));

  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* 临时目录，清不掉也不影响结论 */ }

  // 真仓库：两个块都得在（只验结构，不验一致性 —— 一致性由 --check / npm test 负责）
  const realRel = path.relative(ROOT, TARGETS[0]);
  const real = fs.readFileSync(TARGETS[0], "utf8");
  ok(`真仓库 ${realRel} 里两个 ABI 块都在（${BLOCKS.map((b) => b.varName).join(" + ")}）`,
    BLOCKS.every((b) => (real.match(reFor(b.varName, "gm")) || []).length === 1));

  console.log(`\n${fail ? "❌" : "✅"} sync_abi 自检：${pass} 项通过 / ${fail} 项失败`);
  process.exit(fail ? 1 : 0);
}

module.exports = { BLOCKS, sigOf, setOf, loadCandidates, candFor, extractAbi, delta, planBlock, syncOne };

if (require.main === module && process.argv.includes("--self-check")) selfCheck();
else if (require.main === module) {
  try { main(); } catch (e) {
    console.error(`\n❌ ${e.message}`);
    process.exit(1);
  }
}
