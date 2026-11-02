import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createProduct, createSupplier } from '../src/server/ops/catalog';
import { createReceipt, addReceiptLine, completeReceipt } from '../src/server/ops/receipts';
import { createDish, getDish, updateVersion, addLine, submitVersion, approveVersion } from '../src/server/ops/recipes';
import { createProduction, startProduction, completeProduction, addReleaseCheck, recordCheck } from '../src/server/ops/production';
import { openLot, createLabels, logPrint, confirmReprint, labelLog } from '../src/server/ops/labels';
import { setSampleSettings, takeSample, createProgram, recordResult } from '../src/server/ops/lab';
import { getJournal, listForms } from '../src/server/ops/journals';
import { explode } from '../src/server/ops/bom';
import { makeUser, lastLinkToken } from './helpers';

/** Журналы J54–J60 (ТЗ доработки, 7.5): из реальных событий, без повторного ввода; перепечать — с причиной и подтверждением. */

afterAll(() => closePool());
type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, chef: U, cook: U, haccp: U, orgId: string, siteId: string;
let beef: string, beefLot: string, semi: string, semiLot: string, dish: string, openedLot: string;
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
const inDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const P = () => ({ siteId, from: inDays(-1), to: inDays(1) });

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}
async function mkDish(name: string, kind: 'semi' | 'dish', lines: [string, number][]) {
  const d = await createDish(chef.id, orgId, { name, kind });
  const v = (await getDish(chef.id, orgId, d.id)).current!.version.id;
  await updateVersion(chef.id, orgId, v, { yieldG: 1000, portionG: 200, technology: 'Сырьё измельчают, перемешивают, обрабатывают по ТТК.', storageConditions: 'от +2 до +6 °C', shelfLife: '24 часа', shelfLifeHours: 24 });
  for (const [p, kg] of lines) await addLine(chef.id, orgId, v, { productId: p, unit: 'кг', brutto: kg, netto: kg });
  await submitVersion(chef.id, orgId, v); await approveVersion(chef.id, orgId, v);
  return d.id;
}
async function produce(dishId: string) {
  const o = await createProduction(chef.id, orgId, { siteId, dishId, plannedKg: 1, plannedFor: today() });
  await startProduction(cook.id, orgId, o.id);
  return { orderId: o.id, done: (extra: Record<string, unknown> = {}) => completeProduction(cook.id, orgId, o.id, { actualKg: 0.95, operationId: randomUUID(), ...extra }) };
}

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Цех журналов' });
  orgId = r.organization.id; siteId = r.site.id;
  chef = await invite('chef'); cook = await invite('line_staff'); haccp = await invite('haccp_lead');
  beef = (await createProduct(chef.id, orgId, { name: 'Говядина', unit: 'кг' })).id;
  const sup = (await createSupplier(chef.id, orgId, { name: 'ООО «Мясо»' })).id;
  const rc = await createReceipt(cook.id, orgId, { siteId, supplierId: sup });
  await addReceiptLine(cook.id, orgId, rc.id, { productId: beef, quantity: 10, unitPrice: 500, lotNo: 'Г-77', expiresAt: inDays(5), expiryBasis: 'маркировка изготовителя',
    checks: { packaging: true, labeling: true, documents: true, quality: true }, decision: 'accepted' });
  await completeReceipt(cook.id, orgId, rc.id);
  beefLot = (await withSystem((tx) => tx.query(`select id from lots where product_id = $1`, [beef]))).rows[0].id;
  // J54: вскрытие тары
  openedLot = (await openLot(cook.id, orgId, beefLot, { quantity: 2, hours: 48, basis: 'маркировка: после вскрытия 48 ч', operationId: randomUUID() })).lot_id;
  // J55: п/ф с проверкой выпуска; J58: готовое блюдо
  semi = await mkDish('Фарш говяжий', 'semi', [[beef, 1]]);
  await addReleaseCheck(haccp.id, orgId, semi, { name: 'Температура фарша', unit: '°C', max: 6, basis: 'План ХАССП, ККТ-2' });
  const a = await produce(semi);
  const chk = (await withSystem((tx) => tx.query(`select id from release_checks where dish_id = $1`, [semi]))).rows[0].id;
  await recordCheck(cook.id, orgId, a.orderId, { checkId: chk, value: 4 });
  semiLot = (await a.done()).lot_id;
  dish = await mkDish('Котлеты', 'dish', [[beef, 1]]);
  const b = await produce(dish);
  await expect(b.done()).rejects.toThrow(/с бракеражем/);
  await b.done({ organoleptic: 'Внешний вид, цвет, вкус и запах соответствуют ТТК', decision: 'allowed' });
  // J59, J60
  await setSampleSettings(haccp.id, orgId, { minWeightG: 100, retentionHours: 48, tMin: 2, tMax: 6, basis: 'СанПиН 2.3/2.4.4282-26' });
  await takeSample(cook.id, orgId, { siteId, source: 'lot', lotId: semiLot, weightG: 150, container: 'стерильная банка', storagePlace: 'Холодильник для проб', temperature: 4 });
  const prog = (await createProgram(haccp.id, orgId, { siteId, testType: 'Микробиология готовой продукции', target: 'Фарш говяжий', periodDays: 90, nextDue: today(), basis: 'ППК, разд. 5' })).id;
  await recordResult(haccp.id, orgId, { siteId, programId: prog, labName: 'ИЛЦ «Центр гигиены»', protocolNo: '55/26', sampledOn: inDays(-1), resultOn: today(),
    params: [{ name: 'КМАФАнМ', norm: '≤ 5×10⁶ КОЕ/г', fact: '1×10⁴', unit: 'КОЕ/г', pass: true }, { name: 'Сальмонеллы', norm: 'не допускаются в 25 г', fact: 'обнаружены', pass: false }], conclusion: 'Не соответствует ТР ТС 021/2011 по патогенным микроорганизмам' });
});

