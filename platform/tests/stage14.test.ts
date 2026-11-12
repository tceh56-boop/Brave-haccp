import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createProduct, createSupplier } from '../src/server/ops/catalog';
import { createReceipt, addReceiptLine, completeReceipt } from '../src/server/ops/receipts';
import { createDish, getDish, updateVersion, addLine, submitVersion, approveVersion } from '../src/server/ops/recipes';
import { createEvent, setItem, confirmEvent, completeEvent } from '../src/server/ops/planmenu';
import { listSamples, takeSample, destroySample, setSampleSettings, createProgram, archiveProgram, listLab, recordResult, getResult } from '../src/server/ops/lab';
import { getProblems } from '../src/server/ops/dashboard';
import { listTasks } from '../src/server/ops/tasks';
import { makeUser, lastLinkToken } from './helpers';

afterAll(() => closePool());

type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, chef: U, cook: U, haccp: U, cashier: U, stranger: U;
let orgId: string, siteId: string, soup: string, salad: string, eventId: string;
const ALL_OK = { packaging: true, labeling: true, documents: true, quality: true };
const inDays = (n: number) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
const mskDay = (n: number) => new Date(Date.now() + n * 86400e3).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
const today = mskDay(0);
const sample = (extra: Record<string, unknown>) => ({ siteId, source: 'event', eventId, container: 'стерильная банка с крышкой, маркировка', storagePlace: 'Холодильник для проб', temperature: 4, ...extra });

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}
async function dish(name: string, productId: string) {
  const d = await createDish(chef.id, orgId, { name, salePrice: 200 });
  const v = (await getDish(chef.id, orgId, d.id)).current!.version.id;
  await updateVersion(chef.id, orgId, v, { yieldG: 250, portionG: 250, technology: 'Приготовить по технологии предприятия.', storageConditions: '+2…+6 °C', shelfLife: '2 часа' });
  await addLine(chef.id, orgId, v, { productId, unit: 'кг', brutto: 0.1, netto: 0.1 });
  await submitVersion(chef.id, orgId, v); await approveVersion(chef.id, orgId, v);
  return d.id as string;
}

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Кафе «Пробы»' });
  orgId = r.organization.id; siteId = r.site.id;
  chef = await invite('chef'); cook = await invite('line_staff'); haccp = await invite('haccp_lead'); cashier = await invite('cashier');
  stranger = await makeUser(); await createOrganization(stranger, { name: 'Чужое кафе' });
  const potato = (await createProduct(chef.id, orgId, { name: 'Картофель', unit: 'кг' })).id;
  const supplierId = (await createSupplier(chef.id, orgId, { name: 'ООО «Овощи»' })).id;
  const rc = await createReceipt(cook.id, orgId, { siteId, supplierId });
  await addReceiptLine(cook.id, orgId, rc.id, { productId: potato, quantity: 10, unitPrice: 30, lotNo: 'К-1', expiresAt: inDays(10), expiryBasis: 'маркировка изготовителя', checks: ALL_OK, decision: 'accepted' });
  await completeReceipt(cook.id, orgId, rc.id);
  soup = await dish('Суп картофельный', potato);
  salad = await dish('Салат картофельный', potato);
  const e = await createEvent(chef.id, orgId, { siteId, title: 'Обед группы', eventDate: today, guests: 10 });
  eventId = e.id;
  await setItem(chef.id, orgId, eventId, { dishId: soup, perGuest: 1 });
  await setItem(chef.id, orgId, eventId, { dishId: salad, perGuest: 1 });
});

