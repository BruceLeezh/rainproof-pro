# -*- coding: utf-8 -*-
"""把 B 侧页面改动（实时雨量面板 + 事件按字段名取值 + ABI 形状自检 + 无障碍 + 文案真值）
移植到 merge 后保留的 A 版 05-演示站点/index.html 上。每条替换都断言命中次数，命中数不对就整条跳过并记下来。"""
import io, re, sys

P = r"C:\Users\lenovo\Desktop\汉客松\rainproof\05-演示站点\index.html"
src = io.open(P, encoding="utf-8", newline="").read()
src = src.replace("\r\n", "\n")   # 统一到 LF 做匹配，写回时再还原 CRLF（该文件是 CRLF）
log = []
ok = 0
bad = 0

def rep(old, new, n=1, tag=""):
    global src, ok, bad
    c = src.count(old)
    if c != n:
        log.append("SKIP  %-28s 期望 %d 命中，实际 %d" % (tag, n, c))
        bad += 1
        return
    src = src.replace(old, new, n)
    log.append("OK    %-28s %d 处" % (tag, c))
    ok += 1

def resub(pat, new, n=1, tag="", flags=re.S):
    global src, ok, bad
    c = len(re.findall(pat, src, flags))
    if c != n:
        log.append("SKIP  %-28s 期望 %d 命中，实际 %d" % (tag, n, c))
        bad += 1
        return
    src = re.sub(pat, lambda m: new, src, count=n, flags=flags)
    log.append("OK    %-28s %d 处" % (tag, c))
    ok += 1

# ---------------- 1. 面板按钮 + aria-pressed ----------------
rep(
 '        <button class="f on" data-mode="chain">演示值 · 链上<span class="eni">Demo (on-chain)</span></button>\n'
 '        <button class="f" data-mode="real">真值 · 真实观测<span class="eni">Real rainfall</span></button>\n',
 '        <button class="f on" data-mode="chain" aria-pressed="true">演示值 · 链上<span class="eni">Demo (on-chain)</span></button>\n'
 '        <button class="f" data-mode="real" aria-pressed="false">真值 · 真实观测<span class="eni">Real rainfall</span></button>\n'
 '        <button class="f" data-mode="live" aria-pressed="false">实时 · 现网直连<span class="eni">Live (off-chain)</span></button>\n',
 tag="rainMode 三键")

# ---------------- 2. liveBoard 容器 ----------------
rep('      <div class="block" id="realBoard" hidden></div>\n',
    '      <div class="block" id="realBoard" hidden></div>\n'
    '      <div class="block" id="liveBoard" hidden></div>\n',
    tag="liveBoard div")

# ---------------- 3. 静态档位加 disabled ----------------
rep('<select id="hoursInput" class="vh">', '<select id="hoursInput" class="vh" disabled>', tag="hoursInput disabled")

# ---------------- 4. 保费区间文案（E12） ----------------
rep('收 1 份保费（0.0002–0.002）却要赔最高 10 倍（0.01），',
    '最低一档保费 0.00053 BOT 却要赔最高 0.01 BOT（链上 10 格实值 0.00053–0.00105；'
    '<code>MIN_PREMIUM</code> = 0.00002 BOT），单格 9.5–18.9×，',
    tag="保费杠杆文案")

