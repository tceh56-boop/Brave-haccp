#!/usr/bin/env python3
"""Снимки экранов из руководства MonChef → оформление ЦЕХ Стандарт.

1. Перекраска: бордовые тона прежнего оформления → тёмный (меню, шапка, кнопки) и золото (акценты).
   Оранжевые метки-номера и красные/зелёные статусы не трогаются.
2. Название: слова «MON CHEF» находятся распознаванием текста (tesseract) и заменяются на «ЦЕХ Стандарт»;
   логотип в шапке бокового меню заменяется логотипом ЦЕХ Стандарт для тёмного фона.
Запуск: python3 tools/manual_images.py <папка снимков> <папка результата> <brand/logo_dark.png>
"""
import os, subprocess, sys, csv, io
import numpy as np
from PIL import Image, ImageDraw, ImageFont

SRC, DST, LOGO = sys.argv[1], sys.argv[2], sys.argv[3]
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
os.makedirs(DST, exist_ok=True)


def recolor(a):
    f = a.astype(np.float32) / 255.0
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    mx, mn = f.max(-1), f.min(-1); d = mx - mn; L = (mx + mn) / 2
    S = np.where(d == 0, 0, d / (1 - np.abs(2 * L - 1) + 1e-6))
    h = np.zeros_like(L)
    m = d > 0
    rm = m & (mx == r); gm = m & (mx == g) & ~rm; bm = m & ~rm & ~gm
    h[rm] = ((g - b)[rm] / d[rm]) % 6; h[gm] = (b - r)[gm] / d[gm] + 2; h[bm] = (r - g)[bm] / d[bm] + 4
    H = h * 60
    wine = ((H >= 330) | (H <= 1.0)) & (S > 0.18) & (L < 0.93) & ~((H <= 1.0) & (L > 0.38))
    # тёмные бордовые (меню, шапка, кнопки, заголовки) → почти чёрный с тёплым оттенком
    dark = wine & (L < 0.34)
    light = wine & ~dark
    def hsl(hh, ss, ll):
        c = (1 - np.abs(2 * ll - 1)) * ss; x = c * (1 - np.abs((hh / 60) % 2 - 1)); mm = ll - c / 2
        # hh — константа в диапазоне 0..60 (тёплые тона): r=c, g=x, b=0
        return np.stack([c + mm, x + mm, mm], -1)
    out = f.copy()
    if dark.any():
        ll = L[dark] * 0.55 + 0.035
        out[dark] = hsl(32.0, 0.32, ll)
    if light.any():
        ll = np.clip(L[light] * 0.92 + 0.06, 0, 0.97)
        ss = np.clip(S[light] * 0.95, 0, 0.85)
        c = (1 - np.abs(2 * ll - 1)) * ss; x = c * (1 - abs((42 / 60) % 2 - 1)); mm = ll - c / 2
        out[light] = np.stack([c + mm, x + mm, mm], -1)
    return (np.clip(out, 0, 1) * 255).astype(np.uint8)


def ocr_words(img):
    buf = io.BytesIO(); img.save(buf, 'PNG')
    r = subprocess.run(['tesseract', '-', '-', '-l', 'rus+eng', '--psm', '11', 'tsv'], input=buf.getvalue(), capture_output=True)
    rows = list(csv.DictReader(io.StringIO(r.stdout.decode('utf-8', 'ignore')), delimiter='\t', quoting=csv.QUOTE_NONE))
    out = []
    for w in rows:
        t = (w.get('text') or '').strip()
        if t and w.get('conf') not in (None, '', '-1'):
            out.append((t, int(w['left']), int(w['top']), int(w['width']), int(w['height'])))
    return out


HOMO = str.maketrans('МОНСЕАРКТВХ0', 'MOHCEAPKTBXO')
def norm(t):
    return t.upper().translate(HOMO).strip('‹<«»().,:;·—-')
def is_mon(t): return t in ('MON', 'MOH', 'MOM', 'HON')
def is_chef(t): return t in ('CHEF', 'CHEP', 'CHEE', 'CHEF.', 'CНEF', 'GHEF', 'CHER')
def brand_boxes(words):
    """Пары MON + CHEF (в т.ч. разрядкой и кириллицей-двойником) → общий прямоугольник."""
    boxes = []
    up = [(norm(t), x, y, w, h) for t, x, y, w, h in words]
    for t, x, y, w, h in up:
        if t in ('MONCHEF', 'MOHCHEF'):
            boxes.append([x, y, x + w, y + h])
        if is_mon(t):
            for t2, x2, y2, w2, h2 in up:
                if is_chef(t2) and 0 < x2 - (x + w) < h * 3 and abs(y2 - y) < h:
                    boxes.append([x, min(y, y2), x2 + w2, max(y + h, y2 + h2)])
    return boxes


