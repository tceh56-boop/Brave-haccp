#!/usr/bin/env python3
"""Markdown → PDF в оформлении ЦЕХ Стандарт (Chromium через tools/html2pdf.js).
Запуск: python3 tools/md2pdf.py docs/ДОК_10_Установка_и_запуск.md docs/ДОК_10_Установка_и_запуск.pdf
Нужно: pip install markdown; node + playwright."""
import sys, os, base64, subprocess, tempfile, markdown
src, out = sys.argv[1], sys.argv[2]
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
body = markdown.markdown(open(src, encoding='utf-8').read(), extensions=['tables', 'fenced_code', 'sane_lists'])
logo = os.path.join(root, 'brand', 'logo_horizontal.png')
img = '<img class="logo" src="data:image/png;base64,' + base64.b64encode(open(logo, 'rb').read()).decode() + '">' if os.path.exists(logo) else ''
css = """@page{size:A4;margin:16mm 14mm 18mm}body{font:10.5pt/1.5 'Roboto','Arial',sans-serif;color:#1d150d;background:#fff}
.logo{height:34px;margin-bottom:10px}h1{font:700 20pt 'Montserrat','Arial',sans-serif;color:#1d150d;border-bottom:3px solid #D4AF37;padding-bottom:6px}
h2{font:700 14pt 'Montserrat','Arial',sans-serif;color:#1d150d;margin-top:20px;border-left:4px solid #D4AF37;padding-left:8px;page-break-after:avoid}
h3{font:600 11.5pt 'Montserrat','Arial',sans-serif;page-break-after:avoid}table{border-collapse:collapse;width:100%;margin:8px 0;font-size:9.5pt;page-break-inside:auto}
th{background:#1d150d;color:#D4AF37;text-align:left}th,td{border:1px solid #d9cfb8;padding:4px 6px;vertical-align:top}tr{page-break-inside:avoid}
code{background:#f6f0e1;padding:1px 4px;border-radius:3px;font-size:9pt;word-break:break-all}pre{background:#f6f0e1;padding:8px;border-radius:6px;white-space:pre-wrap}
blockquote{margin:10px 0;padding:8px 12px;background:#fbf5e4;border-left:4px solid #D4AF37}a{color:#8a6d12}"""
html = '<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>' + css + '</style></head><body>' + img + body + '</body></html>'
with tempfile.NamedTemporaryFile('w', suffix='.html', delete=False, encoding='utf-8') as f: f.write(html); tmp = f.name
subprocess.run(['node', os.path.join(root, 'tools', 'html2pdf.js'), tmp, out], check=True); os.unlink(tmp)
print('PDF:', out)
