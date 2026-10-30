#!/usr/bin/env node
/** index-v4.html → index-v5.html 适配（2026-10-26）：v5 合约 + 第六柱（用户城市）+ 三级城市选择器 */
const fs = require("fs");
const path = require("path");
const P = path.join(__dirname, "..", "05-演示站点");
let s = fs.readFileSync(path.join(P, "index-v5.html"), "utf8");
const v5abi = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "03-合约", "RainDeliveryInsuranceV5.abi.json"), "utf8"));
let n = 0;
const crlf = t => t.replace(/\n/g, "\r\n");
function rep(oldStr, newStr, label, count) {
  oldStr = crlf(oldStr); newStr = crlf(newStr);
  const hits = s.split(oldStr).length - 1;
  if (hits !== (count === undefined ? 1 : count)) throw new Error("【" + label + "】期望 " + (count === undefined ? 1 : count) + " 实际 " + hits + " —— 中止未写回");
  s = s.split(oldStr).join(newStr); n += hits;
}

// ---- ① 合约与 ABI ----
{
  const lines = s.split("\r\n");
  const i = lines.findIndex(l => l.startsWith("const ABI = "));
  if (i < 0) throw new Error("找不到 const ABI 行");
  lines[i] = 'const ABI = ' + JSON.stringify(v5abi) + ';   // v5（全国区域版 · uint32 行政区划代码）';
  s = lines.join("\r\n"); n++;
}
rep('const FALLBACK_ADDR = "0xd0f6C96292406509C601c3cB1DD77b8bF658fCA2";',
    'const FALLBACK_ADDR = "0xFE3D9f897CE3038B75b876923D843F9F6752e136";   // v5 全国区域版', "V5 地址");
rep('<b class="mono" title="0xd0f6C96292406509C601c3cB1DD77b8bF658fCA2">0xd0f6…fCA2</b>',
    '<b class="mono" title="0xFE3D9f897CE3038B75b876923D843F9F6752e136">0xFE3D…e136</b>', "页头地址");
rep('<b id="footAddr" title="0xd0f6C96292406509C601c3cB1DD77b8bF658fCA2">0xd0f6…fCA2</b>',
    '<b id="footAddr" title="0xFE3D9f897CE3038B75b876923D843F9F6752e136">0xFE3D…e136</b>', "页脚地址");

// ---- ② CSS：6 列看板 + 选择器弹层 ----
rep('  .cols5{position:absolute;inset:0;display:grid;grid-template-columns:repeat(5,1fr);align-items:end;',
'  .cols5.cols6{grid-template-columns:repeat(6,1fr)}\n' +
'  .foot5.cols6{grid-template-columns:repeat(6,1fr);gap:var(--s4)}\n' +
'  .ucpop{position:fixed;z-index:80;background:var(--surface);border:1px solid var(--line-2);border-radius:var(--r);\n' +
'    box-shadow:0 24px 60px -20px rgba(0,0,0,.95);padding:16px 18px;width:min(480px,94vw);display:none}\n' +
'  .ucpop.open{display:block}\n' +
'  .ucpop .cfg{margin-top:8px}\n' +
'  .ucpop .cfg select{flex:1 1 120px;min-width:0}\n' +
'  .ucpop .list{max-height:200px;overflow:auto;border:1px solid var(--hair);border-radius:var(--r-sm);margin-top:8px}\n' +
'  .ucpop .list button{display:block;width:100%;text-align:left;background:none;border:0;border-bottom:1px solid var(--hair);\n' +
'    color:var(--ink);font-size:13px;padding:8px 10px;cursor:pointer}\n' +
'  .ucpop .list button:hover{background:var(--measure-dim)}\n' +
'  .ucpop .list button:last-child{border-bottom:0}\n' +
'  .ucpop .hint{font-size:var(--t-lab);color:var(--faint);margin-top:8px;line-height:1.7}\n' +
'  .cols5{position:absolute;inset:0;display:grid;grid-template-columns:repeat(5,1fr);align-items:end;', "CSS 注入");

// ---- ③ 看板 6 列（boardHTML 类名条件化）----
rep('<div class="cols5">', '<div class="cols5${meas.length > 5 ? " cols6" : ""}">', "boardHTML cols");
rep('<div class="foot5">', '<div class="foot5${meas.length > 5 ? " cols6" : ""}">', "boardHTML foot");

