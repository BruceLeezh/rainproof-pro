#!/usr/bin/env node
/** G1 补丁（谨慎模式）：先全锚点预检，再小步替换，内置语法验证，全过才写盘。 */
const fs = require("fs");
const path = require("path");
const F = path.join(__dirname, "..", "05-演示站点", "rider.html");
let s = fs.readFileSync(F, "utf8");
const orig = s;
const EOL = s.includes("\r\n") ? "\r\n" : "\n";          // 按文件实际行尾归一（rider.html 是 LF，index 系是 CRLF）
const crlf = t => t.replace(/\n/g, EOL);

// ---------- 锚点预检（每个必须恰好命中 1 次，否则中止不写盘） ----------
const anchors = [
  'const CITY_CODE=[0,420100,310100,110100,440100,510100];',
  '${CITY[p.regionId]}',
  'const p=await v5.policies(id), st=await v5.policyStatus(id);',
  'async function connectWallet(){',
  'refreshPolicies();toast("投保成功","ok");',
  '  .empty{color:var(--faint);font-size:var(--t-tbl)}',
];
for (const a of anchors) {
  const c = s.split(a).length - 1;
  if (c !== 1) { console.error("预检失败：锚点命中 " + c + " 次 → " + a.slice(0, 50)); process.exit(1); }
}
const closeAnchor = EOL + "      </div>`;";
const cc = s.split(closeAnchor).length - 1;
if (cc !== 1) { console.error("预检失败：闭合锚点命中 " + cc + " 次"); process.exit(1); }
console.log("锚点预检：7/7 全部恰好一次");

// ---------- 小步替换 ----------
let n = 0;
function rep(oldStr, newStr, label) {
  oldStr = crlf(oldStr); newStr = crlf(newStr);
  const c = s.split(oldStr).length - 1;
  if (c !== 1) throw new Error("替换断言失败：" + label + " 命中 " + c);
  s = s.split(oldStr).join(newStr); n++;
}

// ① 城市名映射 + 凭证构建器/文本器（纯函数，挂在 CITY_CODE 之后）
rep('const CITY_CODE=[0,420100,310100,110100,440100,510100];',
'const CITY_CODE=[0,420100,310100,110100,440100,510100];\n' +
'const CITY_NAME={420100:"武汉",310100:"上海",110100:"北京",440100:"广州",510100:"成都",330782:"义乌"};\n' +
'const cityName=c=>CITY_NAME[Number(c)]||("区划码 "+c);\n' +
'const V5_ADDR="0xFE3D9f897CE3038B75b876923D843F9F6752e136", MS_ADDR="0x21C8520D486be3805Cf3FaA7cCab896241410d98";\n' +
'const shortA=a=>String(a).slice(0,8)+"…"+String(a).slice(-4);\n' +
'const fmtT=u=>new Date(Number(u)*1000).toLocaleString("zh-CN",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});\n' +
'const THR2={12:[30,70],24:[50,100]};\n' +
'/* G1 保单凭证：数据全部来自链上读数；文本版可复制转发 */\n' +
'function certHTML(id,p,st){\n' +
'  const [lab]=STAG[st]||[st]; const t=THR2[Number(p.windowHours)]||[0,0];\n' +
'  return \'<details class="certbox" id="cert-\'+id+\'"><summary>保单凭证 · Policy certificate</summary><div class="panel cert">\'\n' +
'    +\'<div class="srcrow"><span class="k">保单号 / 状态</span><span class="v"><b>#\'+id+\'</b> · \'+lab+\'</span></div>\'\n' +
'    +\'<div class="srcrow"><span class="k">被保险人</span><span class="v mono">\'+shortA(p.rider)+(p.payer!==p.rider?\'（付款 \'+shortA(p.payer)+\'）\':\'\')+\'</span></div>\'\n' +
'    +\'<div class="srcrow"><span class="k">保障区域 / 时长</span><span class="v">\'+cityName(p.regionId)+\'（#\'+p.regionId+\'）· \'+p.windowHours+\'h</span></div>\'\n' +
'    +\'<div class="srcrow"><span class="k">保障窗口</span><span class="v">\'+fmtT(p.effectiveFrom)+\' → \'+fmtT(p.endTime)+\'</span></div>\'\n' +
'    +\'<div class="srcrow"><span class="k">触发条件</span><span class="v">新增 ≥\'+t[0]+\'mm 赔 50 元 · ≥\'+t[1]+\'mm 赔 75 元（国标）</span></div>\'\n' +
'    +\'<div class="srcrow"><span class="k">投保基线</span><span class="v">累计 \'+p.rainfallAtBuy+\'mm（链上可查）</span></div>\'\n' +
'    +\'<div class="srcrow"><span class="k">保费 / 赔付</span><span class="v"><b class="money">\'+yuan(p.premium)+\'</b> 元 · \'+(p.paid?\'已赔 <b class="money">\'+yuan(p.payout)+\'</b> 元\':\'未结算\')+\'</span></div>\'\n' +
'    +\'<div class="srcrow"><span class="k">链上核验</span><span class="v"><a href="https://scan.bohr.life/address/\'+V5_ADDR+\'" target="_blank" rel="noopener">scan.bohr.life（968）</a></span></div>\'\n' +
'    +\'<div class="row" style="margin-top:10px"><button class="btn sm" data-copy="\'+id+\'">复制凭证文本</button>\'\n' +
'    +\'<span class="k" style="margin:0">RDROP 演示计价 1:1 人民币 · 非真实保险要约</span></div>\'\n' +
'    +\'</div></details>\';\n' +
'}\n' +
'function certText(id,p,st){\n' +
'  const [lab]=STAG[st]||[st]; const t=THR2[Number(p.windowHours)]||[0,0];\n' +
'  return ["【雨证 RainProof · 参数化降雨保障凭证（演示）】","保单号：#"+id+"　状态："+lab,\n' +
'    "被保险人："+shortA(p.rider)+(p.payer!==p.rider?"（付款："+shortA(p.payer)+"）":""),\n' +
'    "保障区域："+cityName(p.regionId)+"（区划码 "+p.regionId+"）· 保障时长 "+p.windowHours+" 小时",\n' +
'    "保障窗口："+fmtT(p.effectiveFrom)+" → "+fmtT(p.endTime),\n' +
'    "触发条件：窗口内新增降雨 ≥"+t[0]+"mm 赔 50 元；≥"+t[1]+"mm 赔 75 元（国标 GB/T 28592—2012；满额 100 元）",\n' +
'    "投保基线：自雨季起点累计 "+p.rainfallAtBuy+"mm",\n' +
'    "保费："+yuan(p.premium)+" 元（RDROP 演示计价 1:1 人民币，非真实保险要约）",\n' +
'    p.paid?"赔付："+yuan(p.payout)+" 元 · 已自动到账":"赔付：未结算（触发即自动打款，无需报案）",\n' +
'    "判定数据：ECMWF/GFS/ICON 三机构模型链上累计，交叉核验、全程留痕",\n' +
'    "链上核验：BOT Chain 测试网 968 · 合约 "+V5_ADDR,\n' +
'    "浏览器：https://scan.bohr.life/address/"+V5_ADDR,"治理：2/3 多签 "+MS_ADDR].join("\\n");\n' +
'}', "凭证函数");

