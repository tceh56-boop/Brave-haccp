import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createProduct, createSupplier } from '../src/server/ops/catalog';
import { createReceipt, addReceiptLine, completeReceipt } from '../src/server/ops/receipts';
import { createControlObject } from '../src/server/ops/control';
import { saveProfile } from '../src/server/ops/regulatory';
import { getCompliance } from '../src/server/ops/compliance';
import { getJournal } from '../src/server/ops/journals';
import { getLot } from '../src/server/ops/lots';
import { openLot, createLabels, getLabels } from '../src/server/ops/labels';
import { getPpk, getPpkVersion } from '../src/server/ops/ppk';
import { pnl } from '../src/server/ops/finance';
import { previewConsumerLabel } from '../src/server/ops/consumerLabels';
import { validateEnterpriseReadiness } from '../src/server/readiness/engine';
import { makeUser, lastLinkToken } from './helpers';

/** P0 ТЗ доработки: ручные измерения не создаются системой; вскрытие тары; изоляция организаций. */

afterAll(() => closePool());
type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, cook: U, stranger: U;
let orgId: string, siteId: string, strangerOrg: string, lotId: string, labelId: string;
const inDays = (n: number) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
const count = async (sql: string) => Number((await withSystem((tx) => tx.query(sql, [orgId]))).rows[0].n);
const period = { from: inDays(-7), to: inDays(0) };

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Кафе «Изоляция»' });
  orgId = r.organization.id; siteId = r.site.id;
  cook = await makeUser();
  await inviteMember(owner.id, orgId, { email: cook.email, role: 'line_staff' });
  await acceptInvitation(cook, await lastLinkToken(cook.email, 'invitation'));
  stranger = await makeUser();
  strangerOrg = (await createOrganization(stranger, { name: 'Чужое кафе' })).organization.id;
  await createControlObject(owner.id, orgId, { siteId, name: 'Холодильник 1', kind: 'fridge' });
  const cream = (await createProduct(owner.id, orgId, { name: 'Сливки 33%', unit: 'л' })).id;
  const sup = (await createSupplier(owner.id, orgId, { name: 'ООО «Молоко»' })).id;
  const rc = await createReceipt(owner.id, orgId, { siteId, supplierId: sup });
  await addReceiptLine(owner.id, orgId, rc.id, { productId: cream, quantity: 2, unitPrice: 300, lotNo: 'С-1', expiresAt: inDays(3), expiryBasis: 'маркировка изготовителя',
    checks: { packaging: true, labeling: true, documents: true, quality: true }, decision: 'accepted' });
  await completeReceipt(owner.id, orgId, rc.id);
  lotId = (await withSystem((tx) => tx.query(`select id from lots where product_id = $1`, [cream]))).rows[0].id;
  labelId = (await createLabels(owner.id, orgId, { lotIds: [lotId] }))[0].id;
});

describe('Ручные измерения и фритюр не создаются автоматически', () => {
  it('проверки, журналы и «Готов ли я к проверке» не создают температур и записей фритюра', async () => {
    await saveProfile(owner.id, orgId, { objectTypes: ['cafe'], features: ['fryer'] });
    const m0 = await count(`select count(*)::int as n from measurements where organization_id = $1`);
    const j0 = await count(`select count(*)::int as n from journal_entries where organization_id = $1`);
    await withSystem((tx) => validateEnterpriseReadiness(tx, orgId));
    await getCompliance(owner.id, orgId);
    for (const code of ['J01', 'J25', 'J42', 'J38', 'J41']) await getJournal(owner.id, orgId, code, { siteId, ...period });
    expect(await count(`select count(*)::int as n from measurements where organization_id = $1`)).toBe(m0);
    expect(await count(`select count(*)::int as n from journal_entries where organization_id = $1`)).toBe(j0);
    const r = await withSystem((tx) => validateEnterpriseReadiness(tx, orgId, null, { keys: ['daily_temps', 'fryer'] }));
    expect(r.items.map((i) => i.status)).toEqual(['incomplete', 'missing']);   // пропуск виден, но не заполнен за человека
  });
});

describe('Вскрытие тары', () => {
  it('больше остатка — нельзя; срок после вскрытия не позже срока изготовителя; повторно — нельзя', async () => {
    await expect(openLot(cook.id, orgId, lotId, { quantity: 3, hours: 48, basis: 'маркировка: после вскрытия 48 ч', operationId: randomUUID() })).rejects.toThrow(/вскрыть больше нельзя/);
    const r = await openLot(cook.id, orgId, lotId, { quantity: 1, hours: 1000, basis: 'маркировка: после вскрытия 1000 ч', operationId: randomUUID() });
    const maker = (await withSystem((tx) => tx.query(`select expires_at from lots where id = $1`, [lotId]))).rows[0].expires_at;
    expect(new Date(r.expires_at).getTime()).toBe(new Date(maker).getTime());
    expect(r.expiry_basis).toMatch(/срок изготовителя наступает раньше/);
    await expect(openLot(cook.id, orgId, r.lot_id, { hours: 24, basis: 'маркировка изготовителя', operationId: randomUUID() })).rejects.toThrow(/уже вскрыта/);
    const links = (await withSystem((tx) => tx.query(`select kind, quantity from lot_links where child_lot_id = $1`, [r.lot_id]))).rows;
    expect(links).toEqual([{ kind: 'opened', quantity: '1' }]);
  });
});

describe('Изоляция организаций', () => {
  const denied = { code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/) };
  it('чужой пользователь не получает ППК, журнал, этикетку, партию, финансы', async () => {
    await expect(getPpk(stranger.id, orgId)).rejects.toMatchObject(denied);
    await expect(getPpkVersion(stranger.id, orgId, 1)).rejects.toMatchObject(denied);
    await expect(getJournal(stranger.id, orgId, 'J01', { siteId, ...period })).rejects.toMatchObject(denied);
    await expect(getLabels(stranger.id, orgId, [labelId])).rejects.toMatchObject(denied);
    await expect(getLot(stranger.id, orgId, lotId)).rejects.toMatchObject(denied);
    await expect(pnl(stranger.id, orgId, period)).rejects.toMatchObject(denied);
    await expect(previewConsumerLabel(stranger.id, orgId, lotId)).rejects.toMatchObject(denied);
  });

  it('UUID чужого объекта в своей организации — не находится', async () => {
    await expect(getLot(stranger.id, strangerOrg, lotId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await getLabels(stranger.id, strangerOrg, [labelId])).toEqual([]);
    await expect(previewConsumerLabel(stranger.id, strangerOrg, lotId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
