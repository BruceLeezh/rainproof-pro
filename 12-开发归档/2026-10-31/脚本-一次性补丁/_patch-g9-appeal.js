#!/usr/bin/env node
/** G9 补丁：rider.html 申诉通道（拒赔行「申请复核」→ 表单 → 复制文本 / 下载 JSON 凭据）。含运营手册 §九。 */
const fs = require("fs");
const path = require("path");
const F = path.join(__dirname, "..", "05-演示站点", "rider.html");
let s = fs.readFileSync(F, "utf8");
const EOL = s.includes("\r\n") ? "\r\n" : "\n";
const nl = t => t.replace(/\n/g, EOL);
const anchors = [
  'if (Number(j.decision) === 0) h += \'<div class="clr-reason">不赔原因：\' + denyReason(p, j) + \'</div>\';',
  '<div id="claims"><span class="loading">读取链上判定</span></div>',
  'async function loadClaims(){',
  '  .empty{color:var(--faint);font-size:var(--t-tbl)}',
];
for (const a of anchors) {
  const c = s.split(a).length - 1;
  if (c !== 1) { console.error("预检失败：" + c + " → " + a.slice(0, 44)); process.exit(1); }
}
console.log("锚点预检：4/4");
let n = 0;
function rep(o, t, label) { const c = s.split(o).length - 1; if (c !== 1) throw new Error(label + " " + c); s = s.split(o).join(t); n++; }

// ① DENY 行尾加「申请复核」按钮
rep("if (Number(j.decision) === 0) h += '<div class=\"clr-reason\">不赔原因：' + denyReason(p, j) + '</div>';",
    "if (Number(j.decision) === 0) h += '<div class=\"clr-reason\">不赔原因：' + denyReason(p, j) + '</div>' +\n" +
    "          '<div style=\"grid-column:1/-1;padding-top:6px\"><button class=\"btn sm\" data-appeal=\"' + id + '\">申请复核这份判定</button></div>';", "DENY 申诉按钮");

// ② 申诉表单区（claims 之后）
rep('<div id="claims"><span class="loading">读取链上判定</span></div>',
`<div id="claims"><span class="loading">读取链上判定</span></div>
    <div id="appealBox" hidden style="margin-top:12px">
      <div class="panel">
        <div class="k">复核申请 · <span id="appealPid" class="mono"></span>（说明你认为该赔的理由，如：当时本地雨量明显更大 / 判定读数存疑）</div>
        <textarea id="appealReason" style="width:100%;height:76px;margin-top:8px;background:#0A1521;border:1px solid var(--hair-2);border-radius:var(--r-sm);color:var(--ink);font-size:13px;padding:10px" placeholder="填写复核理由（必填，将随保单与判定数据一起打包）"></textarea>
        <div class="row" style="margin-top:10px">
          <button class="btn primary sm" id="appealCopy">生成并复制复核文本</button>
          <button class="btn sm" id="appealDl">下载复核 JSON</button>
          <button class="btn sm" id="appealCancel">取消</button>
        </div>
        <p class="note" style="margin-top:8px">复核材料 = 你的理由 + 链上判定数据（自动附上）。运营按《运营手册》§九 复核并在留痕目录回填结论——全程留痕可查。</p>
      </div>
    </div>`, "申诉表单");

// ③ 申诉逻辑（挂 loadClaims 前）
rep('async function loadClaims(){', nl(
`/* G9 申诉通道：拒赔可复核——生成文本 + JSON 凭据（本地下载/复制，运营侧回填结论） */
let APPEAL = null;   // {id, p, j}
function appealData(){
  const { id, p, j } = APPEAL;
  const reason = $("appealReason").value.trim();
  return { schema: "rainproof/appeal@1", policyId: Number(id), chainId: 968, contract: V5_ADDR,
    rider: p.rider, region: { code: Number(p.regionId), name: cityName(p.regionId) }, windowHours: Number(p.windowHours),
    judgement: { decision: Number(j.decision), confidence: Number(j.confidence), sources: Number(j.sources),
      rainfallAtJudgement: Number(j.rainfallAtJudgement), rainfallAtBuy: Number(p.rainfallAtBuy),
      thresholdMm: Number(p.thresholdMm), judgedAt: Number(j.judgedAt) },
    derivedDenyReason: denyReason(p, j), reason,
    generatedAt: new Date().toISOString() };
}
function appealText(){
  const d = appealData();
  return ["【雨证 · 判定复核申请】", "保单 #" + d.policyId + " · " + d.region.name + " " + d.windowHours + "h",
    "判定：" + (d.judgement.decision === 1 ? "PAY" : "DENY") + "（置信 " + d.judgement.confidence + " · 源 " + d.judgement.sources + "）",
    "链上读数：判定时 " + d.judgement.rainfallAtJudgement + "mm · 基线 " + d.judgement.rainfallAtBuy + "mm · 档线 " + d.judgement.thresholdMm + "mm",
    "系统给出的拒赔原因：" + d.derivedDenyReason, "申请人理由：" + (d.reason || "（未填写）"),
    "核验：" + d.contract + "（BOT Chain 测试网 968）· 申请人 " + d.rider, "生成时间：" + d.generatedAt].join("\\n");
}
async function loadClaims(){`), "申诉逻辑");

