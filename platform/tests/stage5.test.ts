import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, createSite, inviteMember, acceptInvitation, listAudit } from '../src/server/org/organizations';
import { createProduct, createSupplier } from '../src/server/ops/catalog';
import { createControlObject, createRule, approveRule } from '../src/server/ops/control';
import { recordMeasurement } from '../src/server/ops/measurements';
import { takeIncident, recordIncidentAction, confirmIncident } from '../src/server/ops/incidents';
import { createReceipt, addReceiptLine, completeReceipt } from '../src/server/ops/receipts';
import { listForms, getJournal, signJournal, addEntry, correctEntry, listEntries, toCsv, toHtml, dataFormOf } from '../src/server/ops/journals';
import { makeUser, lastLinkToken } from './helpers';

afterAll(() => closePool());

type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, haccp: U, chef: U, cook: U, cook2: U, store: U, stranger: U;
let orgId: string, siteId: string, site2: string, fridgeId: string;

async function invite(role: string, siteIds: string[] = []) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role, siteIds });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}

const ALL_OK = { packaging: true, labeling: true, documents: true, quality: true };
const minutesAgo = (n: number) => new Date(Date.now() - n * 60e3).toISOString();
const inDays = (n: number) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
const P = () => ({ siteId, from: today, to: today });

beforeAll(async () => {
  owner = await makeUser({ name: 'Ольга Владелец' });
  const r = await createOrganization(owner, { name: 'Кафе «Журнал»' });
  orgId = r.organization.id; siteId = r.site.id;
  site2 = (await createSite(owner.id, orgId, { name: 'Вторая точка' })).id;
  haccp = await invite('haccp_lead');
  chef = await invite('chef');
  cook = await invite('line_staff', [siteId]);
  cook2 = await invite('line_staff', [site2]);
  store = await invite('storekeeper');
  stranger = await makeUser();
  await createOrganization(stranger, { name: 'Чужое кафе' });
  fridgeId = (await createControlObject(owner.id, orgId, { siteId, name: 'Холодильник №1 (мясо)', kind: 'fridge' })).id;
  const rule = await createRule(haccp.id, orgId, { controlObjectId: fridgeId, minValue: 2, maxValue: 6, frequencyHours: 4,
    sourceRef: 'Процедура ПК-03 «Контроль холодильного оборудования», п. 2', reaction: 'Повторить замер через 15 минут; при повторном отклонении — изолировать продукцию.', allowIsolation: true });
  await approveRule(haccp.id, orgId, rule.id);
});

describe('Перечень форм J01–J53 и семейства', () => {
  it('53 формы; автоматические — из событий; пары ручных форм — одни данные; сводные формы — свои записи', async () => {
    const forms = listForms();
    expect(forms).toHaveLength(53);
    expect(forms.filter((f) => f.mode === 'auto').map((f) => f.code).sort()).toEqual(['J01', 'J03', 'J04', 'J05', 'J07', 'J09', 'J10', 'J15', 'J16', 'J17', 'J18', 'J21', 'J25', 'J26', 'J29', 'J30', 'J31', 'J32', 'J34', 'J39', 'J42', 'J43']);
    expect(forms.find((f) => f.code === 'J40')).toMatchObject({ mode: 'manual', data_form: 'J02', shares_with: 'J02' });
    expect(dataFormOf('J02')).toBe('J02');
    expect(dataFormOf('J44')).toBe('J44');   // сводная: J07/J08/J27 — разные журналы, не склеиваются
    expect(dataFormOf('J07')).toBe('J07');
    expect(dataFormOf('J08')).toBe('J08');
  });
});

