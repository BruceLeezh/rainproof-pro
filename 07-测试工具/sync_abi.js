/**
 * 把 03-合约/*.abi.json 同步进 05-演示站点/index.html 的内嵌 ABI。
 *
 * 【接口（2026-10-12 重写；旧版「自动认源」已废弃）】
 *   页面按链分派**两份**内嵌 ABI，各占一整行、单行 JSON：
 *     const ABI_V2 = [...]   ←  03-合约/RainDeliveryInsuranceV2.abi.json   （968 测试网 v2 演示基线）
 *     const ABI_V3 = [...]   ←  03-合约/RainDeliveryInsuranceV3.abi.json   （677 主网 v3 现行基线）
 *   本脚本是这两行唯一的生成者：两份数组与两份 abi.json **一对一钉死**，不再「按页面现有签名猜源」。
 *
 * 【为什么需要它】
 *   页面内嵌 ABI 是手抄的副本：合约一改（改事件参数、加字段），页面**不会报错** ——
 *   ethers 只会静默解码错位（实测：v3 的 16 字段用 v2 的 15 字段读法解出来整串错移一位，
 *   区域/保费/时间窗/阈值/赔付额全变成假数字）。这是最难在演示现场发现的一类故障。
 *
 * 【旧接口为什么必须换】
 *   旧版只接受「与页面现有签名集合完全一致」的唯一候选。2026-10-12 实测：页面是 v2∪v3 并集
 *   （99 条，v3 95 ∩ v2 85 = 81），03-合约/ 里没有任何一份能对上 ⇒ `node sync_abi.js --check`
 *   永远 exit 1、`npm run build`（compile && sync-abi）必然失败（全仓扫描 E3）。
 *
 * 【兼容期】页面若还没有这两行（仍是合并的 `const ABI = [...]`），本脚本给出明确错误
 *   （点名缺哪一行、该对齐哪个 abi.json、怎么修），不抛栈。
 *
 * 用法：
 *   node sync_abi.js                  # 两份都写回页面（已一致则不写盘，避免无谓 diff）
 *   node sync_abi.js --check          # 只比对不写盘；不一致 exit 1，分份列出 缺/多/同签名定义不同
 *   node sync_abi.js --file=<路径>     # 换目标文件（默认 05-演示站点/index.html；测试用）
 *   node sync_abi.js --self-check     # 自检（纯逻辑 + 临时文件上的真写盘 + 兼容期错误路径）
 *
 * 导出（供 check-page-decode.js 复用同一套「页面里哪一行是 ABI_V3」的取法）：
 *   sigOf / diffAbi / extractAbi / syncOne / PAIRS / TARGET
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CONTRACT_DIR = path.join(ROOT, "03-合约");
const TARGET = path.join(ROOT, "05-演示站点", "index.html");
// 页面里的两份内嵌 ABI ↔ 03-合约/ 里的两份 abi.json（一对一；不猜、不合并）
const PAIRS = [
  { constName: "ABI_V2", abiFile: "RainDeliveryInsuranceV2.abi.json" },
  { constName: "ABI_V3", abiFile: "RainDeliveryInsuranceV3.abi.json" },
];
// 只匹配「整行就是一个 const <名字> = [...];」的那种，并保留原文件的行尾与尾随空白
const srcRe = (name) => new RegExp(`^const ${name} = \\[.*?\\];([ \\t]*\\r?)$`, "m");
const srcReG = (name) => new RegExp(`^const ${name} = \\[.*?\\];([ \\t]*\\r?)$`, "gm");
const howToFix = () =>
  PAIRS.map((p) => `${p.constName} ← 03-合约/${p.abiFile}`).join("；") +
  "。修法：把合并的那份 ABI 拆成两行（或手抄对应的 .abi.json），一行一个单行数组，其余行不动。";

/* ------------------------------------------------------------------ 纯逻辑 */