// ④ 事件绑定（挂到复制委托之后——用独立 IIFE 附在脚本初始化区，锚在 city onchange 之前）
const bindAnchor = nl('$("city").onchange=()=>{refreshNet();refreshQuote()};');
if (s.split(bindAnchor).length - 1 !== 1) { console.error("预检失败：绑定锚点"); process.exit(1); }
s = s.split(bindAnchor).join(nl(
`$("claims").addEventListener("click",(e)=>{
  const b=e.target.closest&&e.target.closest("[data-appeal]");
  if(!b)return;
  const id=b.dataset.appeal, p=POLICY_CACHE[id];
  if(!p)return toast("保单数据未缓存，稍后再试","err");
  v5.judgements(id).then(j=>{ if(!j.exists)return toast("该保单尚无判定，无需复核","err");
    APPEAL={id,p,j}; $("appealPid").textContent="#"+id; $("appealBox").hidden=false;
    $("appealReason").value=""; $("appealBox").scrollIntoView({behavior:"smooth",block:"center"}); });
});
$("appealCancel").onclick=()=>{ $("appealBox").hidden=true; APPEAL=null; };
$("appealCopy").onclick=async()=>{
  if(!$("appealReason").value.trim())return toast("请先填写复核理由","err");
  try{ await navigator.clipboard.writeText(appealText()); toast("复核文本已复制——发给运营或在留痕目录登记","ok"); }
  catch(e){ toast("复制失败：浏览器未授权剪贴板","err"); }
};
$("appealDl").onclick=()=>{
  if(!$("appealReason").value.trim())return toast("请先填写复核理由","err");
  const d=appealData();
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([JSON.stringify(d,null,1)],{type:"application/json"}));
  a.download="appeal-"+d.policyId+"-"+d.generatedAt.replace(/[-:T]/g,"").slice(0,12)+".json";
  a.click(); URL.revokeObjectURL(a.href);
  toast("已下载复核 JSON（交运营投入 09-AI判定留痕/appeals/）","ok");
};
$("city").onchange=()=>{refreshNet();refreshQuote()};`));
n++;

// ⑤ textarea 全局样式微调不需要（内联已带）；补一条说明样式可省
rep('  .empty{color:var(--faint);font-size:var(--t-tbl)}',
'  #appealBox textarea{resize:vertical;font-family:var(--f-ui)}\n  .empty{color:var(--faint);font-size:var(--t-tbl)}', "样式");

for (const m of s.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
  try { new Function(m[1]); } catch (e) { console.error("语法验证失败，不写盘：" + e.message.slice(0, 120)); process.exit(1); }
}
fs.writeFileSync(F, s, "utf8");
console.log("OK G9 写盘：" + n + " 处替换，语法验证通过");

// ⑥ 运营手册 §九（申诉处理流程）
const RB = path.join(__dirname, "..", "02-作战与答辩", "运营手册-初版-2026-10-25.md");
let rb = fs.readFileSync(RB, "utf8");
if (!rb.includes("## 九、")) {
  rb += ["", "## 九、申诉处理流程（G9，2026-10-26 起）", "",
"1. 收件：骑手在 rider.html「申请复核」生成文本/JSON（含链上判定数据与理由），交运营投入 09-AI判定留痕/appeals/；",
"2. 复核（48h 内）：按留痕重放口径核对——窗口增量、三模型原始报文（raw/ 的 sha256 复算）、判定规则命中是否正确；数据口径错误 → 提交更正判定仍走两票；",
"3. 回填：结论写同目录 appeal-<id>-…-result.json（维持原判 / 更正为 PAY 及依据），不删原申请；",
"4. 如更正为应赔：喂价/判定更正上链（两票）后 keeper 正常 claim，向骑手回执凭证。", ""].join("\r\n");
  fs.writeFileSync(RB, rb, "utf8");
  console.log("运营手册 §九 已加");
} else console.log("运营手册 §九 已存在，跳过");
