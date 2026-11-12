#!/usr/bin/env python3
"""Встроить экраны ЦЕХ Стандарт (tools/ts_console.js) в конец Console.html. Повторный запуск заменяет блок."""
import os, re, sys
app = sys.argv[1] if len(sys.argv) > 1 else 'app'
p = os.path.join(app, 'Console.html')
js = open(os.path.join(os.path.dirname(__file__), 'ts_console.js'), encoding='utf-8').read()
s = open(p, encoding='utf-8').read()
block = '<script id="tsClient">\n' + js + '\n</script>\n'
if '<script id="tsClient">' in s:
    s = re.sub(r'<script id="tsClient">.*?</script>\n', lambda m: block, s, count=1, flags=re.S)
else:
    i = s.rfind('</body>')
    s = s[:i] + block + s[i:]
open(p, 'w', encoding='utf-8').write(s)
print('Console.html: экраны ЦЕХ Стандарт встроены')
