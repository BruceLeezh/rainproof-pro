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
console.log(bad ? "\n❌ " + bad + " 个内联脚本有语法错误" : "\n✅ 三个页面的内联脚本语法全部通过");
process.exit(bad ? 1 : 0);
