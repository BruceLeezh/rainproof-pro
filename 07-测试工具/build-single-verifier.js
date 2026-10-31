// 把 05-演示站点/verify-v6.html 连同它的 css/js 全部内联，产出可离线双击打开的单文件核验台。
// 用途：现场断网/不能连本地服务器时的兜底（06-核验台单文件/雨证-链上核验台.html）。
// 跑法：node 07-测试工具/build-single-verifier.js   （npm run build:verifier）
// 也被 check-html-syntax.js 复用：每次门禁都比对「单文件 与 在线页是否还一致」，防止改完页面忘了重新生成。
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "05-演示站点");
const OUT = path.join(__dirname, "..", "06-核验台单文件", "雨证-链上核验台.html");

function read(p) {
  return fs.readFileSync(path.join(SRC, p.replace(/^\.\//, "")), "utf8");
}

function build() {
  let html = fs.readFileSync(path.join(SRC, "verify-v6.html"), "utf8");
  const before = html;
  html = html.replace(/<link[^>]*href="([^"]+\.css)"[^>]*>/g, (_, href) => `<style>\n${read(href)}\n</style>`);
  html = html.replace(/<script[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g, (_, src) => `<script>\n${read(src)}\n</script>`);
  if (html === before) throw new Error("没有内联到任何资源：verify-v6.html 的引用写法变了？");
  const leftover = html.match(/<script[^>]+\bsrc=|<link[^>]+href="[^"]+\.css"/g);
  if (leftover) throw new Error("仍有外链未内联：" + leftover.join(", "));
  return html;
}

module.exports = { build, OUT };

if (require.main === module) {
  const html = build();
  fs.writeFileSync(OUT, html, "utf8");
  console.log(`单文件核验台已生成：${path.relative(path.join(__dirname, ".."), OUT)}  ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
}
