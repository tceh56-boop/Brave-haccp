#!/usr/bin/env python3
# Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
"""Markdown → PDF в оформлении MON CHEF (Chromium через tools/html2pdf.js).
Запуск: python3 monchef/tools/md2pdf.py вход.md выход.pdf   (нужно: pip install markdown; node + playwright)"""
import sys, os, base64, subprocess, tempfile, markdown
src, out = sys.argv[1], sys.argv[2]
here = os.path.dirname(os.path.abspath(__file__))
body = markdown.markdown(open(src, encoding='utf-8').read(), extensions=['tables', 'fenced_code', 'sane_lists'])
logo = os.path.join(here, '..', 'app', 'monchef_wordmark.png')
img = '<img class="logo" src="data:image/png;base64,' + base64.b64encode(open(logo, 'rb').read()).decode() + '">' if os.path.exists(logo) else ''
css = """@page{size:A4;margin:16mm 14mm 18mm}body{font:10.5pt/1.5 'Roboto','DejaVu Sans','Arial',sans-serif;color:#1d150d;background:#fff}
.logo{height:34px;margin-bottom:10px}h1{font-size:19pt;color:#1d150d;border-bottom:3px solid #D4AF37;padding-bottom:6px}
h2{font-size:14pt;color:#1d150d;margin-top:20px;border-left:4px solid #D4AF37;padding-left:8px;page-break-after:avoid}
h3{font-size:11.5pt;page-break-after:avoid}table{border-collapse:collapse;width:100%;margin:8px 0;font-size:9.5pt}
th{background:#1d150d;color:#D4AF37;text-align:left}th,td{border:1px solid #d9cfb8;padding:4px 6px;vertical-align:top}tr{page-break-inside:avoid}
code{background:#f6f0e1;padding:1px 4px;border-radius:3px;font-size:9pt;word-break:break-all}pre{background:#f6f0e1;padding:8px;border-radius:6px;white-space:pre-wrap}
blockquote{margin:10px 0;padding:8px 12px;background:#fbf5e4;border-left:4px solid #D4AF37}a{color:#8a6d12}li{margin:2px 0}"""
html = '<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>' + css + '</style></head><body>' + img + body + '</body></html>'
with tempfile.NamedTemporaryFile('w', suffix='.html', delete=False, encoding='utf-8') as f: f.write(html); tmp = f.name
subprocess.run(['node', os.path.join(here, 'html2pdf.js'), tmp, out], check=True); os.unlink(tmp)
print('PDF:', out)