# ---------------- 5. 共用辅助：fnMissing / ABI_SHAPE / evArg / press / curHours ----------------
HELPERS = '''
/* -------- 本轮加入：ABI 形状自检 + 事件按字段名取值 + 无障碍同步（B 侧修复，2026-10-12） -------- */
// 「这条链没这个 getter」与「解码/网络错误」必须分开：后者要报出来，不能静默降级成"没登记"。
const fnMissing = e => {
  const c = (e && e.code) || "", m = String((e && (e.shortMessage || e.message)) || "");
  return c === "CALL_EXCEPTION" && !(e && e.data) && !/revert|invalid|BAD_DATA|decode/i.test(m);
};
// 形状自检：字段数与当前链版本不符 ⇒ 停止解析这一栏，一个数字都不渲染（宁可空着，也不显示错位的假数字）
const ABI_SHAPE = { v3: { policies:16, judgements:10, feedJudgements:10 },
                    v2: { policies:15, judgements:9,  feedJudgements:9 } };
let shapeStop = "";
function shapeOk(name, res, tag) {
  const want = ABI_SHAPE[S.kind] ? ABI_SHAPE[S.kind][name] : null;
  const got = res && typeof res.length === "number" ? res.length : -1;
  if (want && got === want) return true;
  shapeStop = "ABI 与链上不匹配，已停止解析";
  console.error(`ABI 与链上不匹配：${tag} 返回 ${got} 个字段，当前版本 ${S.kind || "未知"} 应为 ${want} 个 —— 已停止解析，本栏不显示任何数字`);
  return false;
}
const shapeStopHTML = name => `<div class="empty" role="alert">⚠ ${esc(shapeStop || "ABI 与链上不匹配，已停止解析")}：<code>${esc(name)}</code> 的结果与当前版本（${esc(S.kind || "未知")}）的 ABI 不一致。这一栏不显示任何数字，请核对合约地址与版本。</div>`;
// 事件参数一律按 ABI 里的字段名取，绝不写下标：v2/v3 同名事件的字段数与位置不同
// （JudgementSubmitted 在 v3 的 confidence 与 inputHash 之间多了 rainfallAtJudgement），
// 写死 args[5..7] 就是本页之前把 v2 顺序钉死的地方。
const evArg = (d, name) => {
  const i = d && d.fragment ? d.fragment.inputs.findIndex(x => x.name === name) : -1;
  return i >= 0 ? d.args[i] : undefined;
};
// 当前选中的时长（小时）。读不到就是 null —— 绝不 "|| 72" 兜底成链上不一定卖的档位。
const curHours = () => { const v = Number($("hoursInput").value); return Number.isFinite(v) && v > 0 ? v : null; };
// 无障碍：视觉上的"选中"必须同时进 aria-pressed，否则读屏用户听不出选的是哪个。
const press = (el, on) => { el.classList.toggle("on", !!on); el.setAttribute("aria-pressed", on ? "true" : "false"); };
'''
rep('const abiFor = () => (S.kind === "v2" ? ABI_V2 : ABI);',
    'const abiFor = () => (S.kind === "v2" ? ABI_V2 : ABI);\n' + HELPERS,
    tag="helpers 插入")

# ---------------- 6. toast 按 kind 切 role ----------------
rep('  const t = $("toast");\n  t.textContent = msg;',
    '  const t = $("toast");\n'
    '  // 无障碍：错误用 role="alert"（assertive，立刻打断朗读），普通提示保持 role="status"（polite）。\n'
    '  t.setAttribute("role", kind === "err" ? "alert" : "status");\n'
    '  t.textContent = msg;',
    tag="toast role")

# ---------------- 7. bindRainMode 三态 ----------------
rep('''/* 两个按键：演示值（本页一直连的那条链）与真值（上面那份快照）。只切左栏这块面板，不动别的读数。 */
(function bindRainMode() {
  const bar = $("rainMode");
  if (!bar) return;
  bar.onclick = (e) => {
    const b = e.target.closest && e.target.closest(".f");
    if (!b) return;
    for (const x of bar.querySelectorAll(".f")) x.classList.toggle("on", x === b);
    const real = b.dataset.mode === "real";
    $("rainBoard").hidden = real;
    $("realBoard").hidden = !real;
    if (real) renderReal();
  };
  // 链接也能钉住这一状态：?rain=real 一进来就切到真值面板（截图、演示、给评委的直达链接都用得上）
  if (new URLSearchParams(location.search).get("rain") === "real") {
    const b = bar.querySelector('[data-mode="real"]');
    if (b) b.click();
  }
})();''',
'''/* 三个按键：演示值（本页连的那条链）· 真值（烘进本文件的历史快照）· 实时（浏览器现网直连，未上链）。
   只切左栏这块面板，不动别的读数。 */
(function bindRainMode() {
  const bar = $("rainMode");
  if (!bar) return;
  bar.onclick = (e) => {
    const b = e.target.closest && e.target.closest(".f");
    if (!b) return;
    for (const x of bar.querySelectorAll(".f")) press(x, x === b);
    const mode = b.dataset.mode;
    $("rainBoard").hidden = mode !== "chain";
    $("realBoard").hidden = mode !== "real";
    $("liveBoard").hidden = mode !== "live";
    if (mode === "real") renderReal();
    if (mode === "live") renderLive();
  };
  // 链接也能钉住这一状态：?rain=real / ?rain=live 一进来就切过去（截图、演示、给评委的直达链接都用得上）
  const wantRain = new URLSearchParams(location.search).get("rain");
  if (wantRain === "real" || wantRain === "live") {
    const b = bar.querySelector('[data-mode="' + wantRain + '"]');
    if (b) b.click();
  }
})();''',
    tag="bindRainMode 三态")

# ---------------- 8. 两处重画钩子 ----------------
rep('    if ($("realBoard") && !$("realBoard").hidden) renderReal();',
    '    if ($("realBoard") && !$("realBoard").hidden) renderReal();\n'
    '    if ($("liveBoard") && !$("liveBoard").hidden) renderLive();',
    tag="hook1 实时重画")
rep('''  const rb = $("realBoard");
  if (rb && !rb.hidden) renderReal();''',
    '''  const rb = $("realBoard");
  if (rb && !rb.hidden) renderReal();
  const lb = $("liveBoard");
  if (lb && !lb.hidden) renderLive();''',
    tag="hook2 实时重画")

