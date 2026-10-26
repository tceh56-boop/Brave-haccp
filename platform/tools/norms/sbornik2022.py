"""
Нормы отходов и потерь из «Сборника рецептур блюд и кулинарных изделий для обучающихся образовательных организаций»
(2-е изд., М.: Научный центр здоровья детей, 2022, 698 с.; под ред. Г.Г. Онищенко, В.А. Тутельяна).

Читает текст PDF (pdftotext -layout) и собирает data/reference/sbornik2022.json:
  - table   — таблица «Расчет расхода сырья и выхода полуфабрикатов» (с. 669–671): отходы и потери при холодной
              обработке, % к массе брутто, дословно из таблицы; сезоны — по формулировкам таблицы;
  - cold    — холодная обработка по рецептурам: (брутто − нетто) / брутто по строке рецептуры, с номерами рецептур;
  - thermal — тепловая обработка по рецептурам: строка «Масса отварной говядины …» против нетто сырья в той же
              рецептуре: (нетто − масса) / нетто; отрицательное значение — привар.
Тексты рецептур в справочник не переносятся — только числа и номера рецептур (ссылка для основания нормы).

Запуск: pdftotext -layout Sbornik_retseptur_2022g.pdf book.txt && python3 -I tools/norms/sbornik2022.py book.txt <sha256 PDF>
"""
import json, re, sys
from collections import defaultdict

SRC = {
    'title': 'Сборник рецептур блюд и кулинарных изделий для обучающихся образовательных организаций. Сборник технических нормативов',
    'short': 'Сборник рецептур для обучающихся образовательных организаций (2022)',
    'edition': '2-е изд., испр. и доп.', 'publisher': 'М.: Научный центр здоровья детей', 'year': 2022, 'pages': 698,
    'editors': 'под ред. Г.Г. Онищенко, В.А. Тутельяна',
}
NUM = r'\d+(?:,\d+)?'
f = lambda s: float(s.replace(',', '.'))
r1 = lambda x: round(x * 10) / 10


# ───────── таблица с. 669–671 ─────────
STANDALONE = ('Тыква', 'Укроп', 'Чеснок', 'Щавель', 'Шпинат')   # строки таблицы без группы (с заглавной внутри группы)
# сезоны: таблица задаёт границы «с 1 сентября по 31 октября», «до 1 января», «с 1 января», «с 1 марта».
# Для «до 1 января» начало — 1 сентября (новый урожай, как у картофеля в той же таблице); «с 1 января» / «с 1 марта» —
# до 31 августа. Это прочтение таблицы; основание нормы показывает формулировку дословно.
SEASONS = [
    (r'с 1 сентября по 31 октября', (901, 1031)), (r'с 1 ноября по 31 декабря', (1101, 1231)),
    (r'с 1 января по 28-29 февраля', (101, 229)), (r'с 1 марта', (301, 831)),
    (r'до 1 января', (901, 1231)), (r'с 1 января', (101, 831)),
]
# расхождения, найденные в самой таблице (печатный оригинал, с. 671); процент подтверждён рецептурами сборника
SOURCE_NOTES = {
    'Яблоко свежее с удаленным семенным гнездом': 'В таблице брутто 122 г на 100 г нетто (это 18 %), отходы — 8 %. Рецептуры сборника применяют 8 % (№ 33, 34, 59, 69 и др.): принят процент таблицы.',
    'Ветчина в оболочке': 'В таблице брутто 102 г на 100 г нетто (это 2 %), отходы — 3 %. Рецептуры сборника применяют около 3 %: принят процент таблицы.',
}


