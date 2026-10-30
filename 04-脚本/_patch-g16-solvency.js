#!/usr/bin/env node
/** G16 补丁：console.html 偿付能力面板（固定种子蒙特卡洛 + 实时池子覆盖）。 */
const fs = require("fs");
const path = require("path");
const F = path.join(__dirname, "..", "05-演示站点", "console.html");
let s = fs.readFileSync(F, "utf8");
const EOL = s.includes("\r\n") ? "\r\n" : "\n";
const nl = t => t.replace(/\n/g, EOL);
const anchors = ["\n  <footer>", "ledgerLoad();\nmain().catch(e=>{"];
for (const a of anchors) {
  const c = s.split(a).length - 1;
  if (c !== 1) { console.error("预检失败：" + c + " → " + a.slice(0, 40)); process.exit(1); }
}
console.log("锚点预检：2/2");
let n = 0;
function rep(o, t, label) { o = nl(o); t = nl(t); const c = s.split(o).length - 1; if (c !== 1) throw new Error(label + " " + c); s = s.split(o).join(t); n++; }

// ① 面板区（台账之后、footer 之前）
rep("\n  <footer>", nl(
`
  <section class="sec">
    <h2>偿付能力<em>固定种子蒙特卡洛（五城等权 · 24h 档）× 实时池子覆盖</em></h2>
    <div class="panel">
      <div class="ctab" style="margin-top:0">
        <div class="chead" style="grid-template-columns:90px 130px 110px 140px 130px 130px"><span>在保规模</span><span>期望净结果(元)</span><span>出险概率</span><span>VaR99 净损失(元)</span><span>最坏模拟(元)</span><span>当前池子覆盖</span></div>
        <div id="solvBody"><span class="loading">读取模拟输出</span></div>
      </div>
      <p class="note" style="margin-top:10px" id="solvNote"></p>
    </div>
  </section>

  <footer>`), "面板区");

// ② 加载逻辑（挂在 ledgerLoad 调用之后）
rep("ledgerLoad();\nmain().catch(e=>{", nl(
`async function solvencyLoad(){
  const box = $("solvBody"); if (!box) return;
  try {
    const mc = await (await fetch("./solvency-mc.json")).json();
    const poolYuan = Number(await v4.poolBalance()) / 100;   // 实时池子（元）
    const fmt = v => { const y = v * 10000; return (y > 0 ? "+" : "") + y.toFixed(0); };   // 0.01 ETH≙100 元
    box.innerHTML = Object.entries(mc.scenarios).map(([k, d]) => {
      const var99 = d.VaR99_eth * 10000, worst = d.max_eth * 10000;
      const cover = var99 > 0 ? (poolYuan / var99).toFixed(2) + "× VaR99" : "—（99% 分位仍为净收）";
      const coverCls = var99 > 0 && poolYuan < var99 ? "bad" : "";
      return \`<div class="crow" style="grid-template-columns:90px 130px 110px 140px 130px 130px">
        <b>\${k.replace("N", "N=")}</b>
        <span class="v">\${fmt(d.E_loss_eth)}\${d.E_loss_eth < 0 ? "（盈）" : ""}</span>
        <span class="v">\${(d.P_loss_gt0 * 100).toFixed(1)}%</span>
        <span class="v">\${fmt(d.VaR99_eth)}\${d.VaR99_eth < 0 ? "（盈）" : ""}</span>
        <span class="v" style="color:var(--bad)">+\${worst.toFixed(0)}</span>
        <span class="v \${coverCls}">\${cover}</span></div>\`;
    }).join("");
    $("solvNote").innerHTML = "数据：" + esc(mc.source) + "；换算 " + esc(mc.note) +
      "。当前池子 <b class='money'>" + poolYuan.toFixed(2) + " 元</b>（实时读链）。重算：" + esc(mc.regenerate) +
      "。口径说明：净结果=赔付−保费（负=承保盈利）；VaR99&lt;0 表示 99% 模拟路径下不需动用池子。";
  } catch (e) { box.innerHTML = '<span class="err">模拟输出读取失败：' + (e.message || e).toString().slice(0, 80) + '</span>'; }
}
function esc(x){return String(x).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}
solvencyLoad();
ledgerLoad();
main().catch(e=>{`), "加载逻辑");

for (const m of s.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
  try { new Function(m[1]); } catch (e) { console.error("语法验证失败，不写盘：" + e.message.slice(0, 120)); process.exit(1); }
}
fs.writeFileSync(F, s, "utf8");
console.log("OK G16 写盘：" + n + " 处替换，语法验证通过");
