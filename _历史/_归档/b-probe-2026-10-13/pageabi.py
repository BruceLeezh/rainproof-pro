import re, json, sys

s = open(r'C:\Users\lenovo\Desktop\汉客松\rainproof\05-演示站点\index.html', encoding='utf-8').read()
i = s.index('const ABI')
j = s.index('];', i)
lit = s[s.index('[', i):j + 1]
lit = re.sub(r'([{,])\s*([A-Za-z_][A-Za-z0-9_]*)\s*:', r'\1"\2":', lit)
abi = json.loads(lit)
print('page ABI total entries:', len(abi))
want = ('policies', 'judgements', 'feedJudgements', 'premiumOf', 'thresholdOf', 'entryThresholdOf')
for e in abi:
    if e.get('type') == 'function' and e.get('name') in want:
        print(e['name'], '| in', [x['type'] for x in e['inputs']],
              '| out', len(e['outputs']), [o['name'] for o in e['outputs']])