def parse_table(lines):
    start = next(i for i, l in enumerate(lines) if 'Картофель свежий продовольственный:' in l)
    end = next(i for i, l in enumerate(lines) if l.strip().startswith('Содержание') and i > start)
    page = 669
    row = re.compile(rf'^(.*?)\s+({NUM})\s+({NUM})\s+({NUM})\s*$')
    out, group, sub, carry = [], None, None, ''
    for l in lines[start:end]:
        s = l.strip()
        if not s: continue
        if re.fullmatch(r'6[67]\d', s): page = int(s) + 1; continue
        m = row.match(s)
        if m:
            name = (carry + ' ' + m.group(1)).strip(); carry = ''
            g, sb = group, sub
            if name.startswith(STANDALONE): g, sb = None, None
            out.append({'group': g, 'sub': sb, 'cond': re.sub(r'(\w)- (\w)', r'\1\2', name), 'brutto': f(m.group(2)), 'pct': f(m.group(3)), 'netto': f(m.group(4)), 'page': page})
            continue
        if s.endswith(':'):
            t = re.sub(r'(\w)- (\w)', r'\1\2', (carry + ' ' + s[:-1]).strip()); carry = ''
            if group and out and out[-1]['group'] == group and t[0].islower(): sub = t
            else: group, sub = t, None
            continue
        if s in ('Орехи', 'Колбасные изделия', 'Сыры'): group, sub, carry = s, None, ''; continue
        carry = (carry + ' ' + s).strip()
    rows = []
    for i, r in enumerate(out, 1):
        parts = [p for p in (r['group'], r['sub'], r['cond']) if p]
        if r['group'] in ('Плоды и ягоды свежие', 'Орехи', 'Колбасные изделия', 'Сыры'): parts = [r['cond']] if r['group'] != 'Орехи' else ['Орехи', r['cond']]
        name = ', '.join(parts)
        season = next((v for k, v in SEASONS if k in r['cond']), None)
        if 'молодой' in r['cond']: season = None   # молодой картофель — отдельное сырьё; «до 1 сентября» — в названии
        frozen = 'замороженн' in name
        rows.append({'id': f'T{i:02d}', 'name': name, 'brutto': r['brutto'], 'pct': r['pct'], 'netto': r['netto'], 'page': r['page'],
                     'method': 'defrost' if frozen else 'clean', 'season': season, 'note': SOURCE_NOTES.get(r['cond'])})
    return rows


# ───────── рецептуры ─────────
def parse_recipes(pages):
    title_re = re.compile(r'^\s{0,6}(\d{1,4})\.\s+(\S.*\S)\s*$')
    row_re = re.compile(rf'^\s*(\S.*?\S)?\s{{2,}}((?:{NUM}|-|–)(?:\s+(?:{NUM}|-|–))*)\s*$')
    recipes, cur, pend, state, last, carry = [], None, None, None, None, ''
    for pno, page in enumerate(pages, start=1):
        if pno >= 664: break   # дальше — таблицы взаимозаменяемости и расхода сырья, содержание
        for line in page.split('\n'):
            s = line.strip()
            if not s: continue
            m = title_re.match(line)
            if m and not re.search(r'\s{3,}\d', line) and len(m.group(2)) > 3:
                pend = {'no': int(m.group(1)), 'title': re.sub(r'\s{2,}.*$', '', m.group(2)), 'page': pno, 'lines': [], 'yield': [], 'text': ''}
                if cur: state = None
                continue
            if 'Брутто' in s:
                if pend: cur = pend; recipes.append(cur); pend = None
                state = 'table' if cur else None; last = None; carry = ''; continue
            if state == 'text': cur['text'] += ' ' + s; continue
            if state != 'table': continue
            if s.startswith('Выход'): cur['yield'] = [val(x) for x in re.findall(rf'{NUM}|-', s)]; state = 'text'; continue
            if re.fullmatch(r'\d{1,3}', s): continue
            m = row_re.match(line)
            if m:
                name = re.sub(r'^г\s+', '', ((carry + ' ') if carry else '') + (m.group(1) or '')).strip()
                cur['lines'].append({'name': name, 'vals': m.group(2).split()}); last = cur['lines'][-1]; carry = ''
            elif last is not None and (s[0].islower() or s.startswith('(')): last['name'] += ' ' + s
            elif not s.startswith(('Расход', 'Наименование', 'Нетто', 'Вариант')): carry = (carry + ' ' + s).strip()
    return recipes


def val(v):
    return None if v in ('-', '–') else f(v)


METHOD_NAME = {'clean': 'Очистка', 'defrost': 'Размораживание', 'boil': 'Варка', 'poach': 'Припускание', 'saute': 'Пассерование', 'fry': 'Жарка',
               'stew': 'Тушение', 'bake': 'Запекание', 'blanch': 'Бланширование', 'steam': 'Варка на пару'}
THERMAL = {'boil', 'poach', 'saute', 'fry', 'stew', 'bake', 'blanch', 'steam'}
COOKED = [('отварн', 'boil'), ('варен', 'boil'), ('припущен', 'poach'), ('пассерован', 'saute'), ('жарен', 'fry'), ('тушен', 'stew'),
          ('запечен', 'bake'), ('бланширован', 'blanch'), ('на пару', 'steam')]
# глаголы технологии — для потерь полуфабриката: способ последней тепловой операции в описании
VERBS = [(r'запекают|запечь|запекать', 'bake'), (r'жарят|обжаривают|жарить', 'fry'), (r'тушат|тушить', 'stew'), (r'припускают', 'poach'),
         (r'на пару|режиме .?пар', 'steam'), (r'варят|отваривают|варить', 'boil')]
SKIP_WORDS = {'масса', 'полуфабриката', 'готового', 'готовой', 'готовых', 'и', 'с', 'в'}


