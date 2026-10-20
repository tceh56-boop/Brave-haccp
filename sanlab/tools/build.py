#!/usr/bin/env python3
"""San.Lab build: GAS project bundle + standalone demo page (same core, same UI)."""
import json, os, re, shutil
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src'); DIST = os.path.join(ROOT, 'dist')
CORE = [f for f in json.load(open(os.path.join(ROOT, 'tests', 'order.json'))) if f.startswith('core/')]
GAS = ['gas/Code.gs', 'gas/SheetsStore.gs', 'gas/GoogleIntegrations.gs', 'gas/Setup.gs']
UI = ['ui/Index.html', 'ui/Styles.html', 'ui/App.html', 'ui/PagesHome.html', 'ui/PagesVisits.html', 'ui/PagesWork.html', 'ui/PagesBiz.html']
read = lambda p: open(os.path.join(SRC, p), encoding='utf-8').read()

shutil.rmtree(DIST, ignore_errors=True)
gas = os.path.join(DIST, 'gas'); os.makedirs(gas)
order = []
for f in CORE + GAS + UI:
    shutil.copy(os.path.join(SRC, f), os.path.join(gas, os.path.basename(f))); order.append(os.path.basename(f))
manifest = {
    "timeZone": "Asia/Yekaterinburg", "runtimeVersion": "V8", "exceptionLogging": "STACKDRIVER",
    "webapp": {"executeAs": "USER_DEPLOYING", "access": "DOMAIN"},
    "oauthScopes": [
        "https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/script.send_mail",
        "https://www.googleapis.com/auth/script.scriptapp", "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/script.container.ui"]
}
json.dump(manifest, open(os.path.join(gas, 'appsscript.json'), 'w'), indent=2)
json.dump({"scriptId": "ВСТАВЬТЕ_ID_ПРОЕКТА", "rootDir": ".", "filePushOrder": [o for o in order if o.endswith('.gs')]}, open(os.path.join(gas, '.clasp.json'), 'w'), ensure_ascii=False, indent=2)

def strip_script(h):
    return re.sub(r'^\s*<script>\s*|\s*</script>\s*$', '', h)
core_js = '\n'.join('/* ==== %s ==== */\n%s' % (f, read(f)) for f in CORE)
ui_js = '\n'.join(strip_script(read(f)) for f in UI[2:])
css = read('ui/Styles.html')
page = ('<title>San.Lab</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n'
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=PT+Serif:wght@700&display=swap">\n'
        + css + '\n<div id="app"></div>\n<script>\n' + core_js + '\n' + read('demo/MemoryPlatform.js') + '\n</script>\n<script>\n' + ui_js + '\n' + read('demo/DemoBoot.js') + '\n</script>\n')
os.makedirs(os.path.join(DIST, 'demo'))
open(os.path.join(DIST, 'demo', 'sanlab-demo.html'), 'w', encoding='utf-8').write(page)
# full standalone html (for local opening)
open(os.path.join(DIST, 'demo', 'sanlab-demo-standalone.html'), 'w', encoding='utf-8').write('<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' + page.replace('\n<div id="app">', '</head><body><div id="app">') + '</body></html>')
print('GAS files:', len(order) + 1, '| demo size: %.0f KB' % (len(page.encode()) / 1024))
