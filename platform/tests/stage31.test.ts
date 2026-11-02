import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createProduct, createSupplier } from '../src/server/ops/catalog';
import { createReceipt, addReceiptLine, completeReceipt } from '../src/server/ops/receipts';
import { listIntegrations, saveIntegration, setIntegrationEnabled, parseFiscalQr, attachFiscalQr } from '../src/server/ops/integrations';
import { makeUser, lastLinkToken } from './helpers';

/** Интеграции P3: секреты только шифротекстом; обмен без спецификации не включается; QR кассового чека в приёмке. */

afterAll(() => closePool());
type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, cook: U, chef: U, orgId: string, siteId: string, beef: string, sup: string;
const QR = 't=20261101T1530&s=1050.00&fn=7380440700012345&i=4321&fp=1234567890&n=1';

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}
async function draft(price: number) {
  const rc = await createReceipt(cook.id, orgId, { siteId, supplierId: sup, documentNo: 'ЧЕК-1', documentDate: '2026-11-01' });
  await addReceiptLine(cook.id, orgId, rc.id, { productId: beef, quantity: 2, unitPrice: price, lotNo: `Г-${Math.random()}`, expiresAt: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10),
    expiryBasis: 'маркировка изготовителя', checks: { packaging: true, labeling: true, documents: true, quality: true }, decision: 'accepted' });
  return rc.id as string;
}

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Кафе «Интеграции»' });
  orgId = r.organization.id; siteId = r.site.id;
  cook = await invite('line_staff'); chef = await invite('chef');
  beef = (await createProduct(chef.id, orgId, { name: 'Говядина', unit: 'кг' })).id;
  sup = (await createSupplier(chef.id, orgId, { name: 'ИП Мясник' })).id;
});

describe('Каркас интеграций', () => {
  it('статусы честные: готово / нужны доступы / нет спецификации; настраивает только владелец', async () => {
    const l = await listIntegrations(owner.id, orgId);
    const st = Object.fromEntries(l.systems.map((s) => [s.code, s.state]));
    expect(st).toMatchObject({ kkt_qr: 'ready', sales_csv: 'ready', mercury: 'needs_access', iiko_api: 'needs_spec', edo_upd: 'needs_spec', bank: 'needs_spec' });
    await expect(listIntegrations(chef.id, orgId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('секрет без ключа шифрования не сохраняется; с ключом — только шифротекст, наружу — лишь «задан»', async () => {
    delete process.env.CEH_SECRET_KEY;
    await expect(saveIntegration(owner.id, orgId, 'mercury', { secrets: { password: 'сек-рет' } })).rejects.toThrow(/CEH_SECRET_KEY/);
    process.env.CEH_SECRET_KEY = randomBytes(32).toString('base64');
    const r = await saveIntegration(owner.id, orgId, 'mercury', { settings: { environment: 'test', issuer_id: 'guid-1' }, secrets: { password: 'сек-рет', api_key: 'KEY-123' } });
    expect(r.secrets_set.sort()).toEqual(['api_key', 'password']);
    const row = (await withSystem((tx) => tx.query(`select secret from integrations where organization_id = $1 and system = 'mercury'`, [orgId]))).rows[0];
    expect(row.secret).not.toContain('KEY-123');
    expect(row.secret).not.toContain('сек-рет');
    const l = await listIntegrations(owner.id, orgId);
    expect(JSON.stringify(l)).not.toContain('KEY-123');
    expect(l.systems.find((s) => s.code === 'mercury')).toMatchObject({ secrets_set: ['password', 'api_key'], settings_values: { environment: 'test', issuer_id: 'guid-1' } });
    await expect(saveIntegration(owner.id, orgId, 'mercury', { settings: { url: 'x' } })).rejects.toThrow(/Неизвестные параметры/);
  });

  it('обмен без проверенной спецификации или доступов не включается — с записью в журнал', async () => {
    await expect(setIntegrationEnabled(owner.id, orgId, 'iiko_api', true)).rejects.toThrow(/нет подтверждённой спецификации/);
    await expect(setIntegrationEnabled(owner.id, orgId, 'mercury', true)).rejects.toThrow(/проверка обмена на тестовом контуре/);
    await setIntegrationEnabled(owner.id, orgId, 'kkt_qr', true);
    const l = await listIntegrations(owner.id, orgId);
    expect(l.events.map((e) => [e.system, e.status])).toEqual(expect.arrayContaining([['iiko_api', 'skipped'], ['kkt_qr', 'ok']]));
  });
});

describe('QR кассового чека в приёмке', () => {
  it('разбор строки QR: дата, сумма, ФН/ФД/ФП, признак расчёта', () => {
    expect(parseFiscalQr(QR)).toMatchObject({ datetime: '2026-11-01T15:30', total: 1050, fn: '7380440700012345', fd: '4321', fp: '1234567890', operation: '1', valid: true });
    expect(parseFiscalQr('https://check.ofd.ru/?t=20261101T1530&s=10').valid).toBe(false);
  });

  it('сверка с приёмкой; повтор чека в другой проведённой приёмке — проводка заблокирована', async () => {
    const a = await draft(525);
    expect(await attachFiscalQr(cook.id, orgId, a, { qr: QR })).toMatchObject({ status: 'match', warnings: [] });
    await completeReceipt(cook.id, orgId, a);
    const b = await draft(500);
    const x = await attachFiscalQr(cook.id, orgId, b, { qr: QR });
    expect(x.status).toBe('duplicate');
    expect(x.warnings.join(' ')).toMatch(/Сумма по QR 1050 ₽, по строкам приёмки 1000 ₽/);
    await expect(completeReceipt(cook.id, orgId, b)).rejects.toThrow(/уже проведён в другой приёмке/);
    const ret = await attachFiscalQr(cook.id, orgId, await draft(525), { qr: QR.replace('n=1', 'n=2').replace('i=4321', 'i=9999') });
    expect(ret.warnings.join(' ')).toMatch(/возврат прихода/);
  });
});