describe('Одна операция → все формы (ТЗ v2 §0, §12)', () => {
  it('замер температуры появляется в J01, J25 и месячной сетке J42; ручной ввод в эти журналы запрещён', async () => {
    await recordMeasurement(cook.id, orgId, { controlObjectId: fridgeId, value: 4.2 });
    await recordMeasurement(cook.id, orgId, { controlObjectId: fridgeId, value: '3,9', measuredAt: minutesAgo(40), comment: 'записано на бумаге' });
    const j01 = await getJournal(cook.id, orgId, 'J01', P());
    const j25 = await getJournal(cook.id, orgId, 'J25', P());
    const j42 = await getJournal(cook.id, orgId, 'J42', P());
    expect(j01.rows).toHaveLength(2);
    expect(j25.rows).toHaveLength(2);
    expect(j01.rows[0]).toEqual(expect.arrayContaining(['Холодильник №1 (мясо)', '3,9 °C', 'да']));
    expect(j01.rows[0].at(-1)).toMatch(/внесено позже/);
    expect(j01.rows[1][3]).toMatch(/2.*6/);
    expect(j42.grid).toBe(true);
    const day = String(Number(today.slice(8)));
    const col = j42.columns.indexOf(day);
    expect(j42.rows).toHaveLength(1);
    expect(j42.rows[0][col]).toBe('3,9/4,2');
    await expect(addEntry(cook.id, orgId, 'J01', { siteId, values: { 0: 'a', 1: 'b' } })).rejects.toThrow(/автоматически/);
  });

  it('приёмка — в J03, J21 и J39; партия — в J05 и J29', async () => {
    const productId = (await createProduct(store.id, orgId, { name: 'Говядина охлаждённая', unit: 'кг', category: 'мясо' })).id;
    const supplierId = (await createSupplier(store.id, orgId, { name: 'ООО «Мясной двор»', inn: '6670000000' })).id;
    const rec = await createReceipt(store.id, orgId, { siteId, supplierId, documentNo: 'УПД-17' });
    await addReceiptLine(store.id, orgId, rec.id, { productId, quantity: 12.5, lotNo: 'M-0412', expiresAt: inDays(5), expiryBasis: 'маркировка изготовителя', checks: ALL_OK, decision: 'accepted', storageObjectId: fridgeId, temperature: 3 });
    await completeReceipt(store.id, orgId, rec.id);
    for (const code of ['J03', 'J21', 'J39']) {
      const j = await getJournal(chef.id, orgId, code, P());
      expect(j.rows, code).toHaveLength(1);
      expect(j.rows[0].join(' '), code).toMatch(/Говядина охлаждённая.*ООО «Мясной двор»/);
    }
    expect((await getJournal(chef.id, orgId, 'J39', P())).rows[0].join(' ')).toMatch(/12,5 кг, партия M-0412/);
    for (const code of ['J05', 'J29']) expect((await getJournal(chef.id, orgId, code, P())).rows.some((r) => r.includes('M-0412')), code).toBe(true);
  });
});

