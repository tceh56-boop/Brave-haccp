import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createProduct, createSupplier } from '../src/server/ops/catalog';
import { createReceipt, addReceiptLine, completeReceipt } from '../src/server/ops/receipts';
import { writeOff } from '../src/server/ops/stock';
import { addExpense } from '../src/server/ops/finance';
import { econReport, setBudget, REPORTS } from '../src/server/ops/econReports';
import { tableCsv, tableXlsx, tableHtml } from '../src/server/ops/tableExport';
import { makeUser, lastLinkToken } from './helpers';

/** Управленческие отчёты P2 (ТЗ доработки, 9.4–9.5): неизвестная цена — не ноль; экспорт CSV, XLSX, печатная форма. */

afterAll(() => closePool());
type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, acc: U, cook: U, chef: U, orgId: string, siteId: string;
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
const P = (kind: string) => ({ kind, from: new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10), to: today() });

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}
async function receive(supplier: string, product: string, qty: number, price: number | null, no: string) {
  const rc = await createReceipt(cook.id, orgId, { siteId, supplierId: supplier });
  await addReceiptLine(cook.id, orgId, rc.id, { productId: product, quantity: qty, unitPrice: price, lotNo: no, expiresAt: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10),
    expiryBasis: 'маркировка изготовителя', checks: { packaging: true, labeling: true, documents: true, quality: true }, decision: 'accepted' });
  await completeReceipt(cook.id, orgId, rc.id);
  return (await withSystem((tx) => tx.query(`select id from lots where lot_no = $1 and organization_id = $2`, [no, orgId]))).rows[0].id as string;
}
async function sale(qty: number, price: number, cost: number | null, source = 'pos') {
  await withSystem((tx) => tx.query(`insert into sales (organization_id, site_id, source, external_id, name, qty, price, amount, sold_at, fulfil_status, cost) values ($1, $2, $3, $4, 'Борщ', $5, $6, $7, now(), $8, $9)`,
    [orgId, siteId, source, randomUUID(), qty, price, qty * price, cost === null && qty > 0 ? 'pending' : qty < 0 ? 'not_required' : 'done', cost]));
}

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Кафе «Отчёты»', legalForm: 'ООО', inn: '7700000099' });
  orgId = r.organization.id; siteId = r.site.id;
  acc = await invite('accountant'); cook = await invite('line_staff'); chef = await invite('chef');
  const beef = (await createProduct(chef.id, orgId, { name: 'Говядина', unit: 'кг' })).id;
  const milk = (await createProduct(chef.id, orgId, { name: 'Молоко', unit: 'л' })).id;
  const s1 = (await createSupplier(chef.id, orgId, { name: 'ООО «Мясо»' })).id, s2 = (await createSupplier(chef.id, orgId, { name: 'ООО «Молоко»' })).id;
  await receive(s1, beef, 10, 500, 'Г-1');
  await receive(s1, beef, 10, 550, 'Г-2');
  const milkLot = await receive(s2, milk, 20, null, 'М-1');      // без цены
  await writeOff(chef.id, orgId, { lotId: milkLot, quantity: 2, reasonCode: 'spoiled', operationId: randomUUID() });
  await sale(10, 300, 900); await sale(2, 300, null); await sale(-1, 300, null); await sale(5, 200, 400, 'iiko');
  await addExpense(acc.id, orgId, { category: 'payroll', kind: 'once', date: today(), amount: 1000, title: 'ФОТ' });
  await setBudget(acc.id, orgId, { month: today().slice(0, 7), item: 'revenue', amount: 310000 });
});

