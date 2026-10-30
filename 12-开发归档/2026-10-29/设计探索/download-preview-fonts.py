"""Fetch small Google Fonts subsets for the actual preview copy, plus OFL licenses."""
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import urlencode
import re, json, subprocess

def fetch(url):
    return subprocess.check_output(['curl.exe', '--fail', '--silent', '--show-error', '--retry', '2', '--retry-all-errors', '--connect-timeout', '8', '--max-time', '20', url])

root = Path(r'C:\Users\lenovo\Desktop\汉客松\雨证·Rainproof\05-演示站点\design-preview')
text = ''.join(p.read_text(encoding='utf-8') for p in root.glob('*.html'))
used = ''.join(sorted(set(re.sub('<[^>]+>', '', text) + '风雨有温度清朗蓝证据观测站桌面手机方案预览立即探索比较A B C RainProof设计推荐专业可信0123456789/→↗←')))
headers = {'User-Agent': 'Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36'}
records = []
font_faces = []
for filename, family, alias in [('sans','Noto Sans SC:wght@400;500;600;700','Preview Sans'), ('serif','Noto Serif SC:wght@400;500;700','Preview Serif'), ('latin','Manrope:wght@400;500;600','Preview Latin')]:
    chars = used if filename != 'latin' else ''.join(chr(x) for x in range(32,127))
    css_url = 'https://fonts.googleapis.com/css2?' + urlencode({'family':family, 'display':'swap', 'text':chars})
    css = fetch(css_url).decode('utf-8')
    for block in re.findall(r'@font-face\s*\{([^}]+)\}', css):
        weight = re.search(r'font-weight:\s*(\d+)', block).group(1)
        font_url = re.search(r'src:\s*url\(([^)]+)\)', block).group(1).replace('fonts.gstatic.com', 'fonts.gstatic.cn')
        data = fetch(font_url)
        assert data[:4] in (b'wOF2', b'\x00\x01\x00\x00'), (filename, data[:4])
        extension, font_format = ('woff2', 'woff2') if data[:4] == b'wOF2' else ('ttf', 'truetype')
        asset_name = f'{filename}-{weight}.{extension}'
        (root / 'assets' / asset_name).write_bytes(data)
        font_faces.append(f'@font-face{{font-family:{alias};src:url(assets/{asset_name}) format("{font_format}");font-weight:{weight};font-display:swap}}')
        records.append({'family':family,'weight':weight,'url':font_url,'bytes':len(data),'license':'SIL Open Font License 1.1'})
stylesheet = root / 'concepts.css'
css_text = re.sub(r'@font-face\{[^}]+\}', '', stylesheet.read_text(encoding='utf-8'))
stylesheet.write_text('\n'.join(font_faces) + '\n' + css_text, encoding='utf-8')
(root / 'assets' / 'font-sources.json').write_text(json.dumps(records, indent=2), encoding='utf-8')
license_url = 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/OFL.txt'
license_text = fetch(license_url)
(root / 'assets' / 'OFL-Noto.txt').write_bytes(license_text)
license_url = 'https://raw.githubusercontent.com/google/fonts/main/ofl/manrope/OFL.txt'
(root / 'assets' / 'OFL-Manrope.txt').write_bytes(fetch(license_url))
license_url = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notoserifsc/OFL.txt'
(root / 'assets' / 'OFL-NotoSerif.txt').write_bytes(fetch(license_url))
print(json.dumps(records))
