"""Record the actual local V6 UI; do not inject wallet accounts or synthetic RPC data."""
from pathlib import Path
import json
import time
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "12-开发归档/2026-11-02/演示录制"
EVIDENCE = ROOT / "08-截图存证/2026-11-02-运行与投保完善"
RAW.mkdir(parents=True, exist_ok=True)
EVIDENCE.mkdir(parents=True, exist_ok=True)
BASE = "http://127.0.0.1:8096/"
report = {"schema": "rainproof/read-only-recording@1", "network": "BOT Chain testnet 968", "steps": [], "writeRequests": []}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1,
        record_video_dir=str(RAW), record_video_size={"width": 1440, "height": 900}, reduced_motion="reduce")
    page = context.new_page()
    started = time.monotonic()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))

    def intercept(route):
        try:
            payload = json.loads(route.request.post_data or "null")
        except (ValueError, TypeError):
            payload = None
        rows = payload if isinstance(payload, list) else [payload]
        writes = [row.get("method") for row in rows if isinstance(row, dict) and row.get("method", "").startswith(("eth_send", "personal_", "wallet_"))]
        if writes:
            report["writeRequests"].extend(writes)
            route.abort()
        else:
            route.continue_()

    context.route("**/*", intercept)

    def caption(title, description):
        page.evaluate("""([title, description]) => {
          let el = document.getElementById('recording-caption');
          if (!el) { el = document.createElement('div'); el.id='recording-caption'; document.body.appendChild(el); }
          el.style.cssText='position:fixed;left:32px;right:32px;bottom:20px;z-index:10000;background:rgba(8,18,27,.97);border:1px solid #69d9c8;border-radius:12px;padding:14px 22px;color:#e6eef6;font:20px/1.5 system-ui;pointer-events:none';
          el.replaceChildren();
          const strong=document.createElement('strong');strong.textContent=title;el.appendChild(strong);
          const detail=document.createElement('div');detail.style.cssText='font-size:16px;color:#a8bac8';detail.textContent=description;el.appendChild(detail);
        }""", [title, description])

    def visit(name):
        page.goto(BASE + name, wait_until="domcontentloaded", timeout=25000)

    def hold(label, seconds=9):
        report["steps"].append({"label": label, "seconds": round(time.monotonic()-started, 2), "url": page.url})
        page.wait_for_timeout(seconds * 1000)

    try:
        visit("insurance.html")
        caption("雨证 RainProof · V6 技术原型", "只读实录 · 测试网与模拟资金 · 2026-11-02。本片不演示真实保险业务赔付。")
        hold("产品首页", 8)
        visit("index-v6.html#dashboard")
        caption("技术看板 · 区分链上演示、历史对照与实时气象", "浏览器气象对照不会写链；投保和领取以合约规则、喂价时效及资金条件为准。")
        hold("技术看板", 10)
        visit("rider.html")
        page.wait_for_function("document.getElementById('buy').disabled === false", timeout=30000)
        page.wait_for_function("document.getElementById('rainv').textContent.includes('mm')", timeout=15000)
        page.locator("#buy").evaluate("el=>el.scrollIntoView({block:'center'})")
        caption("选择区划与保障时长，读取链上报价", "本页钱包体验由当前钱包支付模拟保费。首次通常先授权、再投保；RDROP 不能兑换人民币。")
        page.screenshot(path=str(EVIDENCE / "rider-fresh-1440.png"))
        hold("可投保区划报价", 9)
        page.select_option("#city", "420525")
        page.wait_for_function("document.getElementById('feedtag').textContent.includes('过期')", timeout=30000)
        assert page.locator("#buy").is_disabled()
        page.wait_for_function("document.getElementById('rainv').textContent.includes('mm')", timeout=15000)
        page.locator("#buy").evaluate("el=>el.scrollIntoView({block:'center'})")
        caption("分歧未核实，喂价过期时暂停投保", "远安县为录制时的实际状态。保留报价与原因，不通过续期或更改阈值掩盖数据问题。")
        page.screenshot(path=str(EVIDENCE / "rider-stale-1440.png"))
        hold("真实异常状态", 9)
        visit("verify-v6.html")
        page.wait_for_timeout(6000)
        caption("独立核验 · 查看代码、治理、迁移证据与资金台账", "核验结果用于验证合约与证据对应关系；不等于每个区划当前都能投保。")
        hold("V6 核验", 10)
        visit("terms.html")
        caption("明确规则与边界 · 赔付路径已演练", "当前版本没有真实业务赔付案例。三模型一致不代表个人收入损失；真实运营仍需业务与数据接入。")
        hold("规则与风险", 9)
        visit("insurance.html")
        caption("雨是数据 · 判定是代码 · 证据可核验", "公网入口 bruceleezh.github.io/rainproof-pro/ · 本片取自已修复的本地工作副本，未发送链上交易。")
        hold("结束", 6)
        assert not report["writeRequests"], report["writeRequests"]
        assert not errors, errors
    finally:
        report["errors"] = errors
        report["elapsedSeconds"] = round(time.monotonic()-started, 2)
        video = page.video
        context.close()
        report["rawVideo"] = str(video.path())
        browser.close()
        (RAW / "recording.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False), flush=True)