describe('Этап 14: суточные пробы', () => {
  it('параметры по умолчанию — с пометкой «проверьте»; утверждает ХАССП с основанием, не шеф', async () => {
    const l = await listSamples(cook.id, orgId, siteId);
    expect(l.settings).toMatchObject({ min_weight_g: 100, retention_hours: 48, t_min: 2, t_max: 6, confirmed: false });
    await expect(setSampleSettings(chef.id, orgId, { minWeightG: 100, retentionHours: 48, tMin: 2, tMax: 6, basis: 'СанПиН' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(setSampleSettings(haccp.id, orgId, { minWeightG: 100, retentionHours: 48, tMin: 6, tMax: 2, basis: 'СанПиН 2.3/2.4.3590-20' })).rejects.toThrow(/Нижняя/);
    const s = await setSampleSettings(haccp.id, orgId, { minWeightG: '120', retentionHours: 48, tMin: 2, tMax: 6, basis: 'СанПиН 2.3/2.4.3590-20; программа ПК, п. 5' });
    expect(s).toMatchObject({ min_weight_g: 120, confirmed: true });
    await expect(listSamples(cashier.id, orgId, siteId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(listSamples(stranger.id, orgId, siteId)).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/) });
  });

  it('проба — по подтверждённому мероприятию; масса, тара, температура проверяются; дубль не принимается', async () => {
    await expect(takeSample(cook.id, orgId, sample({ dishId: soup, weightG: 150 }))).rejects.toThrow(/подтверждённому/);
    await confirmEvent(chef.id, orgId, eventId);
    expect((await listSamples(cook.id, orgId, siteId)).missing.map((x) => x.dish)).toEqual(['Салат картофельный', 'Суп картофельный']);
    const cards = (await getProblems(chef.id, orgId, siteId)).cards;
    expect(cards.find((c) => c.key === `sample:${eventId}`)).toMatchObject({ title: 'Нет суточной пробы: мероприятие № 1' });
    await expect(takeSample(cook.id, orgId, sample({ dishId: soup, weightG: 100 }))).rejects.toThrow(/не менее 120 г/);
    await expect(takeSample(cook.id, orgId, sample({ dishId: soup, weightG: 150, temperature: '8,5' }))).rejects.toThrow(/вне 2…6/);
    await expect(takeSample(cook.id, orgId, sample({ dishId: soup, weightG: 150, container: '' }))).rejects.toThrow(/тару/);
    const t = await takeSample(cook.id, orgId, sample({ dishId: soup, weightG: '150' }));
    const hours = (new Date(t.keep_until).getTime() - Date.now()) / 3600e3;
    expect(hours).toBeGreaterThan(47.9); expect(hours).toBeLessThanOrEqual(48);
    await expect(takeSample(cook.id, orgId, sample({ dishId: soup, weightG: 150 }))).rejects.toThrow(/уже отобрана/);
    await expect(withSystem((tx) => tx.query(`update daily_samples set temperature = 3 where id = $1`, [t.id]))).rejects.toThrow(/не изменяются/);
  });

  it('без пробы по каждому поданному блюду мероприятие не закрыть', async () => {
    await expect(completeEvent(chef.id, orgId, eventId, { operationId: randomUUID() })).rejects.toThrow(/Нет суточной пробы: Салат картофельный/);
    // салат не подавали — проба по нему не нужна
    expect(await completeEvent(chef.id, orgId, eventId, { operationId: randomUUID(), actual: [{ dishId: salad, portions: 0 }] })).toMatchObject({ status: 'done' });
  });

  it('уничтожение — не раньше срока, один раз', async () => {
    const l = await listSamples(cook.id, orgId, siteId);
    expect(l.stored).toHaveLength(1);
    expect(l.stored[0]).toMatchObject({ status: 'stored', weight_g: 150, temperature: 4, taken_by: expect.any(String) });
    await expect(destroySample(cook.id, orgId, l.stored[0].id, {})).rejects.toThrow(/не истёк/);
    // проба смены с истёкшим сроком (вставка задним числом — только для теста)
    const old = (await withSystem((tx) => tx.query(`insert into daily_samples (organization_id, site_id, source, dish_id, title, weight_g, container, storage_place, temperature, basis, taken_by, taken_at, keep_until)
      values ($1, $2, 'dish', $3, 'Суп картофельный', 150, 'банка', 'Холодильник для проб', 4, 'тест', $4, now() - interval '3 days', now() - interval '1 day 1 hour') returning id`, [orgId, siteId, soup, cook.id]))).rows[0].id;
    expect((await getProblems(chef.id, orgId, siteId)).cards.find((c) => c.key === 'sample:due')).toMatchObject({ title: 'Пробы не уничтожены по сроку: 1' });
    await destroySample(cook.id, orgId, old, { note: 'уничтожена по истечении срока' });
    await expect(destroySample(cook.id, orgId, old, {})).rejects.toThrow(/уже уничтожена/);
    const after = await listSamples(cook.id, orgId, siteId);
    expect(after.destroyed.map((x) => x.id)).toEqual([old]);
  });
});

describe('Этап 14: лабораторный контроль', () => {
  let progId: string;
  it('программа: основание обязательно; ведёт ХАССП, повар не может', async () => {
    await expect(createProgram(haccp.id, orgId, { siteId, testType: 'Микробиология готовых блюд', target: 'Салаты', periodDays: 90, nextDue: today, basis: '' })).rejects.toThrow(/основание/);
    await expect(createProgram(cook.id, orgId, { siteId, testType: 'Микробиология', target: 'Салаты', periodDays: 90, nextDue: today, basis: 'Программа ПК, п. 7' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    progId = (await createProgram(haccp.id, orgId, { siteId, testType: 'Микробиология готовых блюд', target: 'Салаты', dishId: salad, periodDays: 90, retestDays: 7, nextDue: mskDay(-2), basis: 'Программа ПК, п. 7' })).id;
    const l = await listLab(chef.id, orgId, siteId);
    expect(l.programs[0]).toMatchObject({ id: progId, overdue: true, last: null });
    expect((await getProblems(haccp.id, orgId, siteId)).cards.find((c) => c.key === `lab:${progId}`)).toMatchObject({ title: 'Просрочено исследование: Микробиология готовых блюд' });
    await expect(listLab(cashier.id, orgId, siteId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('итог — по показателям; без показателей — по протоколу; «соответствует» сдвигает срок на периодичность', async () => {
    const base = { siteId, programId: progId, labName: 'ИЛЦ ФБУЗ «Центр гигиены»', protocolNo: '123/24', sampledOn: mskDay(-1), resultOn: today };
    await expect(recordResult(haccp.id, orgId, base)).rejects.toThrow(/итог/);
    await expect(recordResult(haccp.id, orgId, { ...base, result: 'pass', params: [{ name: 'КМАФАнМ', norm: '≤ 1×10⁴ КОЕ/г', fact: '5×10⁵', pass: false }] })).rejects.toThrow(/не совпадает/);
    const ok = await recordResult(haccp.id, orgId, { ...base, params: [{ name: 'КМАФАнМ', norm: '≤ 1×10⁴ КОЕ/г', fact: '2×10³', unit: 'КОЕ/г', pass: true }, { name: 'БГКП', norm: 'не допускаются в 0,1 г', fact: 'не обнаружены', pass: true }] });
    expect(ok).toMatchObject({ result: 'pass', incident_id: null });
    const [y, mo, dd] = mskDay(-1).split('-').map(Number);
    expect(ok.next_due).toBe(new Date(Date.UTC(y, mo - 1, dd + 90)).toISOString().slice(0, 10));
    expect((await listLab(chef.id, orgId, siteId)).programs[0]).toMatchObject({ overdue: false, last: { result: 'pass', protocol_no: '123/24' } });
    expect((await getResult(chef.id, orgId, ok.id)).params).toHaveLength(2);
    await expect(getResult(cook.id, orgId, ok.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(withSystem((tx) => tx.query(`delete from lab_results where id = $1`, [ok.id]))).rejects.toThrow(/не изменяются/);
  });

  it('«не соответствует»: заключение обязательно; отклонение, задача на повторный отбор, срок — через дни повтора', async () => {
    const base = { siteId, programId: progId, labName: 'ИЛЦ ФБУЗ «Центр гигиены»', protocolNo: '140/24', sampledOn: mskDay(-1), resultOn: today,
      params: [{ name: 'БГКП', norm: 'не допускаются в 0,1 г', fact: 'обнаружены', pass: false }] };
    await expect(recordResult(haccp.id, orgId, base)).rejects.toThrow(/заключение/);
    const bad = await recordResult(haccp.id, orgId, { ...base, conclusion: 'Не соответствует ТР ТС 021/2011 по БГКП' });
    expect(bad.result).toBe('fail');
    const [y, mo, dd] = today.split('-').map(Number);
    expect(bad.next_due).toBe(new Date(Date.UTC(y, mo - 1, dd + 7)).toISOString().slice(0, 10));
    const inc = (await withSystem((tx) => tx.query(`select kind, severity, title, what, entity_type, responsible_role from incidents where id = $1`, [bad.incident_id]))).rows[0];
    expect(inc).toMatchObject({ kind: 'lab_fail', severity: 'high', title: 'Не соответствует: Микробиология готовых блюд', entity_type: 'lab_result', responsible_role: 'haccp_lead' });
    expect(inc.what).toMatch(/БГКП: обнаружены при норме не допускаются/);
    expect((await listTasks(haccp.id, orgId, { siteId })).some((t: { kind: string }) => t.kind === 'lab_retest')).toBe(true);
    const free = await recordResult(haccp.id, orgId, { siteId, testType: 'Смывы на БГКП', target: 'Разделочные доски', labName: 'ИЛЦ', protocolNo: '7', sampledOn: today, resultOn: today, result: 'pass' });
    expect(free.next_due).toBeNull();
    await archiveProgram(haccp.id, orgId, progId, { reason: 'исключено из программы ПК' });
    expect((await listLab(chef.id, orgId, siteId)).programs).toHaveLength(0);
    const audit = (await withSystem((tx) => tx.query(`select action from audit_events where organization_id = $1 and (action like 'lab.%' or action like 'sample.%')`, [orgId]))).rows.map((a) => a.action);
    expect(audit).toEqual(expect.arrayContaining(['sample.settings', 'sample.take', 'sample.destroy', 'lab.program_create', 'lab.result', 'lab.program_archive']));
  });
});