describe('Подпись за период', () => {
  let incidentId: string;

  it('нельзя подписать при открытом отклонении периода; отклонение — в J34', async () => {
    const r = await recordMeasurement(cook.id, orgId, { controlObjectId: fridgeId, value: 9.1 });
    incidentId = r.incidentId!;
    const j = await getJournal(haccp.id, orgId, 'J01', P());
    expect(j.blockers).toHaveLength(1);
    expect(j.rows.at(-1)!.at(-1)).toMatch(/Новая|новая/i);
    await expect(signJournal(haccp.id, orgId, 'J01', { ...P(), contentHash: j.content_hash })).rejects.toThrow(/есть проблемы/);
    const j34 = await getJournal(haccp.id, orgId, 'J34', P());
    expect(j34.rows).toHaveLength(1);
    expect(j34.rows[0][2]).toBe('Температура вне предела');
  });

  it('после закрытия — подписывает ответственный; сотрудник не может; хеш устаревает при новой записи', async () => {
    await takeIncident(haccp.id, orgId, incidentId);
    await recordIncidentAction(haccp.id, orgId, incidentId, { note: 'Дверь была неплотно закрыта, уплотнитель заменён.' });
    await confirmIncident(chef.id, orgId, incidentId, { note: 'проверено на месте' });
    const j = await getJournal(haccp.id, orgId, 'J01', P());
    expect(j.blockers).toEqual([]);
    await expect(signJournal(cook.id, orgId, 'J01', { ...P(), contentHash: j.content_hash })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(signJournal(haccp.id, orgId, 'J01', { ...P(), contentHash: 'a'.repeat(64) })).rejects.toThrow(/изменился/);
    const s = await signJournal(haccp.id, orgId, 'J01', { ...P(), contentHash: j.content_hash, note: 'проверено' });
    expect(s.rows_count).toBe(j.rows.length);
    expect((await getJournal(haccp.id, orgId, 'J01', P())).signoffs[0]).toMatchObject({ valid: true });
    expect((await listAudit(owner.id, orgId, { limit: 200 })).some((e) => e.action === 'journal.sign')).toBe(true);

    await recordMeasurement(cook.id, orgId, { controlObjectId: fridgeId, value: 4 });
    const after = await getJournal(haccp.id, orgId, 'J01', P());
    expect(after.signoffs[0].valid).toBe(false);
    await expect(withSystem((tx) => tx.query(`delete from journal_signoffs where id = $1`, [s.id]))).rejects.toThrow(/нельзя/);
  });
});

describe('Ручные записи (ТЗ v2 §10, AT-11)', () => {
  it('запись J02 видна в J40; поздняя помечается; старше суток, в будущем и пустая — нельзя', async () => {
    const e = await addEntry(cook.id, orgId, 'J40', { siteId, values: { 0: today, 1: '12:30', 2: 'Борщ', 3: 'отлично', 9: 'лишний столбец' } });
    expect(e.form_code).toBe('J02');
    expect(e.values).not.toHaveProperty('9');
    const late = await addEntry(cook.id, orgId, 'J02', { siteId, occurredAt: minutesAgo(30), values: { 0: today, 2: 'Котлета' } });
    expect(late.is_late).toBe(true);
    await expect(addEntry(cook.id, orgId, 'J02', { siteId, occurredAt: minutesAgo(25 * 60), values: { 0: today, 2: 'X' } })).rejects.toThrow(/старше суток/);
    await expect(addEntry(cook.id, orgId, 'J02', { siteId, occurredAt: new Date(Date.now() + 3600e3).toISOString(), values: { 0: today, 2: 'X' } })).rejects.toThrow(/будущем/);
    await expect(addEntry(cook.id, orgId, 'J02', { siteId, values: { 0: today } })).rejects.toThrow(/два столбца/);
    const j02 = await getJournal(chef.id, orgId, 'J02', P());
    const j40 = await getJournal(chef.id, orgId, 'J40', P());
    expect(j40.rows).toEqual(j02.rows);
    expect(j40.columns).toEqual(j02.columns);
    expect(j02.rows).toHaveLength(2);
    expect(j02.rows[0].at(-1)).toMatch(/внесено/);
  });

  it('запись неизменяема; исправление — новой записью с причиной, в журнале последняя версия', async () => {
    const [e] = (await listEntries(cook.id, orgId, 'J02', siteId)).filter((x) => x.values['2'] === 'Борщ');
    await expect(withSystem((tx) => tx.query(`update journal_entries set values = '{}' where id = $1`, [e.id]))).rejects.toThrow(/нельзя изменить/);
    await expect(correctEntry(cook.id, orgId, e.id, { values: { 3: 'хорошо' }, reason: '' })).rejects.toMatchObject({ code: 'VALIDATION' });
    const fix = await correctEntry(cook.id, orgId, e.id, { values: { 3: 'хорошо' }, reason: 'ошибся оценкой' });
    expect(fix).toMatchObject({ corrects_id: e.id, form_code: 'J02' });
    expect(fix.values).toMatchObject({ 2: 'Борщ', 3: 'хорошо' });
    await expect(correctEntry(cook.id, orgId, e.id, { values: { 3: 'удовл.' }, reason: 'ещё раз' })).rejects.toMatchObject({ code: 'CONFLICT' });
    const rows = (await getJournal(chef.id, orgId, 'J02', P())).rows;
    expect(rows).toHaveLength(2);
    const borsch = rows.find((r) => r[2] === 'Борщ')!;
    expect(borsch[3]).toBe('хорошо');
    expect(borsch.at(-1)).toMatch(/исправлено: ошибся оценкой/);
  });
});

describe('Изоляция и выгрузка', () => {
  it('чужая организация и чужая точка журнал не видят', async () => {
    await expect(getJournal(stranger.id, orgId, 'J01', P())).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/) });
    await expect(getJournal(cook2.id, orgId, 'J01', P())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(addEntry(cook2.id, orgId, 'J02', { siteId, values: { 0: today, 2: 'X' } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await getJournal(owner.id, orgId, 'J01', { siteId: site2, from: today, to: today })).rows).toEqual([]);
    await expect(getJournal(owner.id, orgId, 'J99', P())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(getJournal(owner.id, orgId, 'J01', { siteId, from: today, to: inDays(-1) })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('CSV для Excel и печатная форма с экранированием', async () => {
    await addEntry(cook.id, orgId, 'J02', { siteId, values: { 0: today, 2: '<script>alert(1)</script>' } });
    const j = await getJournal(chef.id, orgId, 'J02', P());
    const csv = toCsv(j);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.split('\r\n')[0]).toContain(';');
    const html = toHtml(j);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain(j.content_hash);
  });
});
