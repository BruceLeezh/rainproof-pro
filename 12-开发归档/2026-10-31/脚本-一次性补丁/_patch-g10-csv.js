#!/usr/bin/env node
/** G10 补丁：console.html 对账与结算（明细表 + CSV 导出）。 */
const fs = require("fs");
const path = require("path");
const F = path.join(__dirname, "..", "05-演示站点", "console.html");
let s = fs.readFileSync(F, "utf8");
const EOL = s.includes("\r\n") ? "\r\n" : "\n";
const nl = t => t.replace(/\n/g, EOL);
const anchors = [
  '          <p class="note" style="margin-top:12px">按「同一生效日」聚合理赔：赔付总额 &gt; 自留额的部分记为应摊回（分保账单）。真实分保走持牌再保人，本表为记账层。</p>\n        </div>\n      </div>\n    </div>\n  </section>',
  '  window.__evAgg=evAgg;',
  'const CODES=[[420100,"武汉"],[310100,"上海"],[110100,"北京"],[440100,"广州"],[510100,"成都"]];for(const [i,cn] of CODES){',
];
for (const a of anchors) {
  const c = s.split(a).length - 1;
  if (c !== 1) { console.error("预检失败：" + c + " → " + a.slice(0, 44)); process.exit(1); }
}
console.log("锚点预检：3/3");
let n = 0;
function rep(o, t, label) { o = nl(o); t = nl(t); const c = s.split(o).length - 1; if (c !== 1) throw new Error(label + " " + c); s = s.split(o).join(t); n++; }

// ① 对账区块（再保记账 section 之后新起一节）
rep(anchors[0], anchors[0] + nl(
`

  <section class="sec">
    <h2>对账与结算<em>名单 · 保费 · 赔付 · 净支出（CSV 可导出，与链上逐笔可对）</em></h2>
    <div class="panel">
      <div class="ctab" style="margin-top:0">
        <div class="chead" style="grid-template-columns:70px 110px 90px minmax(140px,1fr) 90px 90px 90px 90px"><span>保单</span><span>城市/时长</span><span>状态</span><span>骑手（受益）</span><span>付款方</span><span>保费(元)</span><span>赔付(元)</span><span>生效日</span></div>
        <div id="settleBody"><span class="loading">读取链上保单</span></div>
      </div>
      <div class="row" style="margin-top:12px;justify-content:space-between">
        <span class="k" style="margin:0" id="settleSum">汇总读取中</span>
        <button class="btn primary sm" id="settleCsv">导出对账 CSV</button>
      </div>
      <p class="note" style="margin-top:10px">CSV 列：保单号, 区划码, 城市, 时长, 状态, 骑手, 付款方, 保费(元), 赔付(元), 生效时间。金额 RDROP 1:1 人民币；平台代付行「付款方=平台」。</p>
    </div>
  </section>`), "对账区块");

// ② 主循环收集明细 + 渲染
rep('  window.__evAgg=evAgg;',
`  window.__evAgg=evAgg;
  // G10：对账明细（与上方同一份链上读数，不引入新口径）
  window.__ROWS = [];
  for(let i=0;i<n;i++){
    const q=await v4.policies(i),st=await v4.policyStatus(i);
    window.__ROWS.push({ id:i, code:Number(q.regionId), hours:Number(q.windowHours), st,
      rider:q.rider, payer:q.payer, prem:Number(q.premium)/100, paid:Number(q.payout)/100,
      eff:new Date(Number(q.effectiveFrom)*1000).toLocaleString("zh-CN") });
  }
  const NAME=Object.fromEntries(CODES);
  $("settleBody").innerHTML = window.__ROWS.length ? window.__ROWS.map(r=>\`<div class="crow" style="grid-template-columns:70px 110px 90px minmax(140px,1fr) 90px 90px 90px 90px">
    <b>#\${r.id}</b><span class="v" style="text-align:left">\${NAME[r.code]||r.code} · \${r.hours}h</span>
    <span class="tag \${r.st==="paid"?"ok":r.st==="denied"?"red":""}">\${r.st}</span>
    <span class="v" style="text-align:left">\${r.rider.slice(0,10)}…</span>
    <span class="v" style="text-align:left">\${r.payer===r.rider?"本人":r.payer.slice(0,10)+"…"}</span>
    <span class="money">\${r.prem.toFixed(2)}</span><span class="money">\${r.paid.toFixed(2)}</span>
    <span class="v" style="text-align:left">\${r.eff}</span></div>\`).join("") : '<span class="empty">暂无保单</span>';
  const sumP=window.__ROWS.reduce((a,r)=>a+r.prem,0), sumD=window.__ROWS.reduce((a,r)=>a+r.paid,0);
  $("settleSum").innerHTML = \`共 \${window.__ROWS.length} 单 · 保费 <b class="money">\${sumP.toFixed(2)}</b> 元 · 赔付 <b class="money">\${sumD.toFixed(2)}</b> 元 · 净支出 <b>\${(sumD-sumP).toFixed(2)}</b> 元\`;`, "明细渲染");

// ③ CSV 导出（锚在 CODES 行之前挂函数与绑定）
rep(anchors[2], nl(
`// G10：对账 CSV（UTF-8 BOM，Excel 直接打开不乱码）
function settleCsvText(){
  const NAME=Object.fromEntries(CODES);
  const head="保单号,区划码,城市,时长,状态,骑手,付款方,保费(元),赔付(元),生效时间";
  const rows=(window.__ROWS||[]).map(r=>[r.id,r.code,NAME[r.code]||r.code,r.hours+"h",r.st,
    r.rider,r.payer,r.prem.toFixed(2),r.paid.toFixed(2),r.eff].join(","));
  return [head,...rows].join("\\r\\n");
}
$("settleCsv").onclick=()=>{
  if(!(window.__ROWS||[]).length)return toast("暂无保单可导出","err");
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob(["\\ufeff"+settleCsvText()],{type:"text/csv"}));
  a.download="rainproof-settle-"+new Date().toISOString().slice(0,10)+".csv";
  a.click();URL.revokeObjectURL(a.href);
  toast("对账 CSV 已下载（"+window.__ROWS.length+" 单）","ok");
};
const CODES=[[420100,"武汉"],[310100,"上海"],[110100,"北京"],[440100,"广州"],[510100,"成都"]];for(const [i,cn] of CODES){`), "CSV导出");

for (const m of s.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
  try { new Function(m[1]); } catch (e) { console.error("语法验证失败，不写盘：" + e.message.slice(0, 120)); process.exit(1); }
}
fs.writeFileSync(F, s, "utf8");
console.log("OK G10 写盘：" + n + " 处替换，语法验证通过");
