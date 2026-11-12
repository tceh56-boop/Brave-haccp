#!/usr/bin/env python3
"""Перенос MonChef -> «ЦЕХ Стандарт»: меняются только видимое имя, цвета и логотипы.

Код, имена функций, листы таблицы, ключи свойств и имена папок на Google Диске
(где уже лежат данные клиента) НЕ меняются — иначе система потеряла бы данные.
Запуск: python3 tools/rebrand_monchef.py app brand   (из папки tsekh-standard)
Скрипт идемпотентен: повторный запуск ничего не портит.
"""
import base64, io, os, re, sys

APP, BRAND = sys.argv[1], sys.argv[2]
NAME = 'ЦЕХ Стандарт'

# строки, где старое имя — это имя папки/файла на Диске с уже накопленными данными
KEEP_LINE = re.compile(r"ts-legacy-name|MC_JF_DRIVE_ROOT_\s*=|MC_V8_ARCHIVE_ROOT\s*=|getFoldersByName\(|createFolder\(|makeCopy\(|MC_PACKAGE_FOLDER\s*=|'BACKUP Mon Chef")

COLORS = [
    ('#6e1423', '#a87b22'), ('#4a0c17', '#1d150d'), ('#36080f', '#0b0b0b'), ('#8c2233', '#8f6a1c'),
    ('#8a1c2e', '#8f6a1c'), ('#a8323f', '#c79a2e'), ('#b3893f', '#d4af37'), ('#f3e3e1', '#f7ecd2'),
    ('#f6e9e4', '#f3eadb'), ('#f1e1dc', '#efe4d0'), ('#f7f3f1', '#f7f1e6'), ('#2a1a1d', '#1b1610'),
    ('#7d6b6e', '#7a6c5c'), ('#8a6d73', '#7a6c5c'), ('#eadfdc', '#ece1cc'), ('#d9cfcc', '#ddd2bf'),
    ('#efe6e3', '#f1e8d8'), ('#f3ece9', '#f5eee2'), ('#5a474b', '#4f4336'),
]
RGBA = [('110,20,35', '168,123,34'), ('110, 20, 35', '168, 123, 34'), ('179,137,63', '212,175,55'), ('179, 137, 63', '212, 175, 55')]

FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">'
         '<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700;800&family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">')
PAGE_THEME = ('<style id="tsTheme">/* ЦЕХ Стандарт — фирменное оформление */'
              'body{font-family:Roboto,-apple-system,"Segoe UI",Arial,sans-serif}'
              'h1,h2,h3,.h1,.title{font-family:Montserrat,Roboto,Arial,sans-serif;letter-spacing:-.01em}'
              '.btn.pri,button.pri{background:linear-gradient(135deg,#d4af37,#a87b22)!important;border-color:#a87b22!important;color:#fff!important}'
              '</style>')


def b64(path):
    with open(os.path.join(BRAND, path), 'rb') as f:
        return 'data:image/png;base64,' + base64.b64encode(f.read()).decode()


def rename(text):
    out = []
    for line in text.split('\n'):
        if KEEP_LINE.search(line):
            out.append(line); continue
        line = line.replace('MON CHEF', NAME)
        line = re.sub(r"Mon Chef — ", NAME + ' — ', line)
        line = re.sub(r"(?<![A-Za-z_/'\"])MonChef(?![_A-Za-z0-9])", NAME, line)
        out.append(line)
    return '\n'.join(out)


def recolor(text):
    for a, b in COLORS:
        text = re.sub(re.escape(a), b, text, flags=re.I)
    for a, b in RGBA:
        text = text.replace(a, b)
    return text


def console(text):
    login, side = b64('logo_horizontal.png'), b64('logo_dark.png')
    mark, word = b64('mark_light_sq.png'), b64('word_light.png')
    # вход: горизонтальный логотип; меню: логотип для тёмного фона + девиз
    text = re.sub(r'(<div class="login-card">\s*<img src=")data:image/[a-z]+;base64,[^"]+(")', lambda m: m.group(1) + login + m.group(2), text, count=1)
    text = re.sub(r'<div class="brand"><img src="data:image/[a-z]+;base64,[^"]+" alt="">.*?</div></div>',
                  lambda m: '<div class="brand"><img src="' + side + '" alt="' + NAME + '"><small>Порядок. Контроль. Развитие.</small></div>', text, count=1, flags=re.S)
    text = re.sub(r"var MCX_MARK = 'data:image/[a-z]+;base64,[^']+';", lambda m: "var MCX_MARK = '" + mark + "';", text, count=1)
    text = re.sub(r"var MCX_WORD = 'data:image/[a-z]+;base64,[^']+';", lambda m: "var MCX_WORD = '" + word + "';", text, count=1)
    text = text.replace(NAME + ' restaurant', NAME)
    with open(os.path.join(os.path.dirname(__file__), 'console_theme.css'), encoding='utf-8') as f:
        css = f.read()
    if 'id="tsConsoleTheme"' not in text:
        text = text.replace('</head>', FONTS + '<style id="tsConsoleTheme">\n' + css + '\n</style>\n</head>', 1)
    return text


for fn in sorted(os.listdir(APP)):
    if not fn.endswith(('.gs', '.html')):
        continue
    p = os.path.join(APP, fn)
    with open(p, encoding='utf-8') as f:
        src = f.read()
    t = recolor(rename(src))
    if fn == 'Console.html':
        t = console(t)
    elif fn.endswith('.html') and '</head>' in t and 'id="tsTheme"' not in t and fn != 'ProductShelfLifeSeed.html':
        t = t.replace('</head>', FONTS + PAGE_THEME + '</head>', 1)
    if t != src:
        with open(p, 'w', encoding='utf-8') as f:
            f.write(t)
        print('обновлён', fn)
