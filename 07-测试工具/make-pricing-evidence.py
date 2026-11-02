"""Package an explicit allowlist of public weather inputs and research sources. Never .env or keys."""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT=Path(__file__).resolve().parent.parent
model=json.loads((ROOT/'10-金融与定价/pricing-next/model.json').read_text(encoding='utf-8'))
files={r['source']['file'] for r in model['regions']}
files.update([
    '04-脚本/v5-regions.json','10-金融与定价/pricing-next/core.js',
    '10-金融与定价/pricing-next/config.json','10-金融与定价/pricing-next/build-model.js',
    '10-金融与定价/pricing-next/summarize.js','10-金融与定价/pricing-next/fetch-history.js',
    '10-金融与定价/pricing-next/model.json','10-金融与定价/pricing-next/summary.json',
    '10-金融与定价/pricing-next/方法与复算.md','07-测试工具/check-pricing-next.js',
    '05-演示站点/pricing-next-data.js','05-演示站点/pricing-next-core.js'
])
extra=ROOT/'10-金融与定价/pricing-next/extra-regions.json'
if extra.exists():files.add(extra.relative_to(ROOT).as_posix())
for r in model['regions']:
    meta=ROOT/'10-金融与定价/pricing-next/cache'/f"{r['code']}.meta.json"
    if meta.exists():files.add(meta.relative_to(ROOT).as_posix())
output=ROOT/'01-参赛材料/交付物/模型/差异化定价-完整复核包-2026-11-02.zip'
output.parent.mkdir(parents=True,exist_ok=True)
manifest={'modelId':model['modelId'],'files':{}}
with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
    for relative in sorted(files):
        full=(ROOT/relative).resolve()
        if not full.is_relative_to(ROOT.resolve()) or full.name.startswith('.env'):
            raise ValueError('File outside explicit public evidence boundary')
        data=full.read_bytes()
        manifest['files'][relative]={'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)}
        item=zipfile.ZipInfo(relative,date_time=(2026,11,2,0,0,0));item.compress_type=zipfile.ZIP_DEFLATED
        archive.writestr(item,data)
    archive.writestr('pricing-input-manifest.json',json.dumps(manifest,ensure_ascii=False,indent=2))
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
print(json.dumps({'archive':str(output),'bytes':output.stat().st_size,'files':len(files),'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'modelId':model['modelId']},ensure_ascii=False))