describe('Журналы J54–J60 из событий', () => {
  it('формы J54–J60 есть в реестре и автоматические', () => {
    const f = listForms().filter((x) => /^J(5[4-9]|60)$/.test(x.code));
    expect(f.map((x) => x.code)).toEqual(['J54', 'J55', 'J56', 'J57', 'J58', 'J59', 'J60']);
    expect(f.every((x) => x.mode === 'auto')).toBe(true);
  });

  it('J54 — вскрытие: исходная партия, срок после вскрытия, основание, новая этикетка', async () => {
    const j = await getJournal(owner.id, orgId, 'J54', P());
    expect(j.rows).toHaveLength(1);
    const [, product, lot, qty, who, hours, basis, , label] = j.rows[0];
    expect([product, lot, qty, hours]).toEqual(['Говядина', 'Г-77', '2 кг', '48 ч']);
    expect(who).not.toBe('—');
    expect(basis).toMatch(/после вскрытия/);
    expect(label).toMatch(/^[A-Z0-9-]+$/);
    expect(j.links).toEqual([`/app/${orgId}/lots/${openedLot}`]);   // строка журнала ведёт к исходному событию
  });

  it('J55 — выпуск п/ф: версия ТТК, партии сырья, этикетка, результат контроля; J58 — готовое блюдо', async () => {
    const j = await getJournal(owner.id, orgId, 'J55', P());
    expect(j.rows).toHaveLength(1);
    expect(j.rows[0][0]).toBe('Фарш говяжий');
    expect(j.rows[0][1]).toBe('версия 1');
    expect(j.rows[0][4]).toMatch(/Говядина Г-77/);
    expect(j.rows[0][8]).toBe('в норме: 1 из 1');
    expect(j.links![0]).toMatch(new RegExp(`^/app/${orgId}/production/`));
    const d = await getJournal(owner.id, orgId, 'J58', P());
    expect(d.rows.map((r) => r[0])).toEqual(['Котлеты']);
    expect(d.rows[0][4]).toMatch(/^допущено/);
    expect(d.rows[0][5]).toBe('Внешний вид, цвет, вкус и запах соответствуют ТТК');
    expect(d.rows[0][6]).toBe('разрешено');
  });

  it('J56/J57 — печать; перепечать только с причиной; подтверждает другой сотрудник', async () => {
    const [lb] = await createLabels(cook.id, orgId, { lotIds: [semiLot] });
    await logPrint(cook.id, orgId, { labelIds: [lb.id], format: '58x40', copies: 2 });
    await expect(logPrint(cook.id, orgId, { labelIds: [lb.id], format: '58x40', copies: 1 })).rejects.toThrow(/причину перепечати/);
    await logPrint(cook.id, orgId, { labelIds: [lb.id], format: '58x40', copies: 1, reason: 'этикетка намокла' });
    const log = await labelLog(cook.id, orgId, siteId, 1);
    const re = log.find((x) => x.reason)!;
    await expect(confirmReprint(cook.id, orgId, re.id, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(confirmReprint(chef.id, orgId, log.find((x) => !x.reason)!.id, {})).rejects.toThrow(/первая печать/);
    await confirmReprint(chef.id, orgId, re.id, { note: 'проверено' });
    await expect(confirmReprint(haccp.id, orgId, re.id, {})).rejects.toThrow(/уже подтверждена/);
    const j56 = await getJournal(owner.id, orgId, 'J56', P());
    expect(j56.rows.filter((r) => r[2] === lb.code).map((r) => r[7])).toEqual(['—', 'этикетка намокла']);
    const j57 = await getJournal(owner.id, orgId, 'J57', P());
    const row = j57.rows.find((r) => r[2] === 'этикетка намокла')!;
    expect(row[3]).toBe('без изменений');
    expect(row[5]).toMatch(/^.+, \d/);   // кто и когда подтвердил
  });

  it('J59 — суточная проба; J60 — показатель на строку, несоответствие с действием', async () => {
    const s = await getJournal(owner.id, orgId, 'J59', P());
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].slice(3, 7)).toEqual(['150 г', 'стерильная банка', '4 °C', 'Холодильник для проб']);
    expect(s.rows[0][8]).toBe('хранится');
    const l = await getJournal(owner.id, orgId, 'J60', P());
    expect(l.rows).toHaveLength(2);
    const bad = l.rows.find((r) => /Сальмонеллы/.test(r[1]))!;
    expect(bad[7]).toBe('не соответствует');
    expect(bad[8]).not.toBe('—');
    expect(l.blockers.length).toBeGreaterThan(0);   // открытое отклонение по лаборатории — подписать нельзя
  });
});