// ② 城市名 undefined 修复
rep('${CITY[p.regionId]}', '${cityName(p.regionId)}', "城市名修复");

// ③ 行尾接凭证
rep(closeAnchor, closeAnchor + '+certHTML(id,p,st);', "行尾接凭证");

// ④ 保单缓存（复制取数）
rep('const p=await v5.policies(id), st=await v5.policyStatus(id);',
    'const p=await v5.policies(id), st=await v5.policyStatus(id);\n      POLICY_CACHE[id]=p;', "保单缓存");

// ⑤ 复制委托 + 声明（挂在 connectWallet 之前）
rep('async function connectWallet(){',
'let POLICY_CACHE={};   // 复制凭证时按 id 取链上读数\n' +
'$("policies").addEventListener("click",async(e)=>{\n' +
'  const b=e.target.closest&&e.target.closest("[data-copy]"); if(!b)return;\n' +
'  const id=Number(b.dataset.copy), p=POLICY_CACHE[id];\n' +
'  if(!p)return toast("凭证数据还没读到，稍后再试","err");\n' +
'  try{await navigator.clipboard.writeText(certText(id,p,""));toast("凭证文本已复制","ok")}\n' +
'  catch(err){toast("复制失败：浏览器未授权剪贴板","err")}\n' +
'});\n' +
'async function connectWallet(){', "复制委托");

// ⑥ 投保成功自动展开新凭证
rep('refreshPolicies();toast("投保成功","ok");',
'await refreshPolicies();toast("投保成功","ok");\n' +
'    try{const ids=await v5.policiesOf(me),nid=ids[ids.length-1];\n' +
'      const det=document.getElementById("cert-"+nid);\n' +
'      if(det){det.open=true;det.scrollIntoView({behavior:"smooth",block:"center"})}}catch(e){}', "投保后展开");

// ⑦ 凭证样式（令牌体系内）
rep('  .empty{color:var(--faint);font-size:var(--t-tbl)}',
'  details.certbox{margin:-6px 0 14px;padding-left:26px}\n' +
'  details.certbox>summary{cursor:pointer;font-size:var(--t-lab);color:var(--faint);letter-spacing:.3px;list-style:none;display:flex;align-items:center;gap:8px;padding:6px 0}\n' +
'  details.certbox>summary::-webkit-details-marker{display:none}\n' +
'  details.certbox>summary::before{content:"";width:6px;height:6px;border-right:1.5px solid var(--faint);border-bottom:1.5px solid var(--faint);transform:rotate(-45deg);transition:transform .18s}\n' +
'  details.certbox[open]>summary::before{transform:rotate(45deg)}\n' +
'  details.certbox>summary:hover{color:var(--blue-l)}\n' +
'  .cert .srcrow .v a{color:var(--blue-l)}\n' +
'  .empty{color:var(--faint);font-size:var(--t-tbl)}', "凭证样式");

// ---------- 写盘前语法验证（对新内容做 Function 编译检查） ----------
const html2 = s;
for (const m of html2.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
  try { new Function(m[1]); } catch (e) { console.error("语法验证失败，不写盘：" + e.message.slice(0, 120)); process.exit(1); }
}
fs.writeFileSync(F, html2, "utf8");
console.log("OK G1 写盘：" + n + " 处替换，语法验证通过（原文 " + orig.length + " B → 新文 " + html2.length + " B）");
