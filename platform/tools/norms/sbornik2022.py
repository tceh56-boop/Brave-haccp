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
                pend = {'no': int(m.group(1)), 'title': re.sub(r'\s{2,}.*$', '', m.group(2)), 'page': pno, 'lines': []}; continue
            if 'Брутто' in s:
                if pend: cur = pend; recipes.append(cur); pend = None
                state = 'table' if cur else None; last = None; carry = ''; continue
            if state != 'table': continue
            if s.startswith('Выход'): state = None; continue
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


COOKED = [('отварн', 'boil'), ('варен', 'boil'), ('припущен', 'poach'), ('пассерован', 'saute'), ('жарен', 'fry'), ('тушен', 'stew'),
          ('запечен', 'bake'), ('бланширован', 'blanch'), ('на пару', 'steam'), ('припущенн', 'poach')]
SKIP_WORDS = {'масса', 'полуфабриката', 'готового', 'готовой', 'готовых', 'и', 'с', 'в'}


def stems(name):
    return [w[:5] for w in re.findall(r'[а-яё]+', name.lower()) if len(w) > 2 and w not in SKIP_WORDS]


def clean_name(n):
    return re.sub(r'(\w)- (\w)', r'\1\2', re.sub(r'^или\s+', '', n)).strip().rstrip(',').strip()


def derive(recipes):
    cold, thermal = defaultdict(lambda: defaultdict(set)), defaultdict(lambda: defaultdict(set))
    for r in recipes:
        lines = r['lines']
        for i, l in enumerate(lines):
            v = l['vals']
            low = l['name'].lower()
            if low.startswith('масса'):
                meth = next((m for k, m in COOKED if k in low), None)
                if not meth: continue
                adj = [k for k, _ in COOKED if k in low]
                noun = [s for s in stems(low) if not any(s.startswith(a[:5]) for a in adj)]
                if not noun: continue
                # сырьё — предыдущие строки той же рецептуры с тем же словом (основной вариант, не «или»)
                src = [x for x in lines[:i] if not x['name'].lower().startswith(('или', 'масса')) and noun[0] in stems(x['name'])]
                if len(src) != 1: continue
                s = src[0]
                for c in range(0, min(len(v), len(s['vals']) // 2)):
                    mass, netto = val(v[c] if len(v) <= len(s['vals']) // 2 else v[2 * c + 1] if 2 * c + 1 < len(v) else v[c]), val(s['vals'][2 * c + 1])
                    if mass and netto: thermal[(clean_name(s['name']), meth)][r1((1 - mass / netto) * 100)].add(r['no'])
                continue
            if len(v) >= 2 and not low.startswith('масса'):
                for c in range(0, len(v) - 1, 2):
                    b, n = val(v[c]), val(v[c + 1])
                    if b and n and n < b: cold[clean_name(l['name'])][r1((1 - n / b) * 100)].add(r['no'])

    # строка с цифрами внутри названия, «или», оборванным переносом — артефакт вёрстки: в справочник не идёт
    bad = lambda n: re.search(r'\d|\bили\b|-$|:', n.lower()) or len(n) < 3 or n[0].islower()

    def pack(d, with_method):
        out = []
        for k, vals in sorted(d.items()):
            name, meth = (k if with_method else (k, None))
            if bad(name): continue
            vs = sorted(({'pct': p, 'recipes': sorted(rs)} for p, rs in vals.items()), key=lambda x: (-len(x['recipes']), x['pct']))
            out.append({'name': name, **({'method': meth} if meth else {}), 'values': vs, 'n': sum(len(x['recipes']) for x in vs)})
        return out
    return pack(cold, False), pack(thermal, True)


def main():
    text = open(sys.argv[1], encoding='utf-8').read()
    pages = text.split('\f')
    table = parse_table(text.split('\n'))
    recipes = parse_recipes(pages)
    cold, thermal = derive(recipes)
    out = {'source': {**SRC, 'sha256': sys.argv[2] if len(sys.argv) > 2 else None, 'table_pages': '669–671',
                      'table_title': 'Расчет расхода сырья и выхода полуфабрикатов', 'recipes': len(recipes)},
           'table': table, 'cold': cold, 'thermal': thermal}
    json.dump(out, open('data/reference/sbornik2022.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'таблица: {len(table)}; рецептур: {len(recipes)}; холодная по рецептурам: {len(cold)}; тепловая: {len(thermal)}')


if __name__ == '__main__':
    main()
