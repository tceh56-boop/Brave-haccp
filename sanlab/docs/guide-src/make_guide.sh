#!/bin/bash
set -e
S=/tmp/claude-0/-home-user-Brave-haccp/a1da4181-a192-50b2-a0ed-f522d9a6be0b/scratchpad
G=$S/guide; mkdir -p $G/img
python3 -I - <<PY
from PIL import Image; import glob, os
for f in glob.glob('$S/shots2/*.png'):
    im = Image.open(f).convert('RGB'); w, h = im.size
    mx = 1700 if w > 1200 else 900
    if w > mx: im = im.resize((mx, int(h * mx / w)), Image.LANCZOS)
    im.save('$G/img/' + os.path.basename(f)[:-4] + '.jpg', quality=84, optimize=True)
PY
cd $S/build
python3 -I guide.py img $G/guide.html
NODE_PATH=/opt/node22/lib/node_modules node render.js $G/guide.html $G/pass1.pdf
python3 -I - <<PY
import json, subprocess
secs = json.load(open('$G/guide.html.sections.json', encoding='utf-8'))
n = int([l for l in subprocess.run(['pdfinfo', '$G/pass1.pdf'], capture_output=True, text=True).stdout.splitlines() if l.startswith('Pages')][0].split()[-1])
texts = [subprocess.run(['pdftotext', '-f', str(i), '-l', str(i), '-layout', '$G/pass1.pdf', '-'], capture_output=True, text=True).stdout for i in range(1, n + 1)]
pages = {}
for num, title in secs:
    head = (num + '. ' + title) if num.isdigit() else title
    key = ' '.join(head.split()[:4])
    for i, t in enumerate(texts, 1):
        first = ' '.join(' '.join(t.split('\n')[:4]).split())
        if first.startswith(key) or (' '.join(t.split()[:len(key.split())]) == key):
            pages[num] = i; break
print('pages', pages, 'total', n)
json.dump(pages, open('$G/pages.json', 'w'))
PY
python3 -I guide.py img $G/guide.html $G/pages.json
NODE_PATH=/opt/node22/lib/node_modules node render.js $G/guide.html $G/SanLab_Instrukciya_dlya_personala.pdf
pdfinfo $G/SanLab_Instrukciya_dlya_personala.pdf | grep -E "Pages|File size"