// ---- ④ loadRegions：用户城市取值 + 第六柱 ----
rep('  const vals = {};\n  for (const { id } of REGIONS) {\n    try { vals[id] = Number(await S.readC.rainfall(id)); } catch (e) { /* 单点失败不影响其余 */ }\n  }',
'  const vals = {};\n  for (const { id } of REGIONS) {\n    try { vals[id] = Number(await S.readC.rainfall(id)); } catch (e) { /* 单点失败不影响其余 */ }\n  }\n' +
'  const UC = userCity();\n' +
'  if (UC) { try { vals[UC.code] = Number(await S.readC.rainfall(UC.code)); } catch (e) {} }   // 第六柱：用户城市（uint32 区划码）', "loadRegions 取值");
rep('  const sig = thr + "|" + sel + "|" + REGIONS.map(r => vals[r.id]).join(",");   // ★ 阈值也算进签名：切时长会换阈值，只比雨量会把旧刻度留在页面上',
'  const sig = thr + "|" + sel + "|" + REGIONS.map(r => vals[r.id]).join(",") + "|" + (UC ? (vals[UC.code] ?? "x") : "nouser");   // ★ 阈值也算进签名：切时长会换阈值，只比雨量会把旧刻度留在页面上', "loadRegions 签名");
rep('      meas.push({ id, label, v, pct, belowPct, hit: v >= thr, capped: v > thr * 2 });\n    }\n    if (meas.length) {',
'      meas.push({ id, label, v, pct, belowPct, hit: v >= thr, capped: v > thr * 2 });\n    }\n' +
'    if (UC && vals[UC.code] != null) {                     // 第六柱：与五城同一把尺子\n' +
'      const v = vals[UC.code];\n' +
'      const pct = Math.min(100, Math.round(v / (thr * 2) * 100));\n' +
'      const belowPct = Math.min(100, Math.round(thr / Math.min(Math.max(v, thr), thr * 2) * 100));\n' +
'      meas.push({ id: UC.code, label: ucShort(UC.name), v, pct, belowPct, hit: v >= thr, capped: v > thr * 2, tag: "我的城市" });\n' +
'    }\n' +
'    if (meas.length) {', "loadRegions 第六柱");

// ---- ⑤ 下拉与顶部片：追加用户城市 ----
rep("  sel.innerHTML = REGIONS.map(r => `<option value=\"${r.id}\">${r.label}（#${r.id}）</option>`).join(\"\");",
"  sel.innerHTML = REGIONS.map(r => `<option value=\"${r.id}\">${r.label}（#${r.id}）</option>`).join(\"\") + userOptionHTML();", "下拉追加");
rep('  $("regionChips").innerHTML = REGIONS.map(r =>\n    `<button class="chip" data-region="${r.id}">${r.label}</button>`).join("");',
'  $("regionChips").innerHTML = REGIONS.map(r =>\n    `<button class="chip" data-region="${r.id}">${r.label}</button>`).join("") +\n    (userCity() ? `<button class="chip" data-region="${userCity().code}">${ucShort(userCity().name)}</button>` : "");', "顶部片追加");

// ---- ⑥ 城市选择器：HTML（挂在 regionChips 后）----
rep('        <div class="chips" id="regionChips" style="margin-top:8px"></div>',
'        <div class="chips" id="regionChips" style="margin-top:8px"></div>\n' +
'        <div class="row" style="margin-top:10px"><button class="btn sm" id="ucBtn">＋ 我的城市（全国省市县）</button>\n' +
'        <span class="tag" id="ucNow"></span></div>\n' +
'        <div class="ucpop" id="ucPop">\n' +
'          <div class="row" style="justify-content:space-between"><b>选择我的城市</b><button class="btn sm" id="ucClose">关闭</button></div>\n' +
'          <div class="cfg"><select id="ucProv"></select><select id="ucCity"></select><select id="ucArea"></select></div>\n' +
'          <input id="ucSearch" placeholder="或直接搜索县名/市名：义乌 · 寿光 · 昆山…" style="width:100%;margin-top:8px">\n' +
'          <div class="list" id="ucList"><div class="hint">输入关键字，或用上方三级选择</div></div>\n' +
'          <div class="hint">数据：民政部行政区划（省/市/县三级，3056 个县级单位，区划码即链上 regionId）。第六柱显示该城市的<b>链上累计降雨</b>；尚末开通保单的城市投保会被合约如实拒（region not available）—— 开通由运营方多签二票执行（registerRegion）。</div>\n' +
'        </div>', "选择器 HTML");