/** 一个 ABI 条目 → 可比对的签名串（函数/事件/错误各带前缀；其它类型用 type+name 兜底） */
function sigOf(e) {
  const ins = (e.inputs || []).map((i) => i.type).join(",");
  if (e.type === "function") return `fn ${e.name}(${ins})`;
  if (e.type === "event") return `ev ${e.name}(${ins})`;
  if (e.type === "error") return `er ${e.name}(${ins})`;
  return `${e.type} ${e.name || ""}(${ins})`;
}
const bySig = (abi) => { const m = new Map(); for (const e of abi) m.set(sigOf(e), e); return m; };

/**
 * 页面内嵌 ABI 与磁盘 ABI 的差集。
 * 签名集合的比较与顺序无关（页面把条目重排过不算不一致）；同一签名下**定义**不同
 * （比如 outputs 少一个字段 —— 正是「v3 payload 按 v2 形状解码」那个 bug）单独列为 different。
 */
function diffAbi(pageAbi, diskAbi) {
  const P = bySig(pageAbi), D = bySig(diskAbi);
  const missing = [...D.keys()].filter((s) => !P.has(s));
  const extra = [...P.keys()].filter((s) => !D.has(s));
  const different = [...D.keys()].filter((s) => P.has(s) && JSON.stringify(P.get(s)) !== JSON.stringify(D.get(s)));
  return { missing, extra, different };
}

/** 从 HTML 源码里取出内嵌 ABI（找不到 / 不唯一都算致命，且错误信息要说清怎么修） */
function extractAbi(src, constName, rel = "index.html") {
  const hits = (src.match(srcReG(constName)) || []).length;
  if (hits === 0) {
    throw new Error(
      `${rel}: 找不到 \`const ${constName} = [...]\`（期望恰好 1 处，实际 0 处）—— 页面还没按链拆成两份 ABI。\n` +
      `  期望：${howToFix()}`
    );
  }
  if (hits > 1) {
    throw new Error(`${rel}: 找到 ${hits} 处 \`const ${constName} = [...]\`，不唯一 —— 拒绝写入（期望恰好 1 处）`);
  }
  return JSON.parse(src.match(srcRe(constName))[0].replace(`const ${constName} = `, "").replace(/;[ \t\r]*$/, ""));
}

/**
 * 单个 const 的比对结果（纯函数：只读 src 与磁盘 abi.json，不写盘）。
 * diskAbi 可注入（自检用；默认读 03-合约/<abiFile>）。
 * 返回 { constName, pageAbi, diskAbi, diff, bad, line: 写回后的该行, changed }
 */
function syncOne(src, rel, pair, { diskAbi = null } = {}) {
  const disk = diskAbi || JSON.parse(fs.readFileSync(path.join(CONTRACT_DIR, pair.abiFile), "utf8"));
  const pageAbi = extractAbi(src, pair.constName, rel);
  const diff = diffAbi(pageAbi, disk);
  const bad = diff.missing.length + diff.extra.length + diff.different.length;
  const line = `const ${pair.constName} = ${JSON.stringify(disk)};$1`;
  const next = src.replace(srcRe(pair.constName), line);
  return { constName: pair.constName, abiFile: pair.abiFile, pageAbi, diskAbi: disk, diff, bad, next, changed: next !== src };
}

/** 两份 ABI 一起过一遍。check=true 时只比对：out 原样返回（一个字节都不落地） */
function syncAll(src, rel, { check = false, diskAbis = {} } = {}) {
  let bad = 0, out = src;
  const results = [];
  for (const pair of PAIRS) {
    const r = syncOne(src, rel, pair, { diskAbi: diskAbis[pair.constName] || null });
    results.push(r);
    bad += r.bad;
    if (!check) out = out.replace(srcRe(pair.constName), `const ${pair.constName} = ${JSON.stringify(r.diskAbi)};$1`);
  }
  return { bad, out, changed: out !== src, results };
}

/* ------------------------------------------------------------------ 命令行 */