describe('Готовая продукция партией и продажа', () => {
  it('продажа блюда, выпущенного партией: сначала эта партия, сырьё — только на недостающее; без ownStock — как раньше', async () => {
    const dishProduct = (await withSystem((tx) => tx.query(`select product_id from dishes where id = $1`, [dish]))).rows[0].product_id;
    const one = await withSystem((tx) => explode(tx, orgId, dish, { portions: 1 }, { siteId, ownStock: true }));
    expect([...one.needs.values()].map((n) => [n.productId, Math.round(n.qty * 1000) / 1000])).toEqual([[dishProduct, 0.2]]);   // 200 г из партии 0,95 кг
    const many = await withSystem((tx) => explode(tx, orgId, dish, { portions: 6 }, { siteId, ownStock: true }));   // 1,2 кг > 0,95 кг
    const byId = new Map([...many.needs.values()].map((n) => [n.productId, Math.round(n.qty * 1000) / 1000]));
    expect(byId.get(dishProduct)).toBe(0.95);
    expect(byId.get(beef)).toBe(0.25);   // недостающие 250 г — по ТТК из сырья
    const raw = await withSystem((tx) => explode(tx, orgId, dish, { portions: 1 }, { siteId }));
    expect([...raw.needs.keys()]).toEqual([beef]);
  });
});

describe('Печатная форма и пропуски журналов', () => {
  it('реквизиты, код и редакция формы, основание, страницы, QR, хеш; пропуски замеров помечаются', async () => {
    const { createControlObject } = await import('../src/server/ops/control');
    const obj = await createControlObject(owner.id, orgId, { siteId, name: 'Холодильник мясной', kind: 'fridge' });
    // правило с частотой 12 ч, утверждённое три дня назад: за полностью прошедшие сутки нужно по 2 замера
    await withSystem((tx) => tx.query(`insert into control_rules (organization_id, control_object_id, parameter, unit, min_value, max_value, frequency_hours, grace_minutes, source_ref, reaction, status, version, created_by, approved_by, approved_at)
      values ($1, $2, 'temperature', '°C', 2, 6, 12, 30, 'СанПиН 2.3/2.4.4282-26, п. 35', 'incident', 'approved', 1, $3, $3, now() - interval '3 days')`, [orgId, obj.id, owner.id]));
    const { getJournal: gj, toHtml } = await import('../src/server/ops/journals');
    const j = await gj(owner.id, orgId, 'J01', { siteId, from: inDays(-2), to: inDays(0) });
    expect(j.gaps.length).toBeGreaterThanOrEqual(2);
    expect(j.gaps[0]).toMatch(/Холодильник мясной \(температура\): 0 из 2 замеров/);
    expect(j.form).toMatchObject({ version: '2026.11', basis: expect.arrayContaining(['СанПиН 2.3/2.4.4282-26, п. 35']) });
    const html = await toHtml(j);
    for (const s of ['Форма J01, редакция 2026.11', 'Основание: СанПиН 2.3/2.4.4282-26, п. 35', 'counter(pages)', '<svg', j.content_hash, 'Неполные данные — пропуски по графику', 'ИНН не указан'])
      expect(html).toContain(s);
  });
});