def stems(name):
    return [w[:5] for w in re.findall(r'[а-яё]+', name.lower()) if len(w) > 2 and w not in SKIP_WORDS]


def clean_name(n):
    return re.sub(r'(\w)- (\w)', r'\1\2', re.sub(r'^или\s+', '', n)).strip().rstrip(',').strip()


bad = lambda n: re.search(r'\d|\bили\b|-$|:', n.lower()) or len(n) < 3 or n[0].islower()


def last_method(text):
    best = None
    for rx, m in VERBS:
        for x in re.finditer(rx, text): best = max(best or (-1, None), (x.start(), m))
    return best[1] if best else None


def derive(recipes):
    """(name, method, kind) → {pct: [recipes]}; kind: cold — брутто/нетто, thermal — масса после обработки, pf — полуфабрикат → выход."""
    acc = defaultdict(lambda: defaultdict(set))
    for r in recipes:
        lines = r['lines']
        ncols = max([len(l['vals']) // 2 for l in lines] + [1])
        for i, l in enumerate(lines):
            v, low = l['vals'], l['name'].lower()
            if low.startswith('масса'):
                if 'полуфабрикат' in low:   # полуфабрикат → готовое изделие
                    meth = last_method(r['text'])
                    if not meth: continue
                    for c in range(ncols):
                        mass = val(v[2 * c + 1]) if len(v) >= 2 * ncols else (val(v[c]) if c < len(v) else None)
                        y = r['yield'][c] if c < len(r['yield']) else None
                        if mass and y and y <= mass * 1.05: acc[('Полуфабрикат ' + (r['title'] if r['title'].startswith('«') else f'«{r["title"]}»'), meth, 'pf')][r1((1 - y / mass) * 100)].add(r['no'])
                    continue
                meth = next((m for k, m in COOKED if k in low), None)
                if not meth: continue
                adj = [k for k, _ in COOKED if k in low]
                noun = [x for x in stems(low) if not any(x.startswith(a[:5]) for a in adj)]
                if not noun: continue
                src = [x for x in lines[:i] if not x['name'].lower().startswith(('или', 'масса')) and noun[0] in stems(x['name'])]
                if len(src) != 1: continue
                sv = src[0]['vals']
                for c in range(ncols):
                    mass = val(v[2 * c + 1]) if len(v) >= 2 * ncols else (val(v[c]) if c < len(v) else None)
                    netto = val(sv[2 * c + 1]) if 2 * c + 1 < len(sv) else None
                    if mass and netto: acc[(clean_name(src[0]['name']), meth, 'thermal')][r1((1 - mass / netto) * 100)].add(r['no'])
                continue
            for c in range(0, len(v) - 1, 2):
                b, n = val(v[c]), val(v[c + 1])
                if b and n and n < b: acc[(clean_name(l['name']), 'clean', 'cold')][r1((1 - n / b) * 100)].add(r['no'])
    return acc


# ───────── связь с базой продуктов ─────────
END = re.compile(r'(ами|ями|ов|ев|ей|ой|ий|ый|ая|яя|ое|ее|ые|ие|ам|ям|ах|ях|[аяыиоеуюьй])$')


def wstems(w):
    b = END.sub('', w); return {b, re.sub(r'е([^аеиоуыэюя])$', r'\1', b)}


def words(s):
    return [w for w in re.sub(r'[^а-яa-z ]', ' ', s.lower().replace('ё', 'е')).split() if len(w) > 1]


def same(a, b):
    return any(len(x) >= 2 for x in wstems(a) & wstems(b))


GENERIC = {'соус', 'смесь', 'набор', 'заправка', 'пюре', 'сок', 'напиток', 'тесто', 'фарш', 'масло', 'мука', 'крупа', 'полуфабрикат'}


def score(product, ref):
    p, r = words(product), words(ref)
    if not p or not r or not same(p[0], r[0]): return 0
    extra = sum(1 for w in p[1:] if any(same(w, x) for x in r))
    if p[0] in GENERIC and not extra: return 0
    return 10 + extra


STOP = {'из', 'для', 'на', 'без', 'с', 'со', 'в', 'и', 'или', 'по', 'от'}


def rwords(s):
    return [w for w in re.sub(r'[^а-я ]', ' ', s.lower().replace('ё', 'е')).split() if len(w) > 1 and w not in STOP]


def link(rows, base):
    """Колонка «продукт базы»: продукт, все слова названия которого есть в названии строки сборника (самый точный)."""
    bw = [(b['code'], b['name'], rwords(b['name'])) for b in base]
    for row in rows:
        nw = rwords(row['product'])
        hits = [] if row['source'] == 'pf' else [(len(w), c, n) for c, n, w in bw if w and all(any(same(x, y) for y in nw) for x in w)]
        top = max([h[0] for h in hits] + [0])
        row['base'] = [{'code': c, 'name': n} for k, c, n in sorted(hits, key=lambda h: h[1]) if k == top]


def basis_of(row):
    s = f"{SRC['short']}, {SRC['edition']}, {SRC['publisher']}"
    if row['source'] == 'table':
        return f"{s}, с. {row['page']}, табл. «Расчет расхода сырья и выхода полуфабрикатов»: {row['product']} — брутто {row['brutto']:g} г, отходы {row['pct']:g} %, нетто {row['netto']:g} г"
    rs = row['recipes']
    ref = f"№ {', '.join(map(str, rs[:8]))}" + (f" и ещё {len(rs) - 8}" if len(rs) > 8 else '')
    what = {'recipes': 'брутто/нетто' if row['kind'] == 'cold' else 'нетто сырья / масса после обработки', 'pf': 'масса полуфабриката / выход'}[row['source']]
    return f"{s}, рецептуры {ref}: {row['product']} — {what}"


def build(table, recipes):
    rows = []
    for t in table:
        season_text = next((k for k, _ in SEASONS if k in t['name']), 'до 1 сентября' if 'до 1 сентября' in t['name'] else None)
        rows.append({'id': t['id'], 'product': t['name'], 'method': t['method'], 'method_name': METHOD_NAME[t['method']], 'kind': 'cold',
                     'pct': t['pct'], 'pct_min': t['pct'], 'pct_max': t['pct'], 'brutto': t['brutto'], 'netto': t['netto'], 'after': None,
                     'season': t['season'], 'season_text': season_text, 'source': 'table', 'page': t['page'], 'recipes': [], 'values': [], 'note': t['note']})
    acc = derive(recipes)
    n = 0
    for (name, meth, kind), vals in sorted(acc.items()):
        if bad(name) and kind != 'pf': continue
        vs = sorted(({'pct': p, 'recipes': sorted(rs)} for p, rs in vals.items()), key=lambda x: (-len(x['recipes']), x['pct']))
        # выбросы разбора (вёрстка PDF): одиночное значение, далёкое от основного, — не норма
        vs = [x for x in vs if x is vs[0] or len(x['recipes']) > 1 or abs(x['pct'] - vs[0]['pct']) <= max(10, 2 * abs(vs[0]['pct']))]
        if kind == 'cold' and vs[0]['pct'] == 0: continue   # брутто = нетто — обработки нет
        top = vs[0]; pcts = [x['pct'] for x in vs]; total = sum(len(x['recipes']) for x in vs); n += 1
        k = 'cold' if kind == 'cold' else 'thermal'
        rows.append({'id': f'R{n:04d}', 'product': name, 'method': meth, 'method_name': METHOD_NAME[meth], 'kind': k,
                     'pct': top['pct'], 'pct_min': min(pcts), 'pct_max': max(pcts),
                     'brutto': r1(100 / (1 - top['pct'] / 100)) if k == 'cold' and top['pct'] < 100 else (100.0 if k == 'thermal' else None),
                     'netto': 100.0, 'after': r1(100 * (1 - top['pct'] / 100)) if k == 'thermal' else None,
                     'season': None, 'season_text': None, 'source': 'pf' if kind == 'pf' else 'recipes', 'page': None,
                     'recipes': top['recipes'], 'recipes_total': total, 'values': vs,
                     'note': ('Масса полуфабриката → выход готового изделия; масло для смазки и подачи не учитывается. ' if kind == 'pf' else '')
                             + (f'В рецептурах {len(vs)} значений ({min(pcts)}…{max(pcts)} %); основное — самое частое ({len(top["recipes"])} из {total}).' if len(vs) > 1 else '') or None})
    return rows


def main():
    text = open(sys.argv[1], encoding='utf-8').read()
    pages = text.split('\f')
    table = parse_table(text.split('\n'))
    recipes = parse_recipes(pages)
    rows = build(table, recipes)
    base = json.load(open('data/reference/monchef_catalog_v55.json', encoding='utf-8'))['items']
    link(rows, base)
    for r in rows: r['basis'] = basis_of(r)
    out = {'source': {**SRC, 'sha256': sys.argv[2] if len(sys.argv) > 2 else None, 'table_pages': '669–671',
                      'table_title': 'Расчет расхода сырья и выхода полуфабрикатов', 'recipes': len(recipes)}, 'norms': rows}
    json.dump(out, open('data/reference/sbornik2022.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    from collections import Counter
    print('строк:', len(rows), Counter((r['kind'], r['source']) for r in rows), 'продуктов базы в таблице:', len({b['code'] for r in rows for b in r['base']}))


if __name__ == '__main__':
    main()