# ---------------- 9. boardHTML 的 live 分支 ----------------
rep('''  const legend = opt.real
    ? `<span class="sw"><span class="sq m"></span>阈值线以下：实测累计，未进入结算</span>''',
    '''  const legend = opt.live
    ? `<span class="sw"><span class="sq m"></span>阈值线以下：现网实测，未进入结算</span>
       <span class="sw"><span class="sq y"></span>越过阈值线的那一段：会被结算的部分</span>
       <span class="sp">这是本页<b>此刻</b>从 Open-Meteo 现网拉来的读数；<b>不是链上读到的数，也不写进链上</b></span>`
    : opt.real
    ? `<span class="sw"><span class="sq m"></span>阈值线以下：实测累计，未进入结算</span>''',
    tag="legend live 分支")
rep('''             data-region="${m.id}"${m.bad ? ' style="opacity:.5"' : ""} title="${esc(m.label)} · ${opt.real ? "真值" : "累计"} ${m.v} mm（#${m.id}）"''',
    '''             aria-pressed="${m.id === cur.id}"
             data-region="${m.id}"${m.bad ? ' style="opacity:.5"' : ""} title="${esc(m.label)} · ${opt.live ? "现网" : opt.real ? "真值" : "累计"} ${m.v} mm（#${m.id}）"''',
    tag="chips aria+live")
rep('<div class="hero-lb">${esc(cur.label)} · ${opt.real ? "真值累计（写链值）" : "累计降雨"}</div>',
    '<div class="hero-lb">${esc(cur.label)} · ${opt.live ? "现网累计（未上链）" : opt.real ? "真值累计（写链值）" : "累计降雨"}</div>',
    tag="hero-lb live")
rep('<span class="k">${opt.real ? "数据来源" : "背景雨幕"}</span><span class="tag measure">${opt.real ? "Open-Meteo Archive" : "由此行驱动"}</span>',
    '<span class="k">${opt.real ? "数据来源" : "背景雨幕"}</span><span class="tag measure">${opt.live ? "Open-Meteo 现网" : opt.real ? "Open-Meteo Archive" : "由此行驱动"}</span>',
    tag="kvbox live")

# ---------------- 10. 实时面板整块 ----------------
LIVE_BLOCK = io.open(r"C:\Users\lenovo\Desktop\汉客松\_b_probe\index_mine.html", encoding="utf-8").read().split("\n")
block = "\n".join(LIVE_BLOCK[2241:2336])  # 我的注释头 + LIVE_COORDS … renderLive 结束
rep('function renderReal() {', block + '\n\nfunction renderReal() {', tag="LIVE 代码块插入")

