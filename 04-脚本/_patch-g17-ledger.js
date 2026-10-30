#!/usr/bin/env node
/** G17 补丁：console.html 资金流水台账（事件驱动 + 余额对账 + CSV 导出）。 */
const fs = require("fs");
const path = require("path");
const F = path.join(__dirname, "..", "05-演示站点", "console.html");
let s = fs.readFileSync(F, "utf8");
const EOL = s.includes("\r\n") ? "\r\n" : "\n";
const nl = t => t.replace(/\n/g, EOL);
const anchors = ["\n  <footer>", "main().catch(e=>{"];
for (const a of anchors) {
  const c = s.split(a).length - 1;
  if (c !== 1) { console.error("预检失败：" + c + " → " + a.slice(0, 40)); process.exit(1); }
}
console.log("锚点预检：2/2");
let n = 0;
function rep(o, t, label) { o = nl(o); t = nl(t); const c = s.split(o).length - 1; if (c !== 1) throw new Error(label + " " + c); s = s.split(o).join(t); n++; }

// ① 台账区（footer 之前）
rep("\n  <footer>", nl(
`
  <section class="sec">
    <h2>资金流水台账<em>注资 · 保费 · 赔付 · 退保 · 提款 —— 期末余额与链上逐分对账</em></h2>
    <div class="panel">
      <div class="ctab" style="margin-top:0">
        <div class="chead" style="grid-template-columns:80px 90px 110px minmax(120px,1fr) 110px 90px 90px"><span>区块</span><span>类型</span><span>金额(元)</span><span>对方</span><span>关联保单</span><span>余额快照</span><span>交易</span></div>
        <div id="ledgerBody"><span class="loading">读取链上事件</span></div>
      </div>
      <div class="row" style="margin-top:12px;justify-content:space-between">
        <span class="k" style="margin:0" id="ledgerCheck">对账读取中</span>
        <button class="btn primary sm" id="ledgerCsv">导出台账 CSV</button>
      </div>
      <p class="note" style="margin-top:10px">台账由链上事件推导（PoolFunded / PolicyBought+保费 / ClaimPaid / PolicyRefunded / PoolWithdrawn）；验收口径：台账推算期末余额 === 合约 <code>poolBalance()</code>，逐分一致才显示 ✅。</p>
    </div>
  </section>

  <footer>`), "台账区");

