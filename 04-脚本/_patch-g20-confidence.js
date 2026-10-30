#!/usr/bin/env node
/** G20 补丁：置信度口径标注（防"把模型自评当统计置信度"被问倒）+ 申诉文本同步。 */
const fs = require("fs");
const path = require("path");
const F = path.join(__dirname, "..", "05-演示站点", "rider.html");
let s = fs.readFileSync(F, "utf8");
const EOL = s.includes("\r\n") ? "\r\n" : "\n";
const nl = t => t.replace(/\n/g, EOL);
const anchors = [
  '        h += \'<div class="pmeta">判定 \' + fmtT(j.judgedAt) + \'<br>置信 \' + j.confidence + " · 源 " + j.sources + \'<br>判定时读数 \' + j.rainfallAtJudgement + \'mm（基线 \' + p.rainfallAtBuy + \'mm）</div>\';',
  '    "判定：" + (d.judgement.decision === 1 ? "PAY" : "DENY") + "（置信 " + d.judgement.confidence + " · 源 " + d.judgement.sources + "）",',
  '  .clr-reason{grid-column:1/-1;font-size:var(--t-tbl);color:var(--dim);border-top:1px dashed var(--hair);padding-top:8px;margin-top:-4px}',
];
for (const a of anchors) {
  const c = s.split(a).length - 1;
  if (c !== 1) { console.error("预检失败：" + c + " → " + a.slice(0, 44)); process.exit(1); }
}
console.log("锚点预检：3/3");
let n = 0;
function rep(o, t, label) { const c = s.split(o).length - 1; if (c !== 1) throw new Error(label + " " + c); s = s.split(o).join(t); n++; }

// ① 理赔记录：置信度加口径标注（hover 与行内短标注）
const CPI = "\' + String.fromCharCode(10) + \'";
rep(anchors[0],
'        h += \'<div class="pmeta">判定 \' + fmtT(j.judgedAt) + \'<br>置信 \' + j.confidence + \' <span class="cnf" title="置信度为判定层的多源一致性自评（三模型落在中位数容差内的比例 + 与链上读数相符程度），不是统计置信区间/概率">自评口径</span> · 源 \' + j.sources + \'<br>判定时读数 \' + j.rainfallAtJudgement + \'mm（基线 \' + p.rainfallAtBuy + \'mm）</div>\';'
.replace(String.fromCharCode(10), ""), "理赔行口径");

// ② 申诉文本同步标注
rep(anchors[1], nl(
'    "判定：" + (d.judgement.decision === 1 ? "PAY" : "DENY") + "（置信 " + d.judgement.confidence + "（自评口径：多源一致性，非统计置信区间） · 源 " + d.judgement.sources + "）",'), "申诉文本口径");

// ③ 样式（发丝线小徽标，不喧宾夺主）
rep(anchors[2], nl(
'  .cnf{font-size:10px;padding:1px 5px;border:1px solid var(--hair-2);border-radius:var(--r-xs);color:var(--faint);cursor:help;white-space:nowrap}\n' +
'  .clr-reason{grid-column:1/-1;font-size:var(--t-tbl);color:var(--dim);border-top:1px dashed var(--hair);padding-top:8px;margin-top:-4px}'), "样式");

for (const m of s.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
  try { new Function(m[1]); } catch (e) { console.error("语法验证失败，不写盘：" + e.message.slice(0, 120)); process.exit(1); }
}
fs.writeFileSync(F, s, "utf8");
console.log("OK G20 写盘：" + n + " 处替换，语法验证通过");
