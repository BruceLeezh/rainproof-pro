/*
 * 门禁：页面内嵌 ABI 的**输出形状**必须与真链返回对得上（E1 盲区）。
 *
 * 为什么需要它：sync_abi.js --check 只比签名（函数名 + 输入类型），故意忽略 outputs。
 * 于是页面把 v3 的 16 字 policies 用 v2 的 15 字段读法解出来「不抛错、整串错移一位」
 * （rider 之后 productId←payer、regionId←productId、premium←regionId…），
 * judgements/feedJudgements 的 10 字返回用 v2 形状解码直接抛错、被空 catch 吞掉 ——
 * 也就是说：门禁全绿也证明不了页面读得对。本脚本用真 ethers 解码把这条钉死。
 *
 * 做法：从 05-演示站点/index.html 抽出同一份 ABI_V3 建 ethers.Interface，
 *   ① 用 03-合约/RainDeliveryInsuranceV3.abi.json 作真值侧 encodeFunctionResult 合成 payload，
 *      再用**页面**的 ABI 去 decode，断言字段数/字段名/取值；
 *   ② 把同一份 payload 丢给页面 ABI_V2（v2 形状）解，断言解不出 v3 的形状（证明这条门禁有牙）；
 *   ③ 快照 05-演示站点/frozen-node.js 里存在的真实返回（48 条：46 条 hex 返回 + 2 条 {revert:true}）逐条用页面 ABI 解码。
 * 快照里没有 policies/judgements/feedJudgements（make-frozen-node.js 没采这几条），
 * 所以形状由 ① 的合成 payload 覆盖；② 复现的正是 677 上那个错位解码的 bug。
 *
 * 用法：
 *   node check-page-decode.js                     # 门禁模式：全对 exit 0，否则 exit 1
 *   node check-page-decode.js --file=<页面路径>   # 拿别的 HTML 顶替 05-演示站点/index.html（负样本验证用）
 *   node check-page-decode.js --self-check        # 只跑内部构造的自检（不读仓库文件）
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const TOOLS = path.join(__dirname, "node_modules");
const { ethers } = require(path.join(TOOLS, "ethers"));
const { extractAbi, TARGET } = require("./sync_abi.js");

const ARG = (k) => { const h = process.argv.slice(2).find((a) => a.startsWith(`${k}=`)); return h ? h.slice(k.length + 1) : null; };
const V3_ABI = path.join(ROOT, "03-合约", "RainDeliveryInsuranceV3.abi.json");
const FROZEN = path.join(ROOT, "05-演示站点", "frozen-node.js");

/** 结构体读法 → 期望输出字段数（v3 形状；v2 分别是 15/9/9，差一位就会错移） */
const SHAPES = { "policies(uint256)": 16, "judgements(uint256)": 10, "feedJudgements(uint8)": 10 };

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? `\n       ${extra}` : ""}`); }
};
const namesOf = (iface, sig) => iface.getFunction(sig).outputs.map((o) => o.name);

/** 构造器没有 sighash，形状比对时两侧一起跳过（abi.json 里确实带 constructor 条目） */
const shape = (iface) => iface.fragments.filter((f) => f.type !== "constructor")
  .map((f) => [f.format("sighash"), f.type, (f.outputs || []).map((o) => `${o.type} ${o.name}`)]);

/** 按 ABI 类型造可辨识的哨兵值，好证明「解出来的位置对」 */
function sentinels(frag) {
  return frag.outputs.map((o, i) => {
    if (o.type === "address") return ethers.getAddress("0x" + String(0x11 + i).padStart(2, "0").repeat(20));
    if (o.type === "bool") return i % 2 === 0;
    if (o.type === "string") return `v3-field-${i}`;
    if (o.type === "bytes32") return ethers.zeroPadValue("0x" + String((0x30 + i) % 256).padStart(2, "0").repeat(20), 32);
    if (/^u?int\d*$/.test(o.type)) {                       // uint8/uint64/uint256… 哨兵必须落在类型宽度内
      const bits = BigInt((o.type.match(/\d+/) || ["256"])[0]);
      return BigInt(1000 + i) % (1n << bits);
    }
    return null;
  });
}

/** 用 ABI 造一份「真链会返回的」payload，再指定用哪份 ABI 去解 */
const roundTrip = (encodeIface, decodeIface, sig) => {
  const values = sentinels(encodeIface.getFunction(sig));
  const data = encodeIface.encodeFunctionResult(sig, values);
  return { data, values, res: decodeIface.decodeFunctionResult(sig, data) };
};
const tryDecode = (iface, sig, data) => { try { return { res: iface.decodeFunctionResult(sig, data) }; } catch (e) { return { err: e.message }; } };

function selfCheck() {
  console.log("sync_abi 之外的断言工具自检：哨兵值与往返");
  const disk = new ethers.Interface(JSON.parse(fs.readFileSync(V3_ABI, "utf8")));
  const rt = roundTrip(disk, disk, "policies(uint256)");
  ok("合成 payload 用同一份 ABI 往返后字段数与第 4 个值一致",
    rt.res.length === 16 && rt.res[4] === rt.values[4]);
  ok("tryDecode 对垃圾数据返回 err 而不是抛出", !!tryDecode(disk, "policies(uint256)", "0xdead").err);
  console.log(`\n${fail ? "❌" : "✅"} 自检：${pass} 项通过 / ${fail} 项失败`);
  process.exit(fail ? 1 : 0);
}

function main() {
  const file = ARG("--file") || TARGET;
  const rel = path.relative(ROOT, file);
  const html = fs.readFileSync(file, "utf8");
  const diskAbi = JSON.parse(fs.readFileSync(V3_ABI, "utf8"));
  const disk = new ethers.Interface(diskAbi);

  console.log(`页面 ABI 输出形状 ⇄ 真链返回（${rel}）\n`);

  const pageV3 = new ethers.Interface(extractAbi(html, "ABI_V3", rel));
  const pageV2 = new ethers.Interface(extractAbi(html, "ABI_V2", rel));

  ok("页面 ABI_V3 的每一处 outputs 形状都与 03-合约/RainDeliveryInsuranceV3.abi.json 一致（含字段名与顺序）",
    JSON.stringify(shape(pageV3)) === JSON.stringify(shape(disk)));

  // ① 三个结构体读法：字段数 + 字段名 + 取值位置
  for (const [sig, want] of Object.entries(SHAPES)) {
    const rt = roundTrip(disk, pageV3, sig);
    const got = namesOf(pageV3, sig);
    const wantNames = disk.getFunction(sig).outputs.map((o) => o.name);
    ok(`${sig} 解出 ${want} 个字段`, rt.res.length === want, `实测 ${rt.res.length} 个`);
    ok(`${sig} 字段名与 V3 ABI 逐个一致`, JSON.stringify(got) === JSON.stringify(wantNames),
      `页面 ${got.join(",")}\n       ABI  ${wantNames.join(",")}`);
    // 挪一位就会露馅：首尾两处取值必须落在编码时的位置上
    ok(`${sig} 首尾取值位置正确（首位与末位都与编码哨兵相等）`,
      String(rt.res[0]) === String(rt.values[0]) && String(rt.res[want - 1]) === String(rt.values[want - 1]),
      `首位 ${rt.res[0]} ≠ ${rt.values[0]}，或末位 ${rt.res[want - 1]} ≠ ${rt.values[want - 1]}`);
  }

  // ② 有牙证明：同一份 v3 payload 丢给 v2 形状解，必须解不出 v3 的字段形状
  for (const sig of Object.keys(SHAPES)) {
    const { data } = roundTrip(disk, pageV3, sig);
    const v2 = tryDecode(pageV2, sig, data);
    const same = !v2.err && JSON.stringify(v2.res.map((x) => String(x))) === JSON.stringify(pageV3.decodeFunctionResult(sig, data).map((x) => String(x)));
    ok(`v3 payload 用 ABI_V2 的 v2 形状解 ≠ v3 结果（正好是 677 上错位解码的那个 bug）`, !same,
      v2.err ? `（v2 形状直接抛错：${v2.err.slice(0, 80)}）` : "（v2 形状也能解出同样的值？那这条门禁没牙）");
  }

  // ③ 同名多参：必须取到 v3 那一份，不能落到 v2 重载上
  const thV3 = pageV3.getFunction("thresholdOf(uint256,uint8)");
  ok("thresholdOf 同名多参：页面取到的是 v3 的 (uint256,uint8) 重载（selector 0xd8c93818）",
    thV3.selector === "0xd8c93818", `实测 ${thV3 ? thV3.selector : "取不到"}`);
  ok("thresholdOf 同名多参：v2 那份 (uint256) 是另一个函数（selector 不同），不会被误取",
    (() => { try { return pageV2.getFunction("thresholdOf(uint256)").selector !== thV3.selector; } catch { return false; } })());
  const thRt = roundTrip(disk, pageV3, "thresholdOf(uint256,uint8)");
  ok("thresholdOf(uint256,uint8) 解出的值等于编码时的哨兵", String(thRt.res[0]) === String(thRt.values[0]));
  const p5 = pageV3.getFunction("premiumOf(uint8,uint256,uint8,uint8,uint256)");
  const p2 = pageV3.getFunction("premiumOf(uint8,uint256)");
  ok("premiumOf 两个重载都取到且不是同一个（5 参与 2 参 selector 不同）",
    !!p5 && !!p2 && p5.selector !== p2.selector, `5 参 ${p5 && p5.selector} / 2 参 ${p2 && p2.selector}`);
  const pRt = roundTrip(disk, pageV3, "premiumOf(uint8,uint256,uint8,uint8,uint256)");
  ok("premiumOf 5 参重载解出的值等于编码时的哨兵", String(pRt.res[0]) === String(pRt.values[0]));

  // ④ 快照里的真实返回：逐条用页面 ABI 解码
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(FROZEN, "utf8"), sandbox, { filename: FROZEN });
  const snap = sandbox.window.FROZEN_NODE;
  const calls = Object.entries(snap.calls);
  const bySel = new Map();
  for (const f of pageV3.fragments) if (f.type === "function") bySel.set(f.selector, f);
  let decodable = 0, structCalls = 0, structBad = [];
  for (const [key, val] of calls) {
    if (typeof val !== "string") continue;             // 快照里 {revert:true} 的两条没有返回数据
    const data = key.slice(key.indexOf(":") + 1);
    const frag = bySel.get(data.slice(0, 10));
    if (!frag) continue;
    const r = tryDecode(pageV3, frag.format("sighash"), val);
    if (r.err) { structBad.push(`${frag.format("sighash")}: ${r.err.slice(0, 60)}`); continue; }
    if (r.res.length !== frag.outputs.length) { structBad.push(`${frag.format("sighash")} 解出 ${r.res.length} 个 ≠ ABI 声明 ${frag.outputs.length}`); continue; }
    decodable++;
    if (SHAPES[frag.format("sighash")]) {
      structCalls++;
      if (r.res.length !== SHAPES[frag.format("sighash")]) structBad.push(`${frag.format("sighash")} 字段数 ${r.res.length}`);
    }
  }
  const withResult = calls.filter(([, v]) => typeof v === "string").length;
  ok(`快照 ${calls.length} 条调用 >= 40 且带返回的 ${withResult} 条全都能按页面 ABI_V3 解出（解出 ${decodable} 条）`,
    calls.length >= 40 && structBad.length === 0 && decodable === withResult,
    structBad.slice(0, 5).join(" | "));
  console.log(`  ℹ️ 快照里的结构体读法（policies/judgements/feedJudgements）共 ${structCalls} 条；形状覆盖靠上面 ① 的合成 payload`);

  console.log(`\n${fail ? "❌" : "✅"} check-page-decode：${pass} 项通过 / ${fail} 项失败`);
  process.exit(fail ? 1 : 0);
}

if (require.main === module && process.argv.includes("--self-check")) selfCheck();
else if (require.main === module) {
  try { main(); } catch (e) { console.error(`\n❌ ${e.message}`); process.exit(1); }
}
