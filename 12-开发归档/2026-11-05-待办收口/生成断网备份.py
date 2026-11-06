
from datetime import datetime,timezone,timedelta
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import html,json,hashlib
from playwright.sync_api import sync_playwright

root=Path.cwd()
archive=root/'12-开发归档/2026-11-05-待办收口'
snapshot=sorted(archive.glob('链上只读-*.json'))[-1]
data=json.loads(snapshot.read_text(encoding='utf8'))
material=root/'01-参赛材料/交付物'
output=material/'演示备份'
output.mkdir(exist_ok=True)
offline=archive/'断网入口.html'
zone=timezone(timedelta(hours=8))
def local(stamp): return datetime.fromisoformat(stamp.replace('Z','+00:00')).astimezone(zone).strftime('%Y-%m-%d %H:%M:%S')
def fmt(n): return f'{n/100:.2f}'
mapping={420100:'武汉',440100:'广州'}
labels={'active':'保障中','expired':'已到期','paid':'已给付','settled':'已结清'}
rows=''.join(f"<tr><td>#{r['id']} · {mapping.get(r['region'],r['region'])} {r['hours']}h</td><td>{fmt(r['premiumFen'])}</td><td>{r['anchorMm']} mm</td><td>{local(r['end'])}</td><td>{labels.get(r['status'],r['status'])}</td><td>{fmt(r['payoutFen'])}</td></tr>" for r in data['policies'])
stale=sum(r['stale'] for r in data['regions'])
offline.write_text(f"""<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>雨证｜断网演示</title>
<style>body{{background:#0c151d;color:#e4eff5;font:16px/1.6 system-ui,sans-serif;margin:0}}main{{margin:5vh auto;padding:0 6vw;max-width:1100px}}a{{color:#8ae4d4}}small{{color:#b0c3cd}}table{{border-collapse:collapse;width:100%;text-align:left}}td,th{{padding:10px;border-bottom:1px solid #385060}}article{{border:1px solid #385060;border-radius:12px;padding:16px 22px;margin:20px 0;overflow:auto}}code{{overflow-wrap:anywhere}}</style>
<main><header><small>雨证 · V6-T1 · 现场备用</small><h1>断网演示</h1><p>固定快照，记录北京时间 <strong>{local(data['timestamp'])}</strong>。恢复网络后，可用核验台读最新状态。</p></header>
<article><h2>两张测试网演示保单</h2><p>链 ID {data['chainId']} · 区块 {data['block']:,} · 合约 <code>{data['address']}</code></p>
<table><thead><tr><th>保单</th><th>保费（模拟元）</th><th>累计锚值</th><th>到期（北京时间）</th><th>记录状态</th><th>给付（模拟元）</th></tr></thead><tbody>{rows}</tbody></table>
<p>池子 {fmt(data['poolFen'])} 模拟元，未结清敞口 {fmt(data['exposureFen'])} 模拟元。{stale}/{len(data['regions'])} 个区划的链上雨量超过 24 小时未更新。</p></article>
<article><h2>答辩备用资料</h2><ul><li><a href="答辩版.pdf">答辩版（33 页）</a></li><li><a href="精简版.pdf">精简版（16 页）</a></li><li><a href="研究定价.png">研究定价试算截图</a>（与链上现价分别展示）</li><li><a href="精算保单复核.docx">精算与保单复核 Word</a></li><li><a href="链上只读快照.json">逐项链上读数</a></li><li><a href="核验台.html">单文件核验台</a>（页面可离线打开，链上查询需恢复网络）</li></ul></article></main></html>""",encoding='utf8')
assets={
 '断网入口.html':offline,
 '答辩版.pdf':next((material/'PPT').glob('*答辩版-33页-2026-11-05.pdf')),
 '精简版.pdf':next((material/'PPT').glob('*精简版-16页-2026-11-05.pdf')),
 '研究定价.png':root/'12-开发归档/2026-11-05-模型复核/试算浏览器复核/pricing-1440.png',
 '精算保单复核.docx':next((material/'模型').glob('雨证-V6-T1-*.docx')),
 '链上只读快照.json':snapshot,
 '核验台.html':root/'06-核验台单文件/雨证-链上核验台.html',
}
dest=output/'雨证-V6-T1-断网演示备份-2026-11-05.zip'
with ZipFile(dest,'w',compression=ZIP_DEFLATED) as zip:
 for name,file in assets.items(): zip.write(file,name)
 zip.writestr('SHA256.txt','\n'.join(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {n}' for n,p in assets.items())+'\n')
with ZipFile(dest) as zip:
 assert zip.testzip() is None
 view=archive/'断网验收'
 for name in assets:
  view.mkdir(exist_ok=True); (view/name).write_bytes(zip.read(name))
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 page=browser.new_page(offline=True,viewport={'width':1440,'height':920})
 page.goto((view/'断网入口.html').resolve().as_uri())
 assert page.locator('tbody tr').count()==len(data['policies'])
 assert page.get_by_text('固定快照',exact=False).count()==1
 assert all((view/href).is_file() for href in page.locator('a').evaluate_all('(nodes)=>nodes.map(a=>a.getAttribute("href"))'))
 page.screenshot(path=str(archive/'断网演示截图.png'),full_page=True)
 browser.close()
print(dest,len(assets),'assets; offline browser verified')

