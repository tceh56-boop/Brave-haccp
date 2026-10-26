import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createProduct, createSupplier } from '../src/server/ops/catalog';
import { createReceipt } from '../src/server/ops/receipts';
import { setRecognition, recognizeDocument, rememberAlias, getRecognition } from '../src/server/ops/recognition';
import { orient, rotateAnn, rebuildTableText, mergeAnn, type Ann } from '../src/server/recognition/vision';
import { classify, finalize, EXTRACT_PROMPT, AUDIT_PROMPT } from '../src/server/recognition/extract';
import { norm, fuzzyScore, resolver, matchNomenclature } from '../src/server/recognition/match';
import { makeUser, lastLinkToken } from './helpers';

// Обращений к Yandex Cloud нет: fetch подменяется, снимок — синтетическая разметка Vision.
afterAll(() => closePool());
afterEach(() => { vi.unstubAllGlobals(); });

/** Разметка Vision для строк текста; rot90 — лист снят боком (текст читается снизу вверх). */
function annotation(lines: string[], rot90 = false): Ann {
  const UW = 2000, UH = 60 * lines.length + 100;   // размер «ровного» листа
  const at = (x: number, y: number) => (rot90 ? { x: String(y), y: String(UW - x) } : { x: String(x), y: String(y) });
  const blocks = lines.map((text, i) => {
    let x = 40;
    const y = 50 + i * 60;
    const words = text.split(' ').map((t) => { const w = t.length * 16; const v = [at(x, y), at(x + w, y), at(x + w, y + 30), at(x, y + 30)]; x += w + 14; return { text: t, boundingBox: { vertices: v } }; });
    return { lines: [{ words }] };
  });
  return { width: String(rot90 ? UH : UW), height: String(rot90 ? UW : UH), fullText: lines.join('\n'), blocks };
}

const UPD_LINES = [
  'Универсальный передаточный документ Счёт-фактура № TEST-0001 от 15 октября 2026 г.',
  'Продавец: ООО "Поставщик-Тест" ИНН/КПП продавца 0000000000/000000000',
  '1 Форель филе с/м трим А 1,2-1,6 (С) кг 16,120 1 385,25 22 330,16 без акциза 22% 4 912,64 27 242,80',
  '2 Тунец филе с/м Лоин 2-6кг кг 3,064 770,00 2 359,28 без акциза 10% 235,93 2 595,21',
  '3 Майонез "Царский" премиум 67% 10 л. шт 1,000 1 137,70 1 137,70 без акциза 22% 250,30 1 388,00',
  'Всего к оплате 25 827,14 X 5 398,87 31 226,01',
];
const EXTRACTION = {
  document_type: 'upd', document_number: 'TEST-0001', document_date: '2026-10-15', supplier: 'ООО "Поставщик-Тест"', buyer: 'ООО "Покупатель-Тест"', total: 31226.01, recognition_confidence: 0.93, warnings: [],
  items: [
    { line_number: 1, raw_name: 'Форель филе с/м трим А 1,2-1,6 (С)', quantity: '16,120', unit: 'кг', price: '1 385,25', sum: '22 330,16', vat: '4 912,64', confidence: 0.95 },
    { line_number: 2, raw_name: 'Тунец филе с/м Лоин 2-6кг', quantity: 3.064, unit: 'кг', price: 770, sum: 2359.28, vat: 235.93, confidence: 0.94 },
    { line_number: 3, raw_name: 'Майонез "Царский" премиум 67% 10 л.', quantity: 1, unit: 'шт', price: 1137.7, sum: 1137.7, vat: 250.3, confidence: 0.9 },
  ],
};