def sidebar_width(a):
    """Ширина тёмного бокового меню (0 — меню нет)."""
    H, W = a.shape[:2]
    if W < 1000: return 0
    lum = a[..., :3].astype(int).sum(-1)
    if (lum[:, 12] < 270).mean() < 0.85: return 0
    frac = (lum < 300).mean(0)
    x = 12
    while x < W * 0.3 and frac[x] > 0.6: x += 1
    return x if 150 < x < W * 0.3 else 0


def bg_and_fg(a, box):
    x0, y0, x1, y1 = box
    pad = 3
    ring = np.concatenate([a[max(0, y0 - pad):y0, x0:x1].reshape(-1, 3), a[y1:y1 + pad, x0:x1].reshape(-1, 3),
                           a[y0:y1, max(0, x0 - pad):x0].reshape(-1, 3), a[y0:y1, x1:x1 + pad].reshape(-1, 3)])
    bg = np.median(ring, 0) if len(ring) else np.array([255, 255, 255])
    inner = a[y0:y1, x0:x1].reshape(-1, 3).astype(int)
    dist = np.abs(inner - bg).sum(1)
    fg = inner[dist.argmax()] if len(inner) else np.array([0, 0, 0])
    return tuple(int(v) for v in bg), tuple(int(v) for v in fg)


def draw_name(im, box, bg, fg):
    x0, y0, x1, y1 = box
    dr = ImageDraw.Draw(im)
    dr.rectangle([x0 - 1, y0 - 1, x1 + 1, y1 + 1], fill=bg)
    h = y1 - y0; text = 'ЦЕХ Стандарт'
    size = max(8, int(h * 1.05))
    font = ImageFont.truetype(FONT, size)
    maxw = (x1 - x0) * 1.35
    while font.getlength(text) > maxw and size > 7:
        size -= 1; font = ImageFont.truetype(FONT, size)
    tw = font.getlength(text)
    if tw > x1 - x0:   # шире исходного — расчищаем место справа
        dr.rectangle([x1, y0 - 1, x0 + tw + 2, y1 + 1], fill=bg)
    bb = font.getbbox(text)
    dr.text((x0, y0 + (h - (bb[3] - bb[1])) / 2 - bb[1]), text, font=font, fill=fg)


def sidebar_brand(im, a, side):
    """Логотип в шапке бокового меню (меню закреплено — шапка всегда вверху снимка)."""
    W = a.shape[1]
    region = [0, 0, side - 1, int(W * 0.062)]
    color = tuple(int(v) for v in np.median(a[region[1]:region[3], 2:6].reshape(-1, 3), 0))
    ImageDraw.Draw(im).rectangle(region, fill=color)
    logo = Image.open(LOGO).convert('RGBA')
    tw, th = int((region[2] - region[0]) * 0.86), int((region[3] - region[1]) * 0.82)
    logo.thumbnail((tw, th), Image.LANCZOS)
    im.paste(logo, (int((region[2] - logo.width) / 2), int((region[3] - logo.height) / 2)), logo)


report = []
for fn in sorted(os.listdir(SRC)):
    if not fn.endswith('.png'): continue
    src = Image.open(os.path.join(SRC, fn)).convert('RGB')
    a0 = np.asarray(src)
    words = ocr_words(src)
    a = recolor(a0)
    im = Image.fromarray(a)
    boxes = brand_boxes(words)
    side = sidebar_width(a)
    if side:
        sidebar_brand(im, a, side)
        boxes = [b for b in boxes if not (b[0] < side and b[1] < a.shape[1] * 0.065)]
        boxes.append('side')
    for bx in boxes:
        if bx == 'side': continue
        bx = [int(v) for v in bx]
        bg, fg = bg_and_fg(a, bx)
        draw_name(im, bx, bg, fg)
    im.save(os.path.join(DST, fn.replace('.png', '.jpg')), quality=88, optimize=True)
    report.append((fn, len(boxes)))
print('снимков:', len(report), '· найдено и заменено надписей MON CHEF:', sum(n for _, n in report))
for fn, n in report:
    if n: print('  ', fn, n)
