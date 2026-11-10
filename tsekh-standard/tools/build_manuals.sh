#!/usr/bin/env bash
# Руководства пользователя по тарифам (формат руководства MonChef) → dist/manuals/*.pdf
# Нужны: python3 + pymupdf + pillow + numpy, tesseract-ocr (rus), node + playwright (Chromium).
set -euo pipefail
cd "$(dirname "$0")/.."
W=$(mktemp -d)
python3 - "$W" <<'PY'
import sys, glob, pymupdf
W = sys.argv[1]; doc = pymupdf.open(glob.glob('docs/ДОК_9_*.pdf')[0]); seen = set()
import os; os.makedirs(W + '/src', exist_ok=True)
for i, p in enumerate(doc):
    for img in p.get_image_info(xrefs=True):
        x = img['xref']
        if x in seen or img['width'] < 200: continue
        seen.add(x); pix = pymupdf.Pixmap(doc, x)
        if pix.alpha: pix = pymupdf.Pixmap(pix, 0)
        if pix.n > 3: pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
        pix.save(f'{W}/src/p{i+1:03d}_x{x}.png')
PY
python3 tools/manual_images.py "$W/src" "$W/img" brand/logo_dark.png
for pl in basic basic_pro pro pro_max; do node tools/manual_shots.js "$PWD/app/Console.html" "$W/shots/$pl" $pl; done
mkdir -p dist/manuals && rm -f dist/manuals/*.pdf
python3 tools/build_manuals.py docs/ДОК_9_*.pdf "$W/img" "$W/shots" dist/manuals
rm -rf "$W"