describe('Этап 17, часть 2: движок MON CHEF (без обращений к облаку)', () => {
  it('промпты — дословно из MON CHEF V10 и V12', () => {
    expect(EXTRACT_PROMPT.startsWith('Ты — модуль извлечения данных из реальных документов кухни/ресторана.')).toBe(true);
    expect(EXTRACT_PROMPT).toContain('9) Для УПД/счёта различай цену без НДС, ставку НДС и итоговую стоимость.');
    expect(AUDIT_PROMPT).toContain('Проверяй прежде всего числа, номер, дату, поставщика и соответствие quantity*price≈sum.');
  });

  it('фото боком: ориентация 90°, после поворота таблица собирается по строкам в порядке чтения', () => {
    const a = annotation(UPD_LINES, true);
    expect(orient(a)).toBe(90);
    rotateAnn(a, 90);
    expect(orient(a)).toBe(0);
    expect(rebuildTableText(a)!.split('\n')).toEqual(UPD_LINES);
  });

  it('несколько фото — страницы одного документа, строки второй ниже первой', () => {
    const m = mergeAnn([annotation(UPD_LINES.slice(0, 3)), annotation(UPD_LINES.slice(3))]);
    expect(m.pageTops).toHaveLength(2);
    expect(rebuildTableText(m)!.split('\n')).toEqual(UPD_LINES);
  });

  it('классификация: УПД; товарно-транспортная накладная METRO и ТОРГ-12 — накладная', () => {
    expect(classify(UPD_LINES.join('\n'), 'upd')).toBe('UPD');
    expect(classify('ТОВАРНО-ТРАНСПОРТНАЯ НАКЛАДНАЯ Типовая межотраслевая форма № 1-Т', 'invoice')).toBe('WAYBILL');
    expect(classify('Товарная накладная форма ТОРГ-12', 'unknown')).toBe('WAYBILL');
  });

  it('нормализация и нечёткое сравнение V11: латиница-двойники, единицы', () => {
    expect(norm('MАЙOНEЗ 10 литров')).toBe('майонез 10 л');
    expect(fuzzyScore('Форель филе с/м трим А', 'Форель филе с/м')).toBeGreaterThan(0.7);
    expect(fuzzyScore('Тунец филе', 'Сахар белый')).toBeLessThan(0.7);
  });

  it('R2 из MON CHEF: «сливки 10 %» ≠ «сливки 33 %», форель не подставляется вместо тунца, семга находит лосось', () => {
    const ps = [{ id: 'c10', name: 'Сливки 10%', unit: 'л' }, { id: 'c33', name: 'Сливки 33%', unit: 'л' }, { id: 'tr', name: 'Форель филе', unit: 'кг' }, { id: 'ls', name: 'Лосось без кожи и кости', unit: 'кг' }];
    expect(matchNomenclature('Сливки питьевые 33% 1л', ps).matched?.id).toBe('c33');
    expect(matchNomenclature('Тунец филе с/м', ps).matched).toBeNull();
    expect(matchNomenclature('СЕМГА ФИЛЕ ОХЛАЖДЕННАЯ', ps).matched?.id).toBe('ls');
  });

  it('итог разбора: арифметика с допуском 2 % (округление цены поставщиком — не ошибка), расхождение — на проверку', () => {
    const vis = { layoutText: UPD_LINES.join('\n'), fullText: UPD_LINES.join('\n'), markdown: '', quality: 0.9, model: 'page', pages: 2, orient: [90, 180] };
    const products = [{ id: 'p1', name: 'Форель филе с/м трим А', unit: 'кг' }, { id: 'p2', name: 'Тунец филе с/м', unit: 'кг' }];
    const doc = finalize(JSON.parse(JSON.stringify(EXTRACTION)), vis, resolver(products, [], 'ООО "Поставщик-Тест"'));
    expect(doc).toMatchObject({ document_type: 'UPD', document_number: 'TEST-0001', document_date: '2026-10-15', total: 31226.01 });
    expect(doc.items[0]).toMatchObject({ quantity: 16.12, price: 1385.25, sum: 22330.16, calculation_mismatch: false, matched_product: { id: 'p1', source: 'R2' } });
    expect(doc.items[2]).toMatchObject({ matched_product: null, requires_manual_review: true });     // майонеза нет в номенклатуре
    expect(doc.warnings).toContain('Строка 3: нет уверенного соответствия номенклатуре.');
    const bad = finalize({ ...JSON.parse(JSON.stringify(EXTRACTION)), items: [{ raw_name: 'Тунец', quantity: 3, price: 770, sum: 2359.28 }] }, vis, resolver(products, [], null));
    expect(bad.items[0]).toMatchObject({ calculation_mismatch: true, requires_manual_review: true });
  });
});

