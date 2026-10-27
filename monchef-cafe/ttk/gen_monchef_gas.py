# -*- coding: utf-8 -*-
"""Генератор app/MonChef_ZCafe_TtkTree.gs из ttk_tree.json (вывод build_ttk_tree.py): python3 gen_monchef_gas.py <ttk_tree.json>"""
import json, os, re, sys

src = json.load(open(sys.argv[1], encoding='utf-8'))


def rng(t):
    m = re.search(r'([+−-]?\d+)\s*…\s*([+−-]?\d+)\s*°', t)
    if m: return float(m.group(1).replace('−', '-')), float(m.group(2).replace('−', '-'))
    m = re.search(r'не выше\s*([+−-]?\d+)\s*°', t)
    if m: return None, float(m.group(1).replace('−', '-'))
    return None, None


for f in src['folders']:
    for r in f['regimes']:
        r['min'], r['max'] = rng(r['temp'])
data = json.dumps(src, ensure_ascii=False, separators=(',', ':'))
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'MonChef_ZCafe_TtkTree.gs')
tpl = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'MonChef_ZCafe_TtkTree.gs.tpl'), encoding='utf-8').read()
open(out, 'w', encoding='utf-8').write(tpl.replace('/*@@TREE@@*/{}', data))
print('записан', os.path.normpath(out), len(data), 'символов данных')
