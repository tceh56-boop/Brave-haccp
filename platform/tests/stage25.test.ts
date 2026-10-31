import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization } from '../src/server/org/organizations';
import { saveProfile } from '../src/server/ops/regulatory';
import { validateEnterpriseReadiness, registerNormRefs, unknownNormRefs, READINESS_KEYS } from '../src/server/readiness/engine';
import { clauseById } from '../src/server/norms/library';
import { CHECK_KEYS } from '../src/server/norms/checks';
import { CLAUSES } from '../src/server/norms/library';
import { makeUser } from './helpers';
import { getProblems } from '../src/server/ops/dashboard';
import { getReadiness } from '../src/server/ops/readiness';
import { buildPack } from '../src/server/ops/pack';
import { inflateRawSync } from 'node:zlib';

/** Единый движок готовности (ТЗ доработки, этап 1) и fail-closed для нормативных ссылок. */

afterAll(() => closePool());
type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, orgId: string, siteId: string;
const sys = (q: string, a: unknown[]) => withSystem((tx) => tx.query(q, a));
const run = (keys: string[]) => withSystem((tx) => validateEnterpriseReadiness(tx, orgId, null, { keys }));
const st = async (key: string) => (await run([key])).items[0];

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Кафе «Движок»' });
  orgId = r.organization.id; siteId = r.site.id;
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : []; });
}

describe('Нормативные ссылки — fail-closed', () => {
  it('все id пунктов, упомянутые в коде, существуют в нормативной базе', () => {
    const re = /'((?:sanpin4282|sanpin3685|trts021|trts022|sp4284|sp4285|gost31987|rpn):[a-z0-9_.]+)'/g;
    const missing: string[] = [];
    for (const f of walk(path.resolve(__dirname, '../src'))) for (const m of readFileSync(f, 'utf8').matchAll(re)) if (!clauseById.has(m[1])) missing.push(`${path.relative(process.cwd(), f)}: ${m[1]}`);
    expect(missing).toEqual([]);
  });

  it('у каждого пункта с проверкой есть пункт движка; ключи проверок = ключи движка', () => {
    for (const c of CLAUSES) if (c.check) expect(READINESS_KEYS, c.id).toContain(c.check);
    expect(CHECK_KEYS).toBe(READINESS_KEYS);
  });

  it('неизвестный id не исчезает молча: пункт norm_refs — blocked, блокирует ППК', async () => {
    registerNormRefs('тестовый модуль', ['sanpin4282:999']);
    const r = await run(['norm_refs']);
    expect(r.items[0]).toMatchObject({ status: 'blocked' });
    expect(r.items[0].items!.join()).toContain('тестовый модуль: «sanpin4282:999»');
    expect(r.blocking_ppk.map((i) => i.key)).toContain('norm_refs');
    expect(unknownNormRefs()).toEqual([{ module: 'тестовый модуль', id: 'sanpin4282:999' }]);
  });
});

