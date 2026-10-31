#!/usr/bin/env node
/** G2 补丁：rider.html 增加「理赔记录」——判了什么/为什么/钱到哪（含拒赔规则说明）。谨慎模式：锚点预检+断言+写盘前语法门禁。 */
const fs = require("fs");
const path = require("path");
const F = path.join(__dirname, "..", "05-演示站点", "rider.html");
let s = fs.readFileSync(F, "utf8");
const EOL = s.includes("\r\n") ? "\r\n" : "\n";
const nl = t => t.replace(/\n/g, EOL);
const anchors = ["  <footer>", "async function connectWallet(){", "refreshNet();refreshQuote();refreshPolicies();"];
for (const a of anchors) {
  const c = s.split(a).length - 1;
  if (c !== 1) { console.error("预检失败：锚点命中 " + c + " → " + a.slice(0, 40)); process.exit(1); }
}
console.log("锚点预检：3/3");
let n = 0;
function rep(o, t, label) {
  o = nl(o); t = nl(t);
  const c = s.split(o).length - 1;
  if (c !== 1) throw new Error(label + " 命中 " + c);
  s = s.split(o).join(t); n++;
}

// ① 理赔记录区（我的保单之后、footer 之前）
rep('  <footer>', nl(
'  <section class="sec">\n' +
'    <h2>理赔记录<em id="claimsWho">判了什么 · 为什么 · 钱到哪</em></h2>\n' +
'    <div id="claims"><span class="loading">读取链上判定</span></div>\n' +
'    <p class="note">判定由链上确定性规则给出：窗口增量 = 判定时链上读数 − 投保基线。未达国标档线判「不赔」（R1）；数据核验未通过也判「不赔」（R2/R4：三机构模型分歧）。拒绝同样留痕上链——不赔也要说清为什么。</p>\n' +
'  </section>\n') +
'  <footer>', "理赔区HTML");

// ② 理赔逻辑（挂在 connectWallet 之前；复用 POLICY_CACHE / cityName / fmtT / yuan / V5_ADDR）
rep('async function connectWallet(){', nl(
'/* G2 理赔记录：每张保单 → 判定结果 + 可推导的原因 + 到账交易 */\n' +
'const TOPIC_CLAIM = ethers.id("ClaimPaid(uint256,address,uint256,uint8)");\n' +
'const TOPIC_JUDGE = ethers.id("JudgementSubmitted(uint256,uint8,uint8,uint8,uint8,uint256,bytes32,bytes32,string)");\n' +
'const padId = id => "0x" + BigInt(id).toString(16).padStart(64, "0");\n' +
'function denyReason(p, j){\n' +
'  const during = Number(j.rainfallAtJudgement) - Number(p.rainfallAtBuy);\n' +
'  const thr = Number(p.thresholdMm);\n' +
'  if (during < thr) return "R1 未达档线：窗口增量 " + during + "mm < " + thr + "mm（国标暴雨线）";\n' +
'  return "R2/R4 数据核验未通过：增量 " + during + "mm 已达标，但三机构模型分歧/证据不足——不按可疑数据赔（详见留痕）";\n' +
'}\n' +
'async function loadClaims(){\n' +
'  const box = $("claims"); if (!box) return;\n' +
'  try {\n' +
'    const who = $("who").dataset.addr || DEMO_RIDER;\n' +
'    $("claimsWho").textContent = who.slice(0, 10) + "… 的判定与到账";\n' +
'    const ids = await v5.policiesOf(who);\n' +
'    if (!ids.length) { box.innerHTML = \'<span class="empty">暂无保单，也就没有理赔记录</span>\'; return; }\n' +
'    let h = "";\n' +
'    for (const id of ids) {\n' +
'      const p = POLICY_CACHE[id] || (POLICY_CACHE[id] = await v5.policies(id));\n' +
'      const j = await v5.judgements(id);\n' +
'      const [paidLog] = await provider.getLogs({ address: V5_ADDR, topics: [TOPIC_CLAIM, padId(id)] }).catch(() => [[]]);\n' +
'      const st = await v5.policyStatus(id);\n' +
'      const [lab, cls] = STAG[st] || [st, ""];\n' +
'      h += \'<div class="pol \' + st + \'">\';\n' +
'      if (j.exists) {\n' +
'        h += \'<div class="pid"><span class="tag \' + (Number(j.decision) === 1 ? "ok" : "red") + \'">\' + (Number(j.decision) === 1 ? "判定 PAY" : "判定 DENY") + \'</span><br>保单 <span class="mono">#\' + id + \'</span> · \' + cityName(p.regionId) + \' \' + p.windowHours + \'h</div>\';\n' +
'        h += \'<div class="pmeta">判定 \' + fmtT(j.judgedAt) + \'<br>置信 \' + j.confidence + " · 源 " + j.sources + \'<br>判定时读数 \' + j.rainfallAtJudgement + \'mm（基线 \' + p.rainfallAtBuy + \'mm）</div>\';\n' +
'        h += \'<div class="pai">\' + (Number(j.decision) === 1\n' +
'          ? (p.paid ? \'已赔 <b class="money">\' + yuan(p.payout) + \'</b> 元\' + (paidLog ? \'<br><span class="mono">\' + String(paidLog.transactionHash).slice(0, 14) + \'…</span>\' : "") : "待触发打款")\n' +
'          : "未赔付") + \'</div></div>\';\n' +
'        if (Number(j.decision) === 0) h += \'<div class="clr-reason">不赔原因：\' + denyReason(p, j) + \'</div>\';\n' +
'      } else {\n' +
'        h += \'<div class="pid"><span class="tag \' + cls + \'">\' + lab + \'</span><br>保单 <span class="mono">#\' + id + \'</span> · \' + cityName(p.regionId) + \' \' + p.windowHours + \'h</div>\';\n' +
'        h += \'<div class="pmeta">尚未判定</div><div class="pai">—</div></div>\';\n' +
'      }\n' +
'    }\n' +
'    box.innerHTML = h || \'<span class="empty">暂无判定记录</span>\';\n' +
'  } catch (e) { box.innerHTML = \'<span class="err">理赔记录读取失败：\' + (e.message || e).toString().slice(0, 80) + \'</span>\'; }\n' +
'}\n' +
'async function connectWallet(){'), "理赔逻辑");

// ③ 初始化与投保后刷新
rep('refreshNet();refreshQuote();refreshPolicies();',
    'refreshNet();refreshQuote();refreshPolicies();loadClaims();', "初始化调用");
rep('    try{const ids=await v5.policiesOf(me),nid=ids[ids.length-1];',
    '    loadClaims();\n    try{const ids=await v5.policiesOf(me),nid=ids[ids.length-1];', "投保后刷新");

// ④ 样式（令牌体系）
rep('  .empty{color:var(--faint);font-size:var(--t-tbl)}',
'  .clr-reason{grid-column:1/-1;font-size:var(--t-tbl);color:var(--dim);border-top:1px dashed var(--hair);padding-top:8px;margin-top:-4px}\n' +
'  .clr-reason b{color:var(--bad)}\n' +
'  .empty{color:var(--faint);font-size:var(--t-tbl)}', "样式");

for (const m of s.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
  try { new Function(m[1]); } catch (e) { console.error("语法验证失败，不写盘：" + e.message.slice(0, 120)); process.exit(1); }
}
fs.writeFileSync(F, s, "utf8");
console.log("OK G2 写盘：" + n + " 处替换，语法验证通过");