# ---------------- 11. 事件描述改按字段名取值 ----------------
NEW_EV = '''      let desc = "";
      const A = n => evArg(d, n);   // 按 ABI 字段名取值，两版同名事件都能对上（v2 没有 rainfallAtJudgement）
      if (d.name === "PolicyBought")
        desc = `保单 #${A("policyId")} · ${short(A("rider"))} 投保 ${RName(A("regionId"))} · `
             + `${Math.round((Number(A("endTime")) - Number(A("effectiveFrom"))) / 3600)} 小时窗口`;
      else if (d.name === "RainfallUpdated")
        desc = `${RName(A("regionId"))} 累计降雨更新为 ${A("cumulativeMm")} mm · 置信度 ${A("confidence")} · 记录者 ${short(A("reporter"))}`;
      else if (d.name === "ClaimPaid")
        desc = `保单 #${A("policyId")} 赔付 ${fmtEth(A("amount"))} ${SYM()} 给 ${short(A("rider"))}`
             + (TIER_LABEL[Number(A("tier"))] ? ` · ${TIER_LABEL[Number(A("tier"))]}` : "");
      else if (d.name === "PoolFunded")   desc = `${short(A("from"))} 注资 ${fmtEth(A("amount"))} ${SYM()}，池子 → ${fmtEth(A("newBalance"))}`;
      else if (d.name === "PoolWithdrawn")desc = `提取 ${fmtEth(A("amount"))} ${SYM()} 给 ${short(A("to"))}`;
      else if (d.name === "OperatorChanged") desc = `operator ${short(A("from"))} → ${short(A("to"))}`;
      else if (d.name === "PausedSet")    desc = `合约${A("paused") ? "已暂停" : "已恢复"}`;
      // ↓ 判定层的事件过去只有事件名、没有内容（走 else 兜底），评委看不出 AI 判了什么。
      else if (d.name === "JudgementSubmitted")
        desc = `保单 #${A("policyId")} · ${Number(A("kind")) === 1 ? "损失判定" : "喂价验收"} · `
             + `${Number(A("decision")) === 1 ? "赔付 PAY" : "不赔 DENY"} · 置信度 ${A("confidence")} · ${A("sources")} 个源 · `
             + (A("rainfallAtJudgement") === undefined ? "" : `判定时雨量 ${A("rainfallAtJudgement")} mm · `)
             + `输入 ${shortHash(A("inputHash"))} 输出 ${shortHash(A("outputHash"))} · ${A("modelVersion")}`;
      else if (d.name === "UnderwritingDecision")
        desc = `${RName(A("regionId"))} 承保定价：保费 ${fmtEth(A("premium"))} ${SYM()} · `
             + `${["正常","加价","拒保"][Number(A("level"))] || "档 " + A("level")} · 依据 ${shortHash(A("reasonHash"))}`;
      else if (d.name === "PremiumSet")
        desc = `${RName(A("regionId"))} 保费表更新：${Number(A("windowHours"))} 小时窗口 → ${fmtEth(A("premium"))} ${SYM()} · 依据 ${shortHash(A("reasonHash"))}`;
      else if (d.name === "FeedRejected")
        desc = `${RName(A("regionId"))} 喂价被拒（置信度 ${A("confidence")} / ${A("sources")} 个源）· 依据 ${shortHash(A("inputHash"))}`;
      else if (d.name === "ReserveSet")
        desc = `准备金下限设为 ${fmtEth(A("amount"))} ${SYM()}`;
      else if (d.name === "ExposureSettled")
        desc = `保单 #${A("policyId")} 结清，未了结敞口回到 ${fmtEth(A("openExposure"))} ${SYM()}`;
      else if (d.name === "CoolingPeriodSet")
        desc = `冷静期设为 ${Number(A("seconds_")) / 3600} 小时`;
      else if (d.name === "EligibleSet")
        desc = `承保白名单 ${Number(A("ok")) === 1 ? "加入" : "移出"} ${short(A("who"))}`;
      else if (d.name === "EligibleRequiredSet")
        desc = `白名单${A("required") ? "已启用（只有白名单地址能投保）" : "已关闭（任何人可投保）"}`;
      else if (d.name === "PolicyRefunded")
        desc = `保单 #${A("policyId")} 退款 ${fmtEth(A("amount"))} ${SYM()} 给 ${short(A("payer"))}`;
      else desc = d.name;'''
resub(r'      let desc = "";\n      if \(d\.name === "PolicyBought"\).*?else desc = d\.name;', NEW_EV, tag="事件按字段名取值")

# ---------------- 12. judgements 读取：区分"没登记"与"没读到" ----------------
rep('''      let jm = null;
      try { jm = await S.readC.judgements(id); } catch (e) { jm = null; }''',
'''      let jm = null, jmErr = null;
      try { jm = await S.readC.judgements(id); }
      catch (e) {
        // 「这条链没这个 getter」= 老 ABI，当"没登记"；其它（解码/网络）必须说出来，不能静默吞成"尚未登记"
        if (fnMissing(e)) jm = null;
        else { jmErr = (e && (e.shortMessage || e.message)) || String(e); console.error(`judgements(${id}) 读取失败：${jmErr}`, e); }
      }''', tag="judgements catch")
rep('      const aiLine = (jm && jm.exists) ? `<b>AI 判定</b>',
    '      const aiLine = jmErr\n'
    '        ? `<span class="tag red">judgements 读取失败</span> <span class="none">${esc(jmErr)} —— 这是"这次没读到"，不是"链上没有登记"。</span>`\n'
    '        : (jm && jm.exists) ? `<b>AI 判定</b>',
    tag="aiLine 区分读失败")
rep('''      const [p, status, short] = await Promise.all([
        S.readC.policies(id), S.readC.policyStatus(id), S.readC.shortfall(id)
      ]);''',
'''      const [p, status, short] = await Promise.all([
        S.readC.policies(id), S.readC.policyStatus(id), S.readC.shortfall(id)
      ]);
      // E1：v3 的 policies 是 16 个字段、v2 是 15 个 —— 形状不对就整栏停止解析，不显示错位的假数字
      if (!shapeOk("policies", p, `policies(${id})`)) { box.innerHTML = shapeStopHTML("policies(id)"); return; }''',
    tag="policies 形状守卫")
rep('''      const name = RName(p.regionId);''',
'''      if (jm && !shapeOk("judgements", jm, `judgements(${id})`)) { box.innerHTML = shapeStopHTML("judgements(id)"); return; }
      const name = RName(p.regionId);''',
    tag="judgements 形状守卫")

io.open(P, "w", encoding="utf-8", newline="").write(src.replace("\n", "\r\n"))
io.open(r"C:\Users\lenovo\Desktop\汉客松\_b_probe\port_live_report.txt", "w", encoding="utf-8").write(
    "\n".join(log) + "\n\nOK=%d SKIP=%d\n" % (ok, bad))
print("OK=%d SKIP=%d" % (ok, bad))
