// 三个演示页面的内联脚本语法检查（用 vm.Script 只编译不执行）。
// 用法：node 07-测试工具/check-html-syntax.js
// 它已挂进 `npm test`（2026-10-12 注册，A40①）：纯离线，不碰网络。
const fs = require("fs"), vm = require("vm"), path = require("path");

const ROOT = path.join(__dirname, "..");
const FILES = [
  "05-演示站点/index.html",
  "05-演示站点/index-v5.html",
  "05-演示站点/rider.html",
  "05-演示站点/console.html",
  "05-演示站点/verifier.html",
  "06-核验台单文件/汉客松-链上核验台.html",
  "05-演示站点/verify-v5.html",
  "05-演示站点/terms.html",
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
      const pat = new RegExp('A\\("' + name + '"\\)|\\b[A-Za-z_$][\\w$]*\\.' + name + '\\b', "g");
      if (!pat.test(rest)) continue;
      // 键位豁免（2026-10-26，v5 RegionRegistered(string name) 引入 name 后必要）：
      // 字段只作对象取键（X[A("name")] / X[obj.name]）时，进入模板的是静态映射的常量值，
      // 不是链上字符串本身 —— 不是注入面。全部出现皆为键位才豁免；只要还有一处文本
      // 插值（如 ${obj.name}）就仍按未转义处理。
      const keyUse = new RegExp('\\w+\\[(?:A\\("' + name + '"\\)|[A-Za-z_$][\\w$]*\\.' + name + ')\\]', "g");
      if (rest.replace(keyUse, "").indexOf(name) === -1) continue;
      holes++;
      console.log("FAIL " + path.basename(f) + ":" + (html.slice(0, m.index).split("\n").length) +
        " 链上 string 字段 " + name + " 没经 esc() 就进了模板 -> " + m[0].trim().slice(0, 120));
    }
  }
}
bad += holes;
if (!strFields.size) {
  // 硬断言：从 ABI 收集到 0 个 string 字段 ⇒ B15 一条都没跑（字段改名 / ABI 缺失都会这样），
  // 这时原来那句「0 个链上 string 字段」看着像通过，其实是零覆盖。
  bad++;
  console.log("FAIL 注入面：从 03-合约/*.abi.json 收集到 0 个链上 string 字段 —— B15 注入检查等于零覆盖，不算通过");
} else if (!holes) {
  console.log("OK   注入面：" + strFields.size + " 个链上 string 字段（" + [...strFields].join(", ") + "）进模板时全部过 esc()");
}

/* ---- esc() 本身的断言（2026-10-12）：B15 只证明「模板里调了 esc()」，不证明 esc() 真的转义。
   把 esc 改成恒等函数（s => String(s)）时 B15 照样全绿 ⇒ 这里直接抽页面里的 esc 定义跑一遍。 */
{
  const CASES = [["<", "&lt;"], [">", "&gt;"], ["&", "&amp;"], ['"', "&quot;"]];
  const SAMPLE = 'a<b>c&d"e';
  const WANT = "a&lt;b&gt;c&amp;d&quot;e";
  let escBad = 0;
  for (const f of FILES) {
    if (!fs.existsSync(f)) continue;
    const src = fs.readFileSync(f, "utf8");
    // 纯静态页压根不调用 esc，就不要求它定义 esc（terms.html 这种）
    if (src.indexOf("esc(") < 0) { console.log("SKIP " + path.basename(f) + " 不调用 esc（纯静态页）"); continue; }
    const m = src.match(/const\s+esc\s*=\s*([^\n]*?);\s*$/m);
    if (!m) { escBad++; console.log("FAIL " + path.basename(f) + " 找不到 `const esc = …;` 定义（B15 依赖它）"); continue; }
    let esc;
    try { esc = new vm.Script("(" + m[1] + ")").runInThisContext(); }
    catch (e) { escBad++; console.log("FAIL " + path.basename(f) + " 的 esc 定义无法求值 -> " + e.message); continue; }
    const wrong = CASES.filter(([i, o]) => esc(i) !== o);
    if (wrong.length || esc(SAMPLE) !== WANT) {
      escBad++;
      console.log("FAIL " + path.basename(f) + " 的 esc() 没转义 " +
        (wrong.length ? wrong.map(([i]) => JSON.stringify(i)).join(" ") : "整串") + " -> " + JSON.stringify(esc(SAMPLE)));
    } else {
      console.log("OK   " + path.basename(f) + " 的 esc() 对 < > & \" 都做了转义");
    }
  }
  bad += escBad;
}

/* ---- 页面不许外取脚本 + 本地脚本必须真存在（2026-10-12）：离线自证的前提是页面不向第三方取脚本；
   顺带断言被引的本地文件在同目录（文件名写错时页面会静默少一半功能，这里直接红）。 */
{
  let srcBad = 0, srcN = 0;
  for (const f of FILES) {
    if (!fs.existsSync(f)) continue;
    for (const m of fs.readFileSync(f, "utf8").matchAll(/<script[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
      const s = m[1]; srcN++;
      if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(s) || /^(?:data|blob):/i.test(s)) {
        srcBad++; console.log("FAIL " + path.basename(f) + " 引了外部脚本 " + s + "（离线自证要求页面不外取脚本）");
      } else if (!fs.existsSync(path.join(path.dirname(f), s.split(/[?#]/)[0]))) {
        srcBad++; console.log("FAIL " + path.basename(f) + " 引的本地脚本 " + s + " 在同目录下不存在");
      }
    }
  }
  if (!srcBad) console.log("OK   三个页面的 <script src> 全是同目录本地文件（" + srcN + " 处）");
  bad += srcBad;
}

console.log(bad ? "\n❌ " + bad + " 处问题（内联脚本语法错误，或链上 string 字段没转义就进模板）" : "\n✅ 三个页面的内联脚本语法全部通过");
process.exit(bad ? 1 : 0);