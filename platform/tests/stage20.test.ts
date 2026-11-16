import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createContract, updateContract, terminateContract, listContracts, getContract } from '../src/server/ops/contracts';
import { addEvidence, listEvidence, getEvidenceFile } from '../src/server/ops/evidence';
import { getReadiness } from '../src/server/ops/readiness';
import { makeUser, lastLinkToken } from './helpers';

/** Договоры для ППК: реквизиты, файлы (PDF/DOCX), срок и задача продления, расторжение, готовность. */

afterAll(() => closePool());

type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, acc: U, cook: U, orgId: string, siteId: string;
const PDF = Buffer.from('%PDF-1.4\n% договор\n');
// минимальный ZIP-заголовок с частями DOCX (сигнатура проверяется по содержимому)
const DOCX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(26), Buffer.from('[Content_Types].xml'), Buffer.from('word/document.xml')]);
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(26), Buffer.from('readme.txt')]);
const addDays = (n: number) => { const t = new Date(); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}
const tasksOf = (id: string) => withSystem(async (tx) => (await tx.query(`select status, due_at, title from tasks where entity_id = $1 and kind = 'contract_renew' order by created_at`, [id])).rows);

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Кафе «Договоры»' });
  orgId = r.organization.id; siteId = r.site.id;
  acc = await invite('accountant'); cook = await invite('line_staff');
});

describe('Договоры', () => {
  let pest: string;

  it('внесение: проверка ИНН и дат; без файла — «нет файла», задача продления за 30 дней', async () => {
    await expect(createContract(owner.id, orgId, { kind: 'pest_control', counterparty: 'ООО Дезконтроль', counterpartyInn: '123' })).rejects.toThrow(/ИНН/);
    await expect(createContract(owner.id, orgId, { kind: 'pest_control', counterparty: 'ООО Дезконтроль', validFrom: '2026-05-01', validTo: '2026-04-01' })).rejects.toThrow(/раньше/);
    await expect(createContract(cook.id, orgId, { kind: 'pest_control', counterparty: 'ООО Дезконтроль' })).rejects.toThrow();
    const validTo = addDays(200);
    pest = (await createContract(acc.id, orgId, { kind: 'pest_control', siteId, counterparty: 'ООО Дезконтроль', counterpartyInn: '7701234567', number: 'Д-15',
      validFrom: addDays(-10), validTo, subject: 'дератизация ежемесячно' })).id;
    const c = await getContract(owner.id, orgId, pest);
    expect(c.state).toBe('no_file');
    expect(c.title).toBe('Дезинсекция и дератизация');
    const t = await tasksOf(pest);
    expect(t).toHaveLength(1);
    expect(new Date(t[0].due_at).toISOString().slice(0, 10)).toBe((() => { const d = new Date(`${validTo}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 30); return d.toISOString().slice(0, 10); })());
  });

  it('файл договора: PDF и DOCX принимаются, прочий ZIP — нет; право — contract.manage, не evidence.add', async () => {
    await expect(addEvidence(cook.id, orgId, { entityType: 'contract', entityId: pest, filename: 'д.pdf' }, PDF)).rejects.toThrow();
    await expect(addEvidence(acc.id, orgId, { entityType: 'contract', entityId: pest, filename: 'д.zip' }, ZIP)).rejects.toThrow(/DOCX/);
    await addEvidence(acc.id, orgId, { entityType: 'contract', entityId: pest, filename: 'договор.pdf' }, PDF);
    const docx = await addEvidence(acc.id, orgId, { entityType: 'contract', entityId: pest, filename: 'допсоглашение.docx' }, DOCX);
    const files = await listEvidence(acc.id, orgId, 'contract', pest);
    expect(files.map((f) => f.mime)).toEqual(['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
    expect((await getEvidenceFile(acc.id, orgId, docx.id)).filename).toBe('допсоглашение.docx');
    await expect(getEvidenceFile(cook.id, orgId, docx.id)).rejects.toThrow();
    expect((await getContract(owner.id, orgId, pest)).state).toBe('ok');
  });

  it('продление переносит задачу; автопролонгация — без задачи; срок вышел — «истёк»', async () => {
    await updateContract(owner.id, orgId, pest, { validTo: addDays(400) });
    let t = await tasksOf(pest);
    expect(t.filter((x) => x.status === 'open')).toHaveLength(1);
    expect(t.filter((x) => x.status === 'done')).toHaveLength(1);
    await updateContract(owner.id, orgId, pest, { autoRenew: true });
    t = await tasksOf(pest);
    expect(t.filter((x) => x.status === 'open')).toHaveLength(0);
    // правка одного поля не затирает остальные
    const c = await getContract(owner.id, orgId, pest);
    expect([c.number, c.subject, c.counterparty_inn]).toEqual(['Д-15', 'дератизация ежемесячно', '7701234567']);
    await updateContract(owner.id, orgId, pest, { autoRenew: false, validTo: addDays(10) });
    expect((await getContract(owner.id, orgId, pest)).state).toBe('expiring');
    const old = (await createContract(owner.id, orgId, { kind: 'lab', counterparty: 'Лаборатория', validFrom: '2025-01-01', validTo: '2025-12-31' })).id;
    expect((await getContract(owner.id, orgId, old)).state).toBe('expired');
  });

  it('готовность: обязательные договоры — дезинсекция, лаборатория, отходы', async () => {
    let r = await getReadiness(owner.id, orgId, siteId);
    let ch = r.checks.find((c: { key: string }) => c.key === 'contracts')!;
    expect(ch.status).toBe('warn');
    expect(ch.detail).toMatch(/Лабораторные исследования: Лаборатория: истёк/);
    expect(ch.detail).toMatch(/Вывоз отходов.*не внесён/);
    for (const kind of ['lab', 'waste']) {
      const id = (await createContract(owner.id, orgId, { kind, counterparty: `Исполнитель ${kind}`, validTo: addDays(300) })).id;
      await addEvidence(owner.id, orgId, { entityType: 'contract', entityId: id, filename: 'д.pdf' }, PDF);
    }
    await updateContract(owner.id, orgId, pest, { validTo: addDays(300) });
    r = await getReadiness(owner.id, orgId, siteId);
    ch = r.checks.find((c: { key: string }) => c.key === 'contracts')!;
    expect(ch.status).toBe('pass');
    const l = await listContracts(acc.id, orgId);
    expect(l.required.every((x) => x.covered)).toBe(true);
  });

  it('расторжение: с причиной, задача закрыта, договор больше не меняется и не удаляется', async () => {
    await expect(terminateContract(owner.id, orgId, pest, { terminatedOn: addDays(0), reason: '' })).rejects.toThrow(/причин/);
    await terminateContract(owner.id, orgId, pest, { terminatedOn: addDays(0), reason: 'смена исполнителя' });
    expect((await tasksOf(pest)).filter((x) => x.status === 'open')).toHaveLength(0);
    await expect(updateContract(owner.id, orgId, pest, { number: 'Д-16' })).rejects.toThrow(/Расторгнутый/);
    await expect(withSystem((tx) => tx.query(`delete from contracts where id = $1`, [pest]))).rejects.toThrow(/не удаляется/);
    const l = await listContracts(owner.id, orgId);
    expect(l.required.find((x) => x.kind === 'pest_control')!.covered).toBe(false);
    expect(l.contracts.find((c) => c.id === pest)!.state).toBe('terminated');
  });

  it('изоляция: чужая организация договор не видит', async () => {
    const other = await makeUser();
    await expect(getContract(other.id, orgId, pest)).rejects.toThrow();
    await expect(listEvidence(other.id, orgId, 'contract', pest)).rejects.toThrow();
  });
});