describe('Статусы пунктов: пустое не считается выполненным', () => {
  it('нет данных — missing; не применяется по профилю — not_applicable', async () => {
    expect((await st('haccp_plan')).status).toBe('missing');
    expect((await st('lab_program')).status).toBe('missing');
    expect((await st('fryer')).status).toBe('not_applicable');
    expect((await st('daily_samples')).status).toBe('not_applicable');
  });

  it('суточные пробы: обязательны по профилю — пустая настройка не засчитывается', async () => {
    await saveProfile(owner.id, orgId, { objectTypes: ['hospital'] });
    expect((await st('daily_samples')).status).toBe('missing');
    await sys(`insert into sample_settings (organization_id, min_weight_g, retention_hours, t_min, t_max, basis, updated_by) values ($1, 100, 48, 2, 6, '', $2)`, [orgId, owner.id]);
    expect((await st('daily_samples')).status).toBe('incomplete');   // без основания — неполные
    await saveProfile(owner.id, orgId, { objectTypes: ['cafe'] });
  });

  it('договор без файла — incomplete, истёкший — expired', async () => {
    const c = (await sys(`insert into contracts (organization_id, kind, title, counterparty, number, signed_on, valid_from, valid_to, created_by) values ($1, 'pest_control', 'Договор', 'ООО «Дезинфектор»', '1', current_date - 10, current_date - 10, current_date + 100, $2) returning id`, [orgId, owner.id])).rows[0].id;
    expect((await st('contract_pest')).status).toBe('incomplete');
    await sys(`insert into evidence_files (organization_id, entity_type, entity_id, filename, mime, size_bytes, sha256, content, uploaded_by) values ($1, 'contract', $2, 'd.pdf', 'application/pdf', 4, $3, '\\x25504446', $4)`, [orgId, c, `h${c}`, owner.id]);
    expect((await st('contract_pest')).status).toBe('ok');
  });

  it('лабораторная программа без протокола за прошедший период — incomplete; просроченная — overdue', async () => {
    const p = (await sys(`insert into lab_programs (organization_id, site_id, test_type, target, period_days, next_due, basis, created_by, created_at) values ($1, $2, 'Смывы на БГКП', 'Руки персонала', 30, current_date + 5, 'ППК', $3, now() - interval '40 days') returning id`, [orgId, siteId, owner.id])).rows[0].id;
    expect((await st('lab_program')).status).toBe('incomplete');
    await sys(`update lab_programs set next_due = current_date - 1 where id = $1`, [p]);
    expect((await st('lab_program')).status).toBe('overdue');
  });

  it('поверка: срок не указан — incomplete, истёк — expired', async () => {
    await sys(`insert into equipment (organization_id, site_id, name, kind, measuring, created_by) values ($1, $2, 'Термометр щуп', 'instrument', true, $3)`, [orgId, siteId, owner.id]);
    expect((await st('instruments')).status).toBe('incomplete');
    await sys(`update equipment set calibration_due = current_date - 1 where organization_id = $1`, [orgId]);
    expect((await st('instruments')).status).toBe('expired');
  });

  it('партии без цены — incomplete (неизвестная цена не ноль)', async () => {
    const p = (await sys(`insert into products (organization_id, name, unit) values ($1, 'Мука', 'кг') returning id`, [orgId])).rows[0].id;
    await sys(`insert into lots (organization_id, site_id, product_id, quantity, unit, expires_at, expiry_basis, status) values ($1, $2, $3, 5, 'кг', now() + interval '30 days', 'маркировка', 'available')`, [orgId, siteId, p]);
    expect((await st('lots_no_price')).status).toBe('incomplete');
  });

  it('сводка и блокирующие пункты ППК', async () => {
    const r = await withSystem((tx) => validateEnterpriseReadiness(tx, orgId));
    expect(r.items.length).toBe(READINESS_KEYS.length);
    expect(r.summary.missing).toBeGreaterThan(0);
    expect(r.blocking_ppk.every((i) => i.blocks.includes('ppk_approve'))).toBe(true);
  });
});

describe('Один движок — во всех местах (главный экран, пакет проверки, отчёт руководителя)', () => {
  it('невыполненный пункт виден одинаково на главном экране, в готовности и в пакете', async () => {
    const plan = await st('haccp_plan');
    expect(plan.status).toBe('missing');
    const { cards } = await getProblems(owner.id, orgId, siteId);
    expect(cards.find((c) => c.key === 'ready:haccp_plan')).toMatchObject({ title: plan.title, risk: 'Блокирует утверждение ППК' });
    // пункты, у которых есть своя карточка на главном экране, не дублируются
    expect(cards.some((c) => c.key === 'ready:staff_medical')).toBe(false);
    const r = await getReadiness(owner.id, orgId);
    expect(r.checks.find((c) => c.key === 'ready_haccp_plan')).toMatchObject({ status: 'warn', title: plan.title });
    expect(r.checks.some((c) => c.key === 'ready_fryer')).toBe(false);   // не применяется по профилю — не показывается
    const today = new Date().toISOString().slice(0, 10);
    const pack = await buildPack(owner.id, orgId, { siteId, from: today, to: today });
    const idx = unzipEntry(pack.archive, 'index.html');
    expect(idx).toContain('Готовность предприятия на');
    expect(idx).toContain(plan.title);
  });
});

/** Достаёт файл из zip (локальные заголовки; deflate или store). */
function unzipEntry(buf: Buffer, name: string): string {
  let o = 0;
  while (buf.readUInt32LE(o) === 0x04034b50) {
    const method = buf.readUInt16LE(o + 8), size = buf.readUInt32LE(o + 18), nl = buf.readUInt16LE(o + 26), el = buf.readUInt16LE(o + 28);
    const n = buf.subarray(o + 30, o + 30 + nl).toString('utf8'), start = o + 30 + nl + el;
    const data = buf.subarray(start, start + size);
    if (n === name) return (method === 8 ? inflateRawSync(data) : data).toString('utf8');
    o = start + size;
  }
  throw new Error(`${name} нет в архиве`);
}
