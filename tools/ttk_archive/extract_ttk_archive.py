#!/usr/bin/env python3
"""
Извлечение архива ТТК (Excel) в нормализованный JSON для импорта в «ЦЕХ».

Apps Script не читает .xls, поэтому разбор файлов вынесен сюда (та же граница, что и
у импорта продуктов, см. gas/ProductImport.gs): скрипт извлекает только СЫРЫЕ данные
карты — шапку, строки сырья, текст технологии. Разбор технологии в этапы делает
сервер (parseTechnologySteps_ в TechNormsCore.gs), чтобы правила были в одном месте.

Использование:
  1) .xls → .xlsx (LibreOffice):  soffice --headless --convert-to xlsx --outdir OUT *.xls
  2) python3 extract_ttk_archive.py <папка с .xlsx> <ttk_archive.json>

Поддерживаются два формата карт:
  A — «Технологическая карта» с колонками брутто/нетто/вес готового/нетто на порцию или 1 кг;
  B — короткая карта «Наименование ингредиента / Ед.изм. / Брутто» без выхода и технологии.
"""
import json, os, re, sys
import openpyxl

UNIT_MASS = {'г': 'mass', 'гр': 'mass', 'кг': 'mass', 'мл': 'vol', 'л': 'vol', 'шт': 'pcs', 'порция': 'portion'}
GRAMS_IN_NAME = re.compile(r'(\d+(?:[.,]\d+)?)\s*(кг|гр|г)(?![а-яё])', re.I)


def grams_from_name(name):
    """«Соус тар-тар 90 гр» → 90; «Зельц 200 г» → 200. Только явные г/кг, без догадок по «60-10»."""
    m = GRAMS_IN_NAME.search(str(name or ''))
    if not m:
        return None
    v = float(m.group(1).replace(',', '.'))
    return v * 1000 if m.group(2).lower() == 'кг' else v


def norm_unit(u):
    u = str(u or '').strip().lower().rstrip('.')
    return {'гр': 'г'}.get(u, u)


def num(v):
    if v is None or v == '':
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(',', '.')
    try:
        return float(s)
    except ValueError:
        return None


def parse_yield(raw):
    """«160/160/40 (2 шт)» → 360 г; «200 гр» → 200; «1 кг» → 1000. None, если не распознано."""
    s = str(raw or '').lower().replace(',', '.')
    s = re.sub(r'\(.*?\)', ' ', s)
    if not s.strip():
        return None
    kg = re.search(r'(\d+(?:\.\d+)?)\s*кг', s)
    if kg:
        return float(kg.group(1)) * 1000
    parts = re.findall(r'\d+(?:\.\d+)?', s.split('шт')[0] if 'шт' in s and '/' not in s else s)
    if not parts:
        return None
    return sum(float(p) for p in parts)


def cells(row):
    return [(i, c) for i, c in enumerate(row) if c not in (None, '')]