function main() {
  const argv = process.argv.slice(2);
  const arg = (k) => { const h = argv.find((a) => a.startsWith(`${k}=`)); return h ? h.slice(k.length + 1) : null; };
  const check = argv.includes("--check");
  const file = arg("--file") || TARGET;
  const rel = path.relative(ROOT, file);
  const src = fs.readFileSync(file, "utf8");

  console.log(`同步 ${rel} ⇄ 03-合约/*.abi.json${check ? "（--check：只比对，一个字节都不写）" : ""}`);
  const { bad, out, changed, results } = syncAll(src, rel, { check });
  for (const r of results) {
    console.log(`\n  ${r.constName} ⇄ ${r.abiFile}  （页面 ${r.pageAbi.length} 条 / 磁盘 ${r.diskAbi.length} 条）`);
    console.log(r.bad ? `    ❌ ${r.bad} 处不一致` : "    ✅ 逐条一致");
    for (const [label, list] of [
      ["缺（磁盘有、页面没有）", r.diff.missing],
      ["多（页面有、磁盘没有）", r.diff.extra],
      ["同签名定义不同", r.diff.different],
    ]) for (const s of list) console.log(`      - ${label}：${s}`);
  }

  if (check) {
    console.log(`\n${bad ? "❌" : "✅"} --check：${bad} 处不一致（页面一个字节都没写）`);
    process.exit(bad ? 1 : 0);
  }
  if (out === src) {
    console.log("\n✅ 页面与 03-合约/*.abi.json 已逐条一致，不写盘（避免无谓 diff）");
    process.exit(0);
  }
  fs.writeFileSync(file, out, "utf8");
  console.log(`\n✅ 已写回 ${rel}（两份数组各一行单行 JSON，行尾与其余行未动；共修正 ${changed ? results.filter((r) => r.changed).length : 0} 处）`);
}

/* ------------------------------------------------------------------ 自检 */

