// 三个演示页面的内联脚本语法检查（用 vm.Script 只编译不执行）。
// 用法：node 07-测试工具/check-html-syntax.js
// 它已挂进 `npm test`（2026-10-12 注册，A40①）：纯离线，不碰网络。
const fs = require("fs"), vm = require("vm"), path = require("path");

const ROOT = path.join(__dirname, "..");
const FILES = [
  "05-演示站点/index.html",
  "05-演示站点/verifier.html",
  "06-核验台单文件/汉客松-链上核验台.html",
].map((f) => path.join(ROOT, f));

let bad = 0;
for (const f of FILES) {
  if (!fs.existsSync(f)) { bad++; console.log("FAIL 缺文件 " + f); continue; }
  const html = fs.readFileSync(f, "utf8");
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m, i = 0;
  while ((m = re.exec(html))) {
    i++;
    try {
      new vm.Script(m[1], { filename: f + " #script" + i });
      console.log("OK   " + path.basename(f) + " script#" + i + "  (" + m[1].length + " 字符)");
    } catch (e) {
      bad++;
      console.log("FAIL " + path.basename(f) + " script#" + i + " -> " + e.message);
    }
  }
}
/* ---- B15：链上 string 字段进模板必须过 esc()（2026-10-12 加，A 侧判据，见 口径变更-A给B-2026-10-12.md §十） ----
   判据：从 03-合约/*.abi.json 收集所有 type:"string" 的字段名（现在只有 modelVersion），
   页面里每处 ${…} 插值若出现 A("字段") 或 某对象.字段 而没包 esc()，就是可注入点。
   事件参数是合约可控字符串，而页面允许粘贴任意合约地址 ⇒ 恶意合约能把 HTML 打进页面。 */
const strFields = new Set();
for (const n of fs.readdirSync(path.join(ROOT, "03-合约")).filter((x) => x.endsWith(".abi.json"))) {
  for (const it of JSON.parse(fs.readFileSync(path.join(ROOT, "03-合约", n), "utf8")))
    for (const p of it.inputs || []) if (p.type === "string" && p.name) strFields.add(p.name);
}
const stripEsc = (s) => { let o = s; for (;;) { const t = o.replace(/esc\((?:[^()]|\([^()]*\))*\)/g, ""); if (t === o) return o; o = t; } };
let holes = 0;
for (const f of FILES) {
  if (!fs.existsSync(f)) continue;
  const html = fs.readFileSync(f, "utf8");
  for (const m of html.matchAll(/\$\{[^{}]*\}/g)) {
    const rest = stripEsc(m[0]);
    for (const name of strFields) {
      if (!new RegExp('A\\("' + name + '"\\)|\\b[A-Za-z_$][\\w$]*\\.' + name + '\\b').test(rest)) continue;
      holes++;
      console.log("FAIL " + path.basename(f) + ":" + (html.slice(0, m.index).split("\n").length) +
        " 链上 string 字段 " + name + " 没经 esc() 就进了模板 -> " + m[0].trim().slice(0, 120));
    }
  }
}
bad += holes;
if (!holes) console.log("OK   注入面：" + strFields.size + " 个链上 string 字段（" + [...strFields].join(", ") + "）进模板时全部过 esc()");

console.log(bad ? "\n❌ " + bad + " 处问题（内联脚本语法错误，或链上 string 字段没转义就进模板）" : "\n✅ 三个页面的内联脚本语法全部通过");
process.exit(bad ? 1 : 0);
