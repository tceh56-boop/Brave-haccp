#!/usr/bin/env python3
"""
Накладывает VINOVNIK на сборку MON CHEF в папке app/ (повторный запуск ничего не дублирует).

  python3 tools/apply_vinovnik.py [app] [папка с логотипом]

1. Название и логотип: заголовок окна, экран входа, боковая панель, заставка, имя отправителя писем.
   Оформление (цвета, шрифты, раскладка) не меняется.
2. Главное окно (Console.html): раздел «Зал» и его значок, стили и экраны зала (ui/vn_views.css, ui/vn_views.js).
3. Code.gs: страница меню для гостей (?menu=1) — до проверки входа; заголовок главного окна VINOVNIK.
4. Шлюз (zzz_MonChef_Gate.gs): функции зала (MC_VN_GATE_) и публичная заявка гостя (MC_VN_PUBLIC_).
5. Vinovnik_Brand.gs: логотип для страницы гостя (VN_LOGO_).
"""
import base64, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(ROOT, 'app')
BRAND = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else os.path.join(ROOT, 'brand')
UI = os.path.join(ROOT, 'ui')


def rd(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


def wr(p, s):
    with open(p, 'w', encoding='utf-8', newline='\n') as f:
        f.write(s)


def uri(name, mime):
    with open(os.path.join(BRAND, name), 'rb') as f:
        return 'data:%s;base64,%s' % (mime, base64.b64encode(f.read()).decode())


def once(s, marker, old, new, what):
    if marker in s:
        return s
    if old not in s:
        sys.exit('не найдено место для: ' + what)
    return s.replace(old, new, 1)


MARK = uri('mark.webp', 'image/webp')
WORD = uri('word.webp', 'image/webp')
ICON = uri('icon.webp', 'image/webp')
LOGIN = uri('mark.jpg', 'image/jpeg')

# ---------------------------------------------------------------- Console.html
p = os.path.join(APP, 'Console.html')
s = rd(p)
s = s.replace('<title>MON CHEF</title>', '<title>VINOVNIK</title>', 1)
s, n1 = re.subn(r'(<div class="login-card">\s*<img src=")data:[^"]+(")', lambda m: m.group(1) + LOGIN + m.group(2), s, count=1)
s, n2 = re.subn(r'(<div class="brand"><img src=")data:[^"]+(")', lambda m: m.group(1) + ICON + m.group(2), s, count=1)
s = re.sub(r'(<div class="login-card">\s*<img src="[^"]+") alt="[^"]*"', r'\1 alt="VINOVNIK"', s, count=1)
s = re.sub(r"var MCX_MARK = '[^']*';", lambda m: "var MCX_MARK = '" + MARK + "';", s, count=1)
s = re.sub(r"var MCX_WORD = '[^']*';", lambda m: "var MCX_WORD = '" + WORD + "';", s, count=1)
s = s.replace('alt="MON CHEF restaurant"', 'alt="VINOVNIK NOVITSKY"').replace('<img class="mcx-full" alt="MON CHEF"', '<img class="mcx-full" alt="VINOVNIK"')
s = s.replace('<b>MON CHEF</b><small>restaurant · управление кухней</small>', '<b>VINOVNIK</b><small>NOVITSKY · ресторан</small>')
s = s.replace('<div class="h">MON CHEF — проверка</div>', '<div class="h">VINOVNIK — проверка</div>')
# раздел «Зал» — после «Главной»; значок — вилка и нож
s = once(s, "['hall','Зал']", "var SECTIONS = [['home','Главная'],", "var SECTIONS = [['home','Главная'],['hall','Зал'],", 'раздел Зал')
s = once(s, "  hall:'<path", "var ICONS = {\n", "var ICONS = {\n  hall:'<path d=\"M7 3v7a2 2 0 0 0 4 0V3M9 10v11M17 3c-1.8 1.4-2.6 3.5-2.6 6.3V13H17v8\"/>',\n", 'значок Зал')
# стили и экраны зала
css, js = rd(os.path.join(UI, 'vn_views.css')), rd(os.path.join(UI, 'vn_views.js'))
mark_css = '/* ================= VINOVNIK — зал, кухня, бар'
if mark_css in s:
    s = re.sub(r'\n  /\* ================= VINOVNIK — зал, кухня, бар.*?(?=\n  /\* ================= ЗАСТАВКА ВХОДА)', lambda m: css.rstrip('\n'), s, count=1, flags=re.S)
else:
    s = once(s, mark_css, '\n  /* ================= ЗАСТАВКА ВХОДА', css.rstrip('\n') + '\n  /* ================= ЗАСТАВКА ВХОДА', 'стили зала')
mark_js = '/* ==========================================================================\n   VINOVNIK — зал:'
end = '\n</script>\n<div id="mcxScreen">'
if mark_js in s:
    a = s.index('\n' + mark_js)
    s = s[:a] + js.rstrip('\n') + s[s.index(end, a):]
else:
    s = once(s, mark_js, end, js.rstrip('\n') + end, 'экраны зала')
wr(p, s)

# ---------------------------------------------------------------- Code.gs
p = os.path.join(APP, 'Code.gs')
s = rd(p)
s = once(s, '_vnGuestPage_', "  if (params.verify) return _mcVerifyPage_(params.verify);\n",
         "  if (params.verify) return _mcVerifyPage_(params.verify);\n"
         "  // VINOVNIK: электронное меню для гостей по QR-коду — публичная страница без входа (Vinovnik_Guest.gs)\n"
         "  if (params.menu && typeof _vnGuestPage_ === 'function') return _vnGuestPage_(params);\n", 'меню гостя в doGet')
s = s.replace("if (String(out.getTitle()) === 'MON CHEF') {", "if (/^(MON CHEF|VINOVNIK)$/.test(String(out.getTitle()))) {", 1)
s = s.replace("   .setTitle('MON CHEF')", "   .setTitle('VINOVNIK')", 1)
wr(p, s)

# ---------------------------------------------------------------- письма смены: имя отправителя
p = os.path.join(APP, 'MonChef_V89_ShiftEmail.gs')
s = rd(p)
s = s.replace("name: 'MON CHEF', attachments", "name: 'VINOVNIK', attachments")
wr(p, s)

# ---------------------------------------------------------------- шлюз
p = os.path.join(APP, 'zzz_MonChef_Gate.gs')
s = rd(p)
hook = ("\n// VINOVNIK: функции зала (Vinovnik_*.gs, список MC_VN_GATE_) — в те же списки шлюза: право (MC_GATE_NEED_),\n"
        "// вызов из интерфейса, запись (защита от двойного нажатия), запрет техническому входу; заявка гостя с QR-меню — публичная.\n"
        "if (typeof MC_VN_GATE_ !== 'undefined' && MC_VN_GATE_) Object.keys(MC_VN_GATE_).forEach(function (n) {\n"
        "  var c = MC_VN_GATE_[n], add = function (a) { if (a.indexOf(n) < 0) a.push(n); };\n"
        "  MC_GATE_NEED_[n] = c[0]; MC_GATE_PERM_[n] = c[0]; add(MC_GATE_CLIENT_);\n"
        "  if (c[1]) add(MC_GATE_MUT_);\n"
        "  if (c[2]) add(MC_GATE_DEVNO_);\n"
        "});\n"
        "if (typeof MC_VN_PUBLIC_ !== 'undefined') MC_VN_PUBLIC_.forEach(function (n) { if (MC_GATE_PUBLIC_.indexOf(n) < 0) MC_GATE_PUBLIC_.push(n); });\n")
s = once(s, 'MC_VN_GATE_', "var _MC_GATE_DEPTH = 0,", hook.lstrip('\n') + "var _MC_GATE_DEPTH = 0,", 'шлюз')
wr(p, s)

# ---------------------------------------------------------------- логотип для страницы гостя
wr(os.path.join(APP, 'Vinovnik_Brand.gs'),
   "/** VINOVNIK — логотип (файл сгенерирован tools/apply_vinovnik.py из brand/mark.webp). */\n"
   "var VN_LOGO_ = '" + MARK + "';\n")

# ---------------------------------------------------------------- манифест сборки
p = os.path.join(APP, 'BUILD_MANIFEST.json')
s = rd(p)
s = once(s, '"VINOVNIK', '"product": "MON CHEF",', '"product": "VINOVNIK (MON CHEF inside)",', 'манифест')
s = once(s, 'VINOVNIK hall', '  ],\n  "validation"',
         ',\n    "VINOVNIK hall: tables and bookings (guest QR requests, conflicts per table, seating opens the table order), waiter notepad (qty, course, weight, seat, comment; courses fired on command), kitchen and bar queues, close bill -> MON CHEF sale per line (J36 + V71 stock write-off), stop/go list (stop, limit decremented by orders, go from V88 expiry), guest e-menu by QR (Instagram-style feed and Reels with photo/video), My shift split into hall / kitchen / bar"\n  ],\n  "validation"', 'манифест: модуль')
wr(p, s)
print('VINOVNIK наложен на', APP, '· логотип на входе', n1, '· в панели', n2)