// ② 台账逻辑（main().catch 之前挂定义，再调用）
rep("main().catch(e=>{", nl(
`/* G17 资金流水台账：事件 → 分录；期末余额与链上对账 */
const IF = new ethers.Interface(V5ABI);
const EV = {
  fund:   ethers.id("PoolFunded(address,uint256,uint256)"),
  buy:    ethers.id("PolicyBought(uint256,address,uint32,uint256,uint256)"),
  claim:  ethers.id("ClaimPaid(uint256,address,uint256,uint8)"),
  refund: ethers.id("PolicyRefunded(uint256,address,uint256)"),
  wd:     ethers.id("PoolWithdrawn(address,uint256)"),
};
window.ledgerRows = [];
async function ledgerLoad(){
  const box = $("ledgerBody"); if (!box) return;
  try {
    const logs = await provider.getLogs({ address: V5, fromBlock: 0 });
    const entries = [];
    for (const lg of logs) {
      const p = IF.parseLog({ topics: [...lg.topics], data: lg.data });
      const a = p.args; const id = p.name;
      if (id === "PoolFunded")      entries.push({ blk: lg.blockNumber, type: "注资",   amt: Number(a.amount) / 100, who: a.from, pid: "", snap: Number(a.newBalance) / 100, tx: lg.transactionHash });
      else if (id === "PolicyBought") entries.push({ blk: lg.blockNumber, type: "保费", amt: -1, who: a.rider, pid: "#" + a.policyId, snap: null, tx: lg.transactionHash, needPrem: a.policyId });
      else if (id === "ClaimPaid")  entries.push({ blk: lg.blockNumber, type: "赔付",   amt: -Number(a.amount) / 100, who: a.rider, pid: "#" + a.policyId, snap: null, tx: lg.transactionHash });
      else if (id === "PolicyRefunded") entries.push({ blk: lg.blockNumber, type: "退保", amt: -Number(a.amount) / 100, who: a.payer, pid: "#" + a.policyId, snap: null, tx: lg.transactionHash });
      else if (id === "PoolWithdrawn") entries.push({ blk: lg.blockNumber, type: "提款", amt: -Number(a.amount) / 100, who: a.to, pid: "", snap: null, tx: lg.transactionHash });
    }
    entries.sort((x, y) => x.blk - y.blk);
    for (const e of entries) if (e.needPrem !== undefined) {   // 保费金额问保单本体
      try { const q = await v4.policies(e.needPrem); e.amt = Number(q.premium) / 100; } catch (err) { e.amt = 0; }
      delete e.needPrem;
    }
    window.ledgerRows = entries;
    box.innerHTML = entries.length ? entries.map(e => \`<div class="crow" style="grid-template-columns:80px 90px 110px minmax(120px,1fr) 110px 90px 90px">
      <b>#\${e.blk}</b><span class="v" style="text-align:left">\${e.type}</span>
      <span class="money">\${(e.amt > 0 ? "+" : "") + e.amt.toFixed(2)}</span>
      <span class="v" style="text-align:left">\${String(e.who).slice(0, 10)}…</span>
      <span class="v" style="text-align:left">\${e.pid || "—"}</span>
      <span class="v">\${e.snap != null ? e.snap.toFixed(2) : "—"}</span>
      <span class="v" title="\${e.tx}">\${e.tx.slice(0, 8)}…</span></div>\`).join("") : '<span class="empty">暂无资金事件</span>';
    // 对账：台账推算 vs 链上 poolBalance
    const derived = entries.reduce((t, e) => t + e.amt, 0);
    const onchain = Number(await v4.poolBalance()) / 100;
    $("ledgerCheck").innerHTML = Math.abs(derived - onchain) < 0.005
      ? \`台账推算 <b>\${derived.toFixed(2)}</b> 元 === 链上 poolBalance <b>\${onchain.toFixed(2)}</b> 元 <b class="ok" style="color:var(--ok)">✅ 逐分一致</b>\`
      : \`⚠ 台账 \${derived.toFixed(2)} ≠ 链上 \${onchain.toFixed(2)}（差 \${(derived - onchain).toFixed(2)}）—— 检查未解码事件\`;
  } catch (e) { box.innerHTML = '<span class="err">台账读取失败：' + (e.message || e).toString().slice(0, 80) + '</span>'; }
}
window.ledgerCsv = function ledgerCsv(){
  const head = "区块,类型,金额(元),对方,关联保单,余额快照(元),交易哈希";
  const rows = (window.ledgerRows || []).map(e => [e.blk, e.type, e.amt.toFixed(2), e.who, e.pid || "", e.snap != null ? e.snap.toFixed(2) : "", e.tx].join(","));
  return [head, ...rows].join("\\r\\n");
};
$("ledgerCsv").onclick = () => {
  if (!(window.ledgerRows || []).length) return toast("暂无流水可导出", "err");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\\ufeff" + window.ledgerCsv()], { type: "text/csv" }));
  a.download = "rainproof-ledger-" + new Date().toISOString().slice(0, 10) + ".csv";
  a.click(); URL.revokeObjectURL(a.href);
  toast("台账 CSV 已下载（" + window.ledgerRows.length + " 条）", "ok");
};
ledgerLoad();
main().catch(e=>{`), "台账逻辑");

for (const m of s.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
  try { new Function(m[1]); } catch (e) { console.error("语法验证失败，不写盘：" + e.message.slice(0, 120)); process.exit(1); }
}
fs.writeFileSync(F, s, "utf8");
console.log("OK G17 写盘：" + n + " 处替换，语法验证通过");