describe('Этап 17, часть 2: распознавание приёмки (Vision и модель подменены)', () => {
  let owner: Awaited<ReturnType<typeof makeUser>>, cook: typeof owner, orgId: string, siteId: string, receiptId: string, trout: string, tuna: string, mayo: string;
  const fetchMock = () => {
    let llmCalls = 0;
    return vi.fn(async (url: string) => {
      if (String(url).includes('ocr.api.cloud.yandex.net')) return new Response(JSON.stringify({ result: { textAnnotation: annotation(UPD_LINES, true) } }), { status: 200 });
      llmCalls++;
      const text = llmCalls === 1 ? JSON.stringify(EXTRACTION) : JSON.stringify({ ok: true, line_corrections: [], warnings: [] });
      return new Response(JSON.stringify({ result: { alternatives: [{ message: { text: '```json\n' + text + '\n```' } }], usage: { totalTokens: '1200' } } }), { status: 200 });
    });
  };

  beforeAll(async () => {
    vi.stubEnv('YANDEX_API_KEY', 'AQVN-тест'); vi.stubEnv('YANDEX_FOLDER_ID', 'b1gtest00000');
    owner = await makeUser();
    const r = await createOrganization(owner, { name: 'Кафе «Накладные»' });
    orgId = r.organization.id; siteId = r.site.id;
    cook = await makeUser();
    await inviteMember(owner.id, orgId, { email: cook.email, role: 'line_staff' });
    await acceptInvitation(cook, await lastLinkToken(cook.email, 'invitation'));
    trout = (await createProduct(owner.id, orgId, { name: 'Форель филе с/м трим А', unit: 'кг' })).id;
    tuna = (await createProduct(owner.id, orgId, { name: 'Тунец филе с/м', unit: 'кг' })).id;
    mayo = (await createProduct(owner.id, orgId, { name: 'Майонез провансаль ведро', unit: 'шт' })).id;
    const sup = (await createSupplier(owner.id, orgId, { name: 'ООО «Поставщик-Тест»' })).id;
    receiptId = (await createReceipt(cook.id, orgId, { siteId, supplierId: sup })).id;
  });
  afterAll(() => vi.unstubAllEnvs());
  const jpeg = [{ bytes: Buffer.from([0xff, 0xd8, 0xff, 0x00]), mimeType: 'image/jpeg', name: 'лист1.jpg' }];

  it('выключено на предприятии — к облаку не обращается', async () => {
    const f = fetchMock(); vi.stubGlobal('fetch', f);
    await expect(recognizeDocument(cook.id, orgId, { siteId, receiptId, kind: 'upd' }, jpeg)).rejects.toThrow(/выключено/);
    expect(f).not.toHaveBeenCalled();
  });

  it('черновик: тип, номер, строки с кандидатами; расход учтён; вторая проверка — для сомнительного документа', async () => {
    await setRecognition(owner.id, orgId, { enabled: true, kinds: ['upd', 'torg12'], monthlyPages: 10 });
    const f = fetchMock(); vi.stubGlobal('fetch', f);
    await expect(recognizeDocument(cook.id, orgId, { siteId, receiptId, kind: 'upd' }, [{ bytes: Buffer.from('x'), mimeType: 'image/gif', name: 'a.gif' }])).rejects.toThrow(/JPEG, PNG или PDF/);
    const r = await recognizeDocument(cook.id, orgId, { siteId, receiptId, kind: 'upd' }, jpeg);
    expect(r.duplicate).toBeNull();
    expect(r.document).toMatchObject({ document_type: 'UPD', document_number: 'TEST-0001', total: 31226.01, ocr: { orient: [90], pages: 1 } });
    expect(r.document.items.map((i) => i.matched_product?.id ?? null)).toEqual([trout, tuna, null]);
    expect(r.document.second_pass).toBe('SECOND_PASS_OK');       // майонез без соответствия → документ сомнительный → проверка
    expect(f.mock.calls.filter(([u]) => String(u).includes('llm.api')).length).toBe(2);
    const u = (await getRecognition(owner.id, orgId)).usage.find((x) => x.kind === 'upd')!;
    expect(u).toMatchObject({ pages: 1, tokens: 2400, calls: 1, failed: 0 });
  });

  it('выбор человека запоминается — следующий раз строка сопоставляется сама; повтор документа — дубль', async () => {
    await rememberAlias(cook.id, orgId, { rawText: 'Майонез "Царский" премиум 67% 10 л.', productId: mayo, supplier: 'ООО "Поставщик-Тест"' });
    vi.stubGlobal('fetch', fetchMock());
    const r = await recognizeDocument(cook.id, orgId, { siteId, receiptId, kind: 'upd' }, jpeg);
    expect(r.document.items[2].matched_product).toMatchObject({ id: mayo, source: 'ALIAS' });
    expect(r.duplicate).toBeTruthy();
  });

  it('лимит месяца исчерпан — к облаку не обращается; ошибка облака учитывается', async () => {
    await setRecognition(owner.id, orgId, { enabled: true, kinds: ['upd'], monthlyPages: 2 });
    const f = fetchMock(); vi.stubGlobal('fetch', f);
    await expect(recognizeDocument(cook.id, orgId, { siteId, receiptId, kind: 'upd' }, jpeg)).rejects.toThrow(/Лимит распознавания на месяц исчерпан: 2 из 2/);
    expect(f).not.toHaveBeenCalled();
    await setRecognition(owner.id, orgId, { enabled: true, kinds: ['upd'], monthlyPages: 10 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"message":"Unauthenticated"}', { status: 401 })));
    await expect(recognizeDocument(cook.id, orgId, { siteId, receiptId, kind: 'upd' }, jpeg)).rejects.toThrow(/Распознать не удалось: Yandex Vision: 401/);
    const u = (await getRecognition(owner.id, orgId)).usage.find((x) => x.kind === 'upd')!;
    expect(u.failed).toBe(1);
    const docs = (await withSystem((tx) => tx.query(`select count(*)::int as n from recognition_documents where organization_id = $1`, [orgId]))).rows[0].n;
    expect(docs).toBe(2);
  });
});
