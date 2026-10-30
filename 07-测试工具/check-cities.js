#!/usr/bin/env node
/**
 * check-cities.js —— 行政区划数据门禁（2026-10-27）
 *
 * 锁三件事：
 *   ① cn-cities.json（数据源）与 cn-cities.js（页面实际加载的那份）逐字节等价 ——
 *      两份文件是「file:// 下 fetch 会被 CORS 拦」逼出来的，不同步就等于现场又挂一次。
 *   ② 区划码形状：地级市 4 位、县级单位 6 位、直筒子市的镇街 9 位。页面的换算规则
 *      （4 位 + "00" = 链上 regionId；9 位镇街不进候选）就建立在这个形状上。
 *   ③ 页面确实用 <script src> 加载 cn-cities.js，而不是只依赖 fetch。
 *
 * 用法：node check-cities.js   （纯离线，进 npm test 链）
 */
"use strict";
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
const ok = (t, c, x = "") => { if (c) { pass++; console.log("  ✅ " + t); } else { fail++; console.log("  ❌ " + t + (x ? "  -> " + x : "")); } };

const ROOT = path.join(__dirname, "..");
const DEMO = path.join(ROOT, "05-演示站点");

console.log("\n[① 数据源与页面加载件必须同一份]");
const jsonRaw = fs.readFileSync(path.join(DEMO, "cn-cities.json"), "utf8");
const tree = JSON.parse(jsonRaw);
let jsRaw = "";
try { jsRaw = fs.readFileSync(path.join(DEMO, "cn-cities.js"), "utf8"); }
catch (e) { ok("cn-cities.js 存在", false, e.message); }
if (jsRaw) {
  const m = jsRaw.match(/window\.CN_CITIES\s*=\s*([\s\S]*?);\s*$/);
  ok("cn-cities.js 能解析出 window.CN_CITIES = …", !!m);
  if (m) {
    let parsed = null;
    try { parsed = JSON.parse(m[1]); } catch (e) { ok("cn-cities.js 的载荷是合法 JSON", false, e.message); }
    if (parsed) {
      ok("cn-cities.js 与 cn-cities.json 完全一致（改了 JSON 必须重生成 JS）",
         JSON.stringify(parsed) === JSON.stringify(tree));
    }
  }
}

console.log("\n[② 区划码形状（页面换算规则的前提）]");
const provinces = tree.length;
const cities = tree.reduce((n, p) => n + (p.children || []).length, 0);
const counties = tree.reduce((n, p) => n + (p.children || []).reduce((k, c) => k + (c.children || []).length, 0), 0);
ok("31 个省 / 自治区 / 直辖市", provinces === 31, String(provinces));
ok("342 个地级市", cities === 342, String(cities));
ok("3056 个县级单位（含直筒子市的镇街）", counties === 3056, String(counties));

const cityLens = new Set(), countyLens = new Set(), pseudo = [];
const county6 = new Set();
let bad = [];
for (const p of tree) {
  for (const c of (p.children || [])) {
    cityLens.add(String(c.code).length);
    if (String(c.code).length !== 4) bad.push(`地级市 ${c.name} 的代码不是 4 位：${c.code}`);
    if (/省直辖|自治区直辖/.test(String(c.name))) pseudo.push(String(c.code));
    for (const a of (c.children || [])) {
      const L = String(a.code).length;
      countyLens.add(L);
      if (L === 6) county6.add(String(a.code));
      if (L !== 6 && L !== 9) bad.push(`县区 ${a.name} 的代码长度异常：${a.code}`);
    }
  }
}
ok("地级市代码全部 4 位（4 位 + \"00\" 才是链上 6 位 regionId）", bad.length === 0 && !cityLens.has(6), bad.slice(0, 3).join(" / ") || [...cityLens].join(","));
ok("县级单位只有 6 位（真区划）与 9 位（镇街，不进候选）", [...countyLens].sort().join(",") === "6,9", [...countyLens].join(","));
ok("省直辖伪地级市恰为 4190 / 4290 / 4690 / 6590（不能 +\"00\"）",
   pseudo.sort().join(",") === "4190,4290,4690,6590", pseudo.sort().join(","));

console.log("\n[③ 演示城市与链上 regionId 对得上]");
const byCode = new Map();
for (const p of tree) for (const c of (p.children || [])) {
  byCode.set(String(c.code) + "00", { city: c.name, prov: p.name });
  for (const a of (c.children || [])) byCode.set(String(a.code), { city: a.name, prov: p.name });
}
for (const [code, name] of [[420100, "武汉"], [310100, "上海"], [110100, "北京"], [440100, "广州"], [510100, "成都"], [330782, "义乌"]]) {
  const hit = byCode.get(String(code));
  ok(`${name} ${code} 能在区划表里找到`, !!hit, hit ? `${hit.prov} · ${hit.city}` : "找不到");
}
ok("县级 6 位码里确实包含义乌 330782", county6.has("330782"));

console.log("\n[④ 页面加载方式]");
const page = fs.readFileSync(path.join(DEMO, "index-v5.html"), "utf8");
ok("index-v5.html 首次打开弹层时动态注入 cn-cities.js（file:// 下也能用，且不拖慢首屏）",
   /ucLoadScript\("cn-cities\.js"\)/.test(page));
ok("保留 cn-cities.json 的 fetch 兜底（脚本缺失但 JSON 在的 HTTP 环境仍可用）",
   /fetch\("\.\/cn-cities\.json"/.test(page));

console.log("\n" + "=".repeat(70));
console.log(fail ? `❌ 通过 ${pass} 项 / 失败 ${fail} 项` : `✅ 通过 ${pass} 项 / 失败 0 项`);
process.exit(fail ? 1 : 0);