describe('Единая карточка продукта', () => {
  it('ТТК, ККТ при выпуске, журналы, история; недостающее — в «требует внимания», не «ок»', async () => {
    const { getProductCard } = await import('../src/server/ops/productCard');
    const c = await getProductCard(owner.id, orgId, semi);
    expect(c.ttk).toMatchObject({ version: 1 });
    expect(c.ccp.map((x) => x.name)).toEqual(['Температура фарша']);
    expect(c.journals.releases).toBe(1);
    expect(c.history.map((h) => h.status)).toEqual(['approved']);
    expect(c.documents.tu).toBeNull();
    expect(c.labeling.eac).toBe(false);
    expect(c.issues.join(' ')).toMatch(/Профиль аллергенов неполный/);
    expect(c.issues.join(' ')).toMatch(/Не указан вид сырья/);
    const stranger = await makeUser();
    await createOrganization(stranger, { name: 'Чужое' });
    await expect(getProductCard(stranger.id, orgId, semi)).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/) });
  });
});

describe('Рабочий экран смены', () => {
  it('состояние смены: партии, п/ф, пробы, незаполненные журналы; финансы и CAPA — только с правом', async () => {
    const { getShift } = await import('../src/server/ops/dashboard');
    const o = await getShift(owner.id, orgId, siteId);
    expect(o.status.semis).toMatchObject({ lots: 1 });
    expect(o.status.samples).toMatchObject({ today: 1 });
    expect(o.status.lots).toMatchObject({ quarantine: 0 });
    expect(o.status.finance).toBeDefined();
    expect(o.journals_due.map((j) => j.code)).toEqual(expect.arrayContaining(['J01', 'J07']));   // холодильник без замеров, осмотров нет
    const c = await getShift(cook.id, orgId, siteId);
    expect(c.status.finance).toBeUndefined();
    expect(c.status.capa).toBeUndefined();
  });
});

describe('Инспекционный пакет', () => {
  it('оглавление, версии документов, журналы с пропусками и редакцией, журнал формирования', async () => {
    const { buildPack } = await import('../src/server/ops/pack');
    const { inflateRawSync } = await import('node:zlib');
    const read = (buf: Buffer, name: string) => {
      let o = 0;
      while (buf.readUInt32LE(o) === 0x04034b50) {
        const m = buf.readUInt16LE(o + 8), size = buf.readUInt32LE(o + 18), nl = buf.readUInt16LE(o + 26), el = buf.readUInt16LE(o + 28);
        const n = buf.subarray(o + 30, o + 30 + nl).toString('utf8'), st = o + 30 + nl + el, data = buf.subarray(st, st + size);
        if (n === name) return (m === 8 ? inflateRawSync(data) : data).toString('utf8');
        o = st + size;
      }
      throw new Error(name);
    };
    const first = await buildPack(owner.id, orgId, P());
    const second = await buildPack(owner.id, orgId, P());
    const html = read(second.archive, 'index.html');
    for (const s of ['<h2>Содержание</h2>', '2. Утверждённые документы', '3. Журналы за период: подписи, пропуски', '9. Журнал формирования пакетов', first.sha256])
      expect(html).toContain(s);
    expect(html).toMatch(/<td>J54<\/td><td>Журнал вскрытия тары<\/td><td>2026\.11<\/td><td>1<\/td>/);
    expect(second.files).toEqual(expect.arrayContaining(['journals/J54.html', 'journals/J60.html', 'checksums.sha256']));
  });
});