function selfCheck() {
  let pass = 0, fail = 0;
  const ok = (m, c, extra = "") => { c ? (pass++, console.log(`  ✅ ${m}${extra ? "  " + extra : ""}`)) : (fail++, console.log(`  ❌ ${m}  ${extra}`)); };
  const throws = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };
  const F = (n, ins = [], outs = []) => ({ type: "function", name: n, inputs: ins.map((t) => ({ type: t })), outputs: outs.map((t) => ({ type: t })) });
  const E = (n, ins = []) => ({ type: "event", name: n, inputs: ins.map((t) => ({ type: t })) });

  // 假磁盘 ABI：policies 分 v3(3 字段) / v2(2 字段) 两种形状，正好对应真实那份的差异
  const V3 = [F("policies", ["uint256"], ["address", "address", "uint8"]), F("thresholdOf", ["uint256", "uint8"], ["uint256"]), E("FeedRejected", ["uint8"])];
  const V2 = [F("policies", ["uint256"], ["address", "uint8"]), F("thresholdOf", ["uint256"], ["uint256"]), E("FeedRejected", ["uint8"])];
  const diskAbis = { ABI_V2: V2, ABI_V3: V3 };

  ok("签名串区分类型与参数（fn/ev 前缀 + 参数表）",
    sigOf(F("b", ["uint256"])) === "fn b(uint256)" && sigOf(E("e", ["address"])) === "ev e(address)");
  ok("顺序打乱不算不一致（按签名集合比）", (() => {
    const d = diffAbi([V3[2], V3[0], V3[1]], V3);
    return d.missing.length === 0 && d.extra.length === 0 && d.different.length === 0;
  })());
  ok("少一条 → 进 missing", (() => { const d = diffAbi(V3.slice(1), V3); return d.missing.length === 1 && d.missing[0] === sigOf(V3[0]); })());
  ok("多一条 → 进 extra", diffAbi([...V3, F("extra")], V3).extra.length === 1);
  ok("同签名但 outputs 形状不同 → 进 different（v3/v2 结构体就是这个差）",
    (() => { const d = diffAbi(V2, V3); return d.different.some((s) => /policies/.test(s)) && d.missing.length === 1; })());

  // 兼容期：页面没有 ABI_V2 / 有重复 / 一行都不是 —— 都要给出可读错误而不是崩栈
  const msgNoV2 = throws(() => extractAbi(`<html>\nconst ABI_V3 = ${JSON.stringify(V3)};\n</html>`, "ABI_V2", "index.html")) || "";
  ok("页面缺 ABI_V2 → 明确报「找不到 ABI_V2」而不是崩栈",
    /找不到 `const ABI_V2 = \[\.\.\.\]`/.test(msgNoV2), "");
  ok("该错误里点名要对齐的文件与修法",
    /RainDeliveryInsuranceV2\.abi\.json/.test(msgNoV2) && /拆成两行/.test(msgNoV2));
  ok("同一名字出现两处 → 拒绝（不唯一）",
    !!throws(() => extractAbi(`const ABI_V3 = [];\nconst ABI_V3 = [];\n`, "ABI_V3", "index.html")));

  // 真写盘：临时文件上做（不碰仓库），CRLF 与前后行必须原样保留
  const tpl = (v2, v3) => `<!doctype html>\r\n<html><body>\r\nconst ABI_V2 = ${JSON.stringify(v2)};\r\nconst ABI_V3 = ${JSON.stringify(v3)};\r\n</body></html>\r\n`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "syncabi-"));
  const tmpRel = "tmp/index.html";

  const stale = tpl(V2, V2);                                  // ABI_V3 手抄成了 v2 形状 ← 正是要抓的漂移
  const chk = syncAll(stale, tmpRel, { check: true, diskAbis });
  ok("--check：有差异 ⇒ bad>0（main 据此 exit 1）且 out 原样返回（一个字节都不落地）",
    chk.bad > 0 && chk.out === stale);
  const wr = syncAll(stale, tmpRel, { diskAbis });
  ok("写模式：两份都按磁盘 abi.json 重写，且报出与原文件的差异",
    wr.changed === true && wr.out.includes(`const ABI_V3 = ${JSON.stringify(V3)};`) && wr.bad > 0);
  ok("写回时另一行（ABI_V2）与行尾/前后文逐字节未动", (() => {
    const lines = wr.out.split("\r\n");
    return lines.length === stale.split("\r\n").length &&
      lines[2] === `const ABI_V2 = ${JSON.stringify(V2)};` &&
      lines[4] === "</body></html>";
  })());
  ok("已经一致 ⇒ changed=false（不产生无谓 diff）",
    syncAll(tpl(V2, V3), tmpRel, { diskAbis }).changed === false);
  ok("两份都对得上时 bad=0（= --check exit 0）",
    syncAll(tpl(V2, V3), tmpRel, { check: true, diskAbis }).bad === 0);

  // 真文件 IO：把 wr.out 落盘再读回解析（确认单行 JSON 能被重新抽出）
  const tmp = path.join(dir, "index.html");
  fs.writeFileSync(tmp, wr.out, "utf8");
  const back = fs.readFileSync(tmp, "utf8");
  ok("落盘后能被自己的 extractAbi 原样读回（单行 JSON 往返）",
    JSON.stringify(extractAbi(back, "ABI_V3", tmpRel)) === JSON.stringify(V3));
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* 临时目录，清不掉不影响结论 */ }

  console.log(`\n${fail ? "❌" : "✅"} sync_abi 自检：${pass} 项通过 / ${fail} 项失败`);
  process.exit(fail ? 1 : 0);
}

module.exports = { sigOf, diffAbi, extractAbi, syncOne, syncAll, PAIRS, TARGET, CONTRACT_DIR };

if (require.main === module && process.argv.includes("--self-check")) selfCheck();
else if (require.main === module) {
  try { main(); } catch (e) {
    console.error(`\n❌ ${e.message}`);
    process.exit(1);
  }
}