// ---- ⑦ 用户城市工具 + 选择器 JS（插在下拉区域列表段之前）----
rep('/* 下拉区域列表 */',
'/* ---- 我的城市（V5）：localStorage 存 {code,name}，code = 民政部行政区划码 = 链上 regionId ---- */\n' +
'const UC_KEY = "hanxong_user_city_v5";\n' +
'const userCity = () => { try { const j = JSON.parse(localStorage.getItem(UC_KEY) || "null"); return j && j.code ? { code: Number(j.code), name: String(j.name) } : null; } catch (e) { return null; } };\n' +
'const ucShort = name => String(name).replace(/(省|市|自治区|特别行政区|壮族|回族|维吾尔|哈萨克|彝族|白族|苗族|土家族|蒙古自治州)/g, "");\n' +
'const userOptionHTML = () => { const u = userCity(); return u ? `<option value="${u.code}">${ucShort(u.name)}（我的城市）</option>` : ""; };\n' +
'let CN_TREE = null;\n' +
'async function ucOpen() {\n' +
'  $("ucPop").classList.add("open");\n' +
'  if (!CN_TREE) {\n' +
'    try { CN_TREE = await (await fetch("./cn-cities.json")).json(); }\n' +
'    catch (e) { $("ucList").innerHTML = \'<div class="hint">行政区划数据加载失败（cn-cities.json）</div>\'; return; }\n' +
'  }\n' +
'  const prov = $("ucProv");\n' +
'  if (!prov.options.length) { prov.innerHTML = CN_TREE.map(p => `<option value="${p.code}">${p.name}</option>`).join(""); ucFillCities(); }\n' +
'  $("ucSearch").focus();\n' +
'}\n' +
'function ucProvObj() { return CN_TREE.find(p => p.code === $("ucProv").value); }\n' +
'function ucFillCities() {\n' +
'  const p = ucProvObj();\n' +
'  $("ucCity").innerHTML = (p.children || []).map(c => `<option value="${c.code}">${c.name}</option>`).join("");\n' +
'  ucFillAreas();\n' +
'}\n' +
'function ucFillAreas() {\n' +
'  const c = ucProvObj().children.find(x => x.code === $("ucCity").value);\n' +
'  const areas = (c && c.children) || [];\n' +
'  $("ucArea").innerHTML = areas.length ? areas.map(a => `<option value="${a.code}">${a.name}</option>`).join("") : \'<option value="">（本地级市：直接选它）</option>\';\n' +
'  ucRenderPick();\n' +
'}\n' +
'function ucRenderPick() {\n' +
'  const p = ucProvObj();\n' +
'  const c = p.children.find(x => x.code === $("ucCity").value);\n' +
'  const a = ((c && c.children) || []).find(x => x.code === $("ucArea").value);\n' +
'  const pick = a || c || p;\n' +
'  $("ucList").innerHTML = `<button data-code="${pick.code}" data-name="${pick.name}">选它：<b>${pick.name}</b> <span class="mono">#${pick.code}</span> · ${p.name}${c && c !== pick ? " · " + c.name : ""}</button>`;\n' +
'}\n' +
'function ucSearch(q) {\n' +
'  q = q.trim();\n' +
'  if (!q) { $("ucList").innerHTML = \'<div class="hint">输入关键字，或用上方三级选择</div>\'; return; }\n' +
'  const out = [];\n' +
'  for (const p of CN_TREE) for (const c of (p.children || [])) for (const a of (c.children || [])) {\n' +
'    if (out.length >= 12) break;\n' +
'    if (a.name.includes(q)) out.push({ code: a.code, name: a.name, path: p.name + " · " + c.name });\n' +
'  }\n' +
'  $("ucList").innerHTML = out.length\n' +
'    ? out.map(r => `<button data-code="${r.code}" data-name="${r.name}"><b>${r.name}</b> <span class="mono">#${r.code}</span> · ${r.path}</button>`).join("")\n' +
'    : \'<div class="hint">没找到 —— 换个关键字试试（支持县名/县级市名）</div>\';\n' +
'}\n' +
'function ucPick(code, name) {\n' +
'  localStorage.setItem(UC_KEY, JSON.stringify({ code: Number(code), name }));\n' +
'  $("ucPop").classList.remove("open");\n' +
'  location.reload();   // 重载后第六柱、下拉与顶部片都按新城市渲染\n' +
'}\n\n' +
'/* 下拉区域列表 */', "选择器 JS");

// ---- ⑧ 选择器事件绑定（挂在 regionChips onclick 之后）----
rep('  $("regionChips").onclick = (e) => {\n    const b = e.target.closest && e.target.closest(".chip");\n    if (b) selectRegion(Number(b.dataset.region));\n  };',
'  $("regionChips").onclick = (e) => {\n    const b = e.target.closest && e.target.closest(".chip");\n    if (b) selectRegion(Number(b.dataset.region));\n  };\n' +
'  $("ucBtn").onclick = ucOpen;\n' +
'  $("ucClose").onclick = () => $("ucPop").classList.remove("open");\n' +
'  $("ucProv").onchange = ucFillCities;\n' +
'  $("ucCity").onchange = ucFillAreas;\n' +
'  $("ucArea").onchange = ucRenderPick;\n' +
'  $("ucSearch").oninput = (e) => ucSearch(e.target.value);\n' +
'  $("ucList").onclick = (e) => { const b = e.target.closest && e.target.closest("button[data-code]"); if (b) ucPick(b.dataset.code, b.dataset.name); };\n' +
'  { const u = userCity(); $("ucNow").textContent = u ? ("我的城市：" + ucShort(u.name) + " · #" + u.code) : "尚未选择 —— 点右边按钮，把家乡加为第六柱"; }', "事件绑定");

fs.writeFileSync(path.join(P, "index-v5.html"), s, "utf8");
console.log("OK index-v5.html 适配完成：" + n + " 处替换全部精确命中");