def extract(path, root):
    ws = openpyxl.load_workbook(path, data_only=True).worksheets[0]
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    rel = os.path.relpath(path, root)
    folders = rel.split(os.sep)[:-1]
    card = {'source_path': rel, 'category_path': folders, 'name': '', 'organization': '', 'yield_raw': '', 'yield_g': None,
            'basis': '', 'production_basis': '', 'format': '', 'lines': [], 'totals': {}, 'technology': '', 'issues': []}
    header_idx, cols = None, {}
    for i, r in enumerate(rows):
        c = cells(r)
        if not c:
            continue
        first = str(c[0][1]).strip()
        val = str(c[1][1]).strip() if len(c) > 1 else ''
        if first == 'Наименование блюда:':
            card['name'] = val
        elif first == 'Организация:':
            card['organization'] = val
        elif first in ('Выход в готовом виде:', 'Выход готового блюда:'):
            card['yield_raw'] = val
        elif first == 'Основание производства:':
            card['production_basis'] = val
        elif header_idx is None and any('Брутто' in str(x[1]) or 'брутто' in str(x[1]) for x in c) and any('Наименование' in str(x[1]) for x in c):
            header_idx = i
            for j, h in c:
                h = str(h).lower()
                if h.startswith('№'): cols['no'] = j
                elif 'наименование' in h: cols['name'] = j
                elif 'ед' in h: cols['unit'] = j
                elif 'брутто' in h: cols['brutto'] = j
                elif 'готов' in h: cols['ready'] = j
                elif 'нетто на' in h: cols['per_basis'] = j
                elif 'нетто' in h: cols['netto'] = j
            card['format'] = 'A' if 'netto' in cols else 'B'
    if header_idx is None:
        card['issues'].append('Не найдена таблица сырья')
        return card
    i = header_idx + 1
    if i < len(rows):
        c = cells(rows[i])
        if len(c) == 1 and re.search(r'порц|кг', str(c[0][1]).lower()):
            card['basis'] = str(c[0][1]).strip()
            i += 1
    tech_mode = False
    tech = []
    for r in rows[i:]:
        c = cells(r)
        if not c:
            continue
        first = str(c[0][1]).strip()
        if first.startswith('Технология приготовления'):
            tech_mode = True
            rest = first.split(':', 1)[1].strip() if ':' in first else ''
            if rest: tech.append(rest)
            tech.extend(str(x[1]).strip() for x in c[1:])
            continue
        if tech_mode:
            if first in ('Директор', 'Шеф-повар', 'Калькулятор') or first.startswith('Дата печати'):
                break
            tech.extend(str(x[1]).strip() for x in c)
            continue
        no = num(r[cols['no']]) if 'no' in cols and cols['no'] < len(r) else None
        name = r[cols['name']] if 'name' in cols and cols['name'] < len(r) else None
        if no is not None and name not in (None, ''):
            g = lambda k: r[cols[k]] if k in cols and cols[k] < len(r) else None
            card['lines'].append({'no': int(no), 'name': str(name).strip(), 'unit': norm_unit(g('unit')), 'brutto': num(g('brutto')),
                                  'netto': num(g('netto')), 'ready': num(g('ready')), 'per_basis': num(g('per_basis')),
                                  'is_pf': bool(re.search(r'п\s*/?\s*ф(?![а-яё])', str(name).lower())),
                                  # единица «порция» — ссылка на другую ТТК (соус, гарнир, рулетики в ассорти)
                                  'is_portion_ref': norm_unit(g('unit')) == 'порция',
                                  'portion_g': grams_from_name(name) if norm_unit(g('unit')) == 'порция' else None})
        elif no is None and card['lines'] and not card['totals'] and any(isinstance(x[1], (int, float)) for x in c):
            vals = [num(x[1]) for x in c]
            card['totals'] = {'raw': vals}
    card['technology'] = ' '.join(t for t in tech if t).strip()
    card['yield_g'] = parse_yield(card['yield_raw'])
    card['yield_source'] = 'карта' if card['yield_g'] else ''
    if card['yield_g'] is None and grams_from_name(card['name']):
        card['yield_g'], card['yield_source'] = grams_from_name(card['name']), 'название'
    if card['yield_g'] is None and card['basis'] == '1 кг':
        # колонка «нетто на 1 кг» = нетто / выход(кг): выход = нетто / нетто_на_1кг; берём медиану по строкам
        ratios = sorted(l['netto'] / l['per_basis'] * 1000 for l in card['lines']
                        if l['netto'] and l['per_basis'] and l['unit'] in ('кг', 'л'))
        if ratios:
            card['yield_g'], card['yield_source'] = round(ratios[len(ratios) // 2], 1), 'пересчёт «нетто на 1 кг»'
    if card['yield_g'] is None and card['basis'] == '1 порция':
        ready = sum((l['ready'] or 0) * (1000 if l['unit'] in ('кг', 'л') else 1) for l in card['lines'] if l['unit'] in ('кг', 'л', 'г', 'мл'))
        if ready > 0:
            card['yield_g'], card['yield_source'] = round(ready, 1), 'сумма веса готового'
    check(card)
    return card


def check(card):
    """Только проверки качества данных карты; нормативные выводы делает сервер."""
    iss = card['issues']
    if not card['lines']:
        iss.append('Нет строк сырья')
    if not card['technology']:
        iss.append('Нет текста технологии')
    if card['format'] == 'B':
        iss.append('Короткий формат: нет нетто и выхода')
    elif card['yield_g'] is None:
        iss.append('Выход не указан и не определяется косвенно')
    elif card['yield_source'] != 'карта':
        iss.append('Выход не указан в карте, взят из: %s (%.0f г) — подтвердить' % (card['yield_source'], card['yield_g']))
    dims = {}
    for l in card['lines']:
        dims.setdefault(UNIT_MASS.get(l['unit'], '?'), set()).add(l['unit'])
        if l['brutto'] is not None and l['netto'] is not None and l['netto'] > l['brutto'] + 1e-9:
            iss.append('Нетто больше брутто: %s' % l['name'])
        if l.get('is_portion_ref') and not l.get('portion_g'):
            iss.append('Вложенная ТТК без массы порции: %s' % l['name'])
        if card['format'] == 'A' and (l['netto'] in (None, 0)):
            iss.append('Нулевое нетто: %s' % l['name'])
        if l['unit'] not in UNIT_MASS:
            iss.append('Неизвестная единица «%s»: %s' % (l['unit'], l['name']))
    for d, units in dims.items():
        if len(units) > 1:
            iss.append('Смешаны единицы %s в одной карте — итоговые суммы в карте некорректны' % '/'.join(sorted(units)))
    if card['format'] == 'A' and card['yield_g']:
        mass = sum((l['netto'] or 0) * (1000 if l['unit'] in ('кг', 'л') else 1) for l in card['lines'] if l['unit'] in ('кг', 'л', 'г', 'мл'))
        if mass and card['yield_g'] > mass * 1.02:
            iss.append('Выход (%.0f г) больше закладки нетто (%.0f г) — нет компонента или ошибка единиц' % (card['yield_g'], mass))
    names = [l['name'].lower() for l in card['lines']]
    dup = sorted(set(n for n in names if names.count(n) > 1))
    if dup:
        iss.append('Повтор ингредиента: %s' % ', '.join(dup))


def main():
    root, out = sys.argv[1], sys.argv[2]
    cards = []
    for dp, _, fs in os.walk(root):
        for f in sorted(fs):
            if f.lower().endswith('.xlsx') and not f.startswith('~$') and f != 'Реестр ТТК.xlsx':
                try:
                    cards.append(extract(os.path.join(dp, f), root))
                except Exception as e:  # битый файл не должен останавливать весь архив
                    cards.append({'source_path': os.path.relpath(os.path.join(dp, f), root), 'issues': ['Ошибка чтения: %s' % e], 'lines': []})
    cards.sort(key=lambda c: c['source_path'])
    with open(out, 'w', encoding='utf-8') as fh:
        json.dump({'version': 1, 'count': len(cards), 'cards': cards}, fh, ensure_ascii=False, indent=1)
    print('карт:', len(cards), '→', out)


if __name__ == '__main__':
    main()