describe('Управленческие отчёты', () => {
  it('все виды строятся; бухгалтер видит, повар — нет', async () => {
    for (const k of Object.keys(REPORTS)) {
      const r = await econReport(acc.id, orgId, P(k));
      expect(r.table.title).toBe(REPORTS[k as keyof typeof REPORTS]);
      expect(r.note).toMatch(/^Отчет управленческий/);
    }
    await expect(econReport(cook.id, orgId, P('stock_value'))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('склад в рублях и закупки: партия без цены не считается нулём, а показана отдельно', async () => {
    const st = (await econReport(acc.id, orgId, P('stock_value'))).table;
    expect(st.totals).toMatchObject({ value: 10500, unpriced: 1 });
    expect(st.notes!.join(' ')).toMatch(/без цены: 1 — их стоимость не включена/);
    const pu = (await econReport(acc.id, orgId, P('purchases'))).table;
    expect(pu.rows.map((r) => [r.supplier, r.amount, r.unpriced])).toEqual([['ООО «Мясо»', 10500, 0], ['ООО «Молоко»', null, 1]]);
    const pc = (await econReport(acc.id, orgId, P('price_changes'))).table;
    expect(pc.rows[0]).toMatchObject({ name: 'Говядина', first: 500, last: 550, change: 10 });
  });

  it('потери по причинам; каналы; план-факт; ДДС и задолженность — честно о том, чего нет', async () => {
    const lo = (await econReport(acc.id, orgId, P('losses'))).table;
    expect(lo.rows[0]).toMatchObject({ reason: 'Порча (признаки порчи)', cnt: 1, unpriced: 1 });
    const ch = (await econReport(acc.id, orgId, P('channels'))).table;
    const pos = ch.rows.find((r) => r.name === 'Касса ЦЕХ (зал, вынос)')!;
    expect(pos).toMatchObject({ gross: 3600, returns: 300, net: 3300, gross_profit: null, uncosted: 1 });
    expect(ch.rows.find((r) => r.name === 'iiko (импорт)')).toMatchObject({ net: 1000, gross_profit: 600 });
    const pf = (await econReport(acc.id, orgId, P('plan_fact'))).table;
    const rev = pf.rows.find((r) => r.item === 'Чистая выручка')!;
    expect(rev.fact).toBe(4300);
    expect(Number(rev.plan)).toBeGreaterThan(0);
    const cf = (await econReport(acc.id, orgId, P('cash_flow'))).table;
    expect(cf.notes!.join(' ')).toMatch(/Оплаты поставщикам в системе не ведутся/);
    const de = (await econReport(acc.id, orgId, P('debts'))).table;
    expect(de.rows.every((r) => /не ведётся/.test(String(r.value)))).toBe(true);
    const co = (await econReport(acc.id, orgId, P('completeness'))).table;
    expect(co.rows.map((r) => r.text).join(' | ')).toMatch(/партии без цены/);
  });

  it('экспорт: CSV с BOM и запятой, XLSX — корректный пакет с листом, печатная форма с реквизитами', async () => {
    const r = await econReport(acc.id, orgId, P('purchases'));
    const csv = tableCsv(r.table);
    expect(csv.startsWith('﻿"Поставщик";')).toBe(true);
    expect(csv).toContain('"10500"');
    const x = tableXlsx(r.table, r.org, r.subtitle);
    const names: string[] = []; let sheet = ''; let o = 0;
    while (x.readUInt32LE(o) === 0x04034b50) {
      const m = x.readUInt16LE(o + 8), size = x.readUInt32LE(o + 18), nl = x.readUInt16LE(o + 26), el = x.readUInt16LE(o + 28);
      const n = x.subarray(o + 30, o + 30 + nl).toString('utf8'), st = o + 30 + nl + el, data = x.subarray(st, st + size);
      names.push(n); if (n === 'xl/worksheets/sheet1.xml') sheet = (m === 8 ? inflateRawSync(data) : data).toString('utf8');
      o = st + size;
    }
    expect(names).toEqual(expect.arrayContaining(['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/styles.xml']));
    expect(sheet).toContain('ИНН 7700000099');
    expect(sheet).toMatch(/<c r="D\d+" s="2"><v>10500<\/v><\/c>/);   // сумма — числом в денежном формате
    const html = tableHtml(r.table, r.org, r.subtitle, r.generated);
    expect(html).toContain('ООО «Кафе «Отчёты»», ИНН 7700000099');
    expect(html).toContain('Отчет управленческий. Не является бухгалтерской или налоговой отчетностью.');
  });
});
