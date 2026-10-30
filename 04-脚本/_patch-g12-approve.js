#!/usr/bin/env node
/** G12 补丁：大额授权选项（授权一次×100 份，后续投保单笔交易）+ 修复 buy() 报价缺区划码映射。 */
const fs = require("fs");
const path = require("path");
const F = path.join(__dirname, "..", "05-演示站点", "rider.html");
let s = fs.readFileSync(F, "utf8");
const EOL = s.includes("\r\n") ? "\r\n" : "\n";
const nl = t => t.replace(/\n/g, EOL);
const anchors = [
  '<button class="btn primary block" id="buy">投保（连接钱包，两步：授权 + 投保）</button>',
  'const TOKABI=["function balanceOf(address) view returns (uint256)","function approve(address,uint256) returns (bool)"];',
  'async function buy(){',
  'refreshPolicies();toast("钱包已连接","ok");',
];
for (const a of anchors) {
  const c = s.split(a).length - 1;
  if (c !== 1) { console.error("预检失败：" + c + " → " + a.slice(0, 44)); process.exit(1); }
}
// buy 中段（原文精确块）
const buyMid = nl(
`    toast("第一步：授权保费…");
    const bp=new E.BrowserProvider(window.ethereum), s=await bp.getSigner();
    const t=new E.Contract(TOK,TOKABI,s), v=new E.Contract(V5,V5ABI,s);
    const premium=await v.premiumOf(+$("city").value,+$("hours").value);
    (await t.approve(V5,premium)).wait();
    toast("第二步：投保…");`);
if (s.split(buyMid).length - 1 !== 1) { console.error("预检失败：buy 中段"); process.exit(1); }
const buyOk = nl('    await refreshPolicies();toast("投保成功","ok");');
if (s.split(buyOk).length - 1 !== 1) { console.error("预检失败：buy 成功行"); process.exit(1); }
console.log("锚点预检：6/6");
let n = 0;
function rep(o, t, label) { const c = s.split(o).length - 1; if (c !== 1) throw new Error(label + " " + c); s = s.split(o).join(t); n++; }

// ① 按钮 + 大额授权开关 + 授权余额行
rep('<button class="btn primary block" id="buy">投保（连接钱包，两步：授权 + 投保）</button>', nl(
`<button class="btn primary block" id="buy">投保（连接钱包）</button>
      <div class="row" style="margin-top:10px">
        <label class="row" style="gap:6px;margin:0;cursor:pointer"><input type="checkbox" id="bigApprove" style="accent-color:var(--measure)">
          <span class="k" style="margin:0">大额授权：一次授权 100 份额度，之后每笔投保只签一笔交易</span></label>
      </div>
      <div class="k" id="allowLine" style="margin-top:6px">授权余额：连接钱包后显示</div>`), "按钮区");

// ② ABI 加 allowance
rep('const TOKABI=["function balanceOf(address) view returns (uint256)","function approve(address,uint256) returns (bool)"];',
    'const TOKABI=["function balanceOf(address) view returns (uint256)","function approve(address,uint256) returns (bool)","function allowance(address,address) view returns (uint256)"];', "ABI");

// ③ 授权余额显示函数（挂在 buy 之前）
rep('async function buy(){', nl(
`async function refreshAllowance(){
  const el=$("allowLine"); if(!el)return;
  try{
    const who=$("who").dataset.addr;
    if(!who){el.textContent="授权余额：连接钱包后显示";return}
    const a=await tok.allowance(who,V5);
    el.textContent="授权余额："+yuan(a)+" 元"+(a>=10000n?" · 足够直接投保（单笔）":a>0n?" · 不足一单时仍需授权":"");
  }catch(e){el.textContent="授权余额：读取失败"}
}
async function buy(){`), "余额函数");

// ④ buy 中段：先查授权余额，够则单笔；不够按开关授权 premium 或 ×100
rep(buyMid, nl(
`    const bp=new E.BrowserProvider(window.ethereum), s=await bp.getSigner();
    const me=await s.getAddress();
    const t=new E.Contract(TOK,TOKABI,s), v=new E.Contract(V5,V5ABI,s);
    const premium=await v.premiumOf(CITY_CODE[+$("city").value],+$("hours").value);   // G12 修复：报价必须走区划码
    const alw=await t.allowance(me,V5);
    if(alw<premium){
      const amt=$("bigApprove").checked?premium*100n:premium;   // 大额授权：一次 100 份，后续投保免二次签名
      toast("第一步：授权保费"+($("bigApprove").checked?"（100 份额度）":"")+"…");
      (await t.approve(V5,amt)).wait();
    }else{
      toast("授权余额足够，单笔投保…");
    }
    toast("投保上链…");`), "buy 中段");

// ⑤ 成功后与连接后刷新授权余额
rep(buyOk, nl('    await refreshPolicies();toast("投保成功","ok");\n    refreshAllowance();'), "成功后刷新");
rep('refreshPolicies();toast("钱包已连接","ok");',
    'refreshPolicies();refreshAllowance();toast("钱包已连接","ok");', "连接后刷新");

// ⑥ 去重：原尾部重复声明 me（中段已提前取得）
const meTail = nl('    const me=await s.getAddress();\n    $("who").dataset.addr=me;');
if (s.split(meTail).length - 1 !== 1) { console.error("预检失败：me 尾行"); process.exit(1); }
s = s.split(meTail).join(nl('    $("who").dataset.addr=me;'));
n++;

for (const m of s.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
  try { new Function(m[1]); } catch (e) { console.error("语法验证失败，不写盘：" + e.message.slice(0, 120)); process.exit(1); }
}
fs.writeFileSync(F, s, "utf8");
console.log("OK G12 写盘：" + n + " 处替换，语法验证通过");
