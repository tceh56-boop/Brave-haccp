import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createProduct } from '../src/server/ops/catalog';
import { createDish, getDish, updateVersion, addLine, updateLine, submitVersion, approveVersion, newVersion } from '../src/server/ops/recipes';
import { addEvidence } from '../src/server/ops/evidence';
import { makeUser, lastLinkToken } from './helpers';

/** ТЗ доработки 5.2 (ТТК): циклы п/ф, основание рецептуры с файлом, пересмотр зависимых документов, журнал изменений. */

afterAll(() => closePool());
type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, chef: U, orgId: string, beef: string, onion: string;
const PDF = Buffer.from('%PDF-1.4\n% основание\n');

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}
async function draftOf(dishId: string) { return (await getDish(chef.id, orgId, dishId)).current!.version.id as string; }
async function fill(v: string, lines: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  await updateVersion(chef.id, orgId, v, { yieldG: 1000, technology: 'Приготовить по технологии предприятия.', storageConditions: '+2…+6 °C', shelfLife: '24 часа', ...extra });
  for (const l of lines) await addLine(chef.id, orgId, v, l);
}
async function approve(v: string) { await submitVersion(chef.id, orgId, v); return approveVersion(chef.id, orgId, v); }
const tasks = async (kind: string) => (await withSystem((tx) => tx.query(`select title, details, entity_id from tasks where organization_id = $1 and kind = $2 and status = 'open'`, [orgId, kind]))).rows;

beforeAll(async () => {
  owner = await makeUser();
  orgId = (await createOrganization(owner, { name: 'Кафе «Рецептуры»' })).organization.id;
  chef = await invite('chef');
  beef = (await createProduct(chef.id, orgId, { name: 'Говядина', unit: 'кг' })).id;
  onion = (await createProduct(chef.id, orgId, { name: 'Лук', unit: 'кг' })).id;
});

describe('Циклические ссылки на полуфабрикаты', () => {
  it('косвенный цикл A → B → A запрещён и при добавлении, и при правке строки', async () => {
    const a = (await createDish(chef.id, orgId, { name: 'П/ф А', kind: 'semi' })).id;
    const b = (await createDish(chef.id, orgId, { name: 'П/ф Б', kind: 'semi' })).id;
    const c = (await createDish(chef.id, orgId, { name: 'П/ф В', kind: 'semi' })).id;
    const va = await draftOf(a), vb = await draftOf(b), vc = await draftOf(c);
    await fill(vb, [{ subDishId: a, unit: 'г', brutto: 100, netto: 100 }]);   // Б содержит А
    await fill(vc, [{ subDishId: b, unit: 'г', brutto: 100, netto: 100 }]);   // В содержит Б
    await expect(addLine(chef.id, orgId, va, { subDishId: c, unit: 'г', brutto: 10, netto: 10 })).rejects.toThrow(/Циклическая ссылка.*«П\/ф А» → «П\/ф В» → «П\/ф Б» → «П\/ф А»/);
    const l = await addLine(chef.id, orgId, va, { productId: beef, unit: 'кг', brutto: 1, netto: 0.8 });
    await expect(updateLine(chef.id, orgId, l.id, { productId: null, subDishId: b, unit: 'г', brutto: 10, netto: 10 })).rejects.toThrow(/Циклическая ссылка/);
  });
});

describe('Основание рецептуры', () => {
  it('сборник без файла основания не утверждается; с файлом — утверждается; пустое основание отклоняется', async () => {
    const d = (await createDish(chef.id, orgId, { name: 'Бефстроганов', kind: 'semi' })).id;
    const v = await draftOf(d);
    await expect(updateVersion(chef.id, orgId, v, { recipeBasis: ' ' })).rejects.toThrow(/Основание рецептуры/);
    await fill(v, [{ productId: beef, unit: 'кг', brutto: 1.2, netto: 1 }], { recipeBasis: 'Сборник рецептур 1996, № 593' });
    await expect(submitVersion(chef.id, orgId, v)).rejects.toThrow(/Приложите файл основания рецептуры.*Сборник рецептур 1996/);
    await addEvidence(chef.id, orgId, { entityType: 'ttk_version', entityId: v, filename: 'сборник-593.pdf' }, PDF);
    expect(await approve(v)).toMatchObject({ ok: true, version: 1 });
  });
});

describe('Пересмотр зависимых документов и журнал изменений', () => {
  it('новая ТТК п/ф ставит на пересмотр ТУ, ТИ, калькуляцию и блюда, в которые п/ф входит', async () => {
    const semi = (await createDish(chef.id, orgId, { name: 'Фарш', kind: 'semi' })).id;
    await fill(await draftOf(semi), [{ productId: beef, unit: 'кг', brutto: 1.1, netto: 1 }]);
    const r1 = await approve(await draftOf(semi));
    expect(r1.reviews).toEqual([]);                                      // на первой версии ничего не построено
    const dish = (await createDish(chef.id, orgId, { name: 'Котлеты', kind: 'semi' })).id;
    await fill(await draftOf(dish), [{ subDishId: semi, unit: 'г', brutto: 900, netto: 900 }, { productId: onion, unit: 'кг', brutto: 0.12, netto: 0.1 }]);
    await approve(await draftOf(dish));
    // ТУ, ТИ и калькуляция на текущую ТТК фарша
    await withSystem(async (tx) => {
      const v = (await tx.query(`select id from ttk_versions where dish_id = $1 and status = 'approved'`, [semi])).rows[0].id;
      await tx.query(`insert into tech_spec_versions (organization_id, dish_id, version, ttk_version_id, designation, snapshot, lab_protocol, approved_by) values ($1, $2, 1, $3, 'ТУ 10.13.14-001-00000000-2026', '{}', 'протокол № 1', $4)`, [orgId, semi, v, chef.id]);
      await tx.query(`insert into ti_versions (organization_id, dish_id, version, ttk_version_id, designation, snapshot, change_note, approved_by) values ($1, $2, 1, $3, 'ТИ 001', '{}', 'первая редакция', $4)`, [orgId, semi, v, chef.id]);
      await tx.query(`insert into costing_cards (organization_id, dish_id, ttk_version_id, seq, calc_date, basis_qty, basis_label, lines, raw_100, cost_1, approved_by) values ($1, $2, $3, 1, current_date, 1, '1 кг', '[]', 0, 0, $4)`, [orgId, semi, v, chef.id]);
    });
    const nv = await newVersion(chef.id, orgId, semi, { changeReason: 'Замена говядины: другая жирность' });
    const r2 = await approve(nv.id);
    expect(r2.reviews).toEqual(expect.arrayContaining(['Пересмотреть ТУ «Фарш»', 'Пересмотреть ТИ «Фарш»', 'Пересчитать калькуляцию «Фарш»', 'Проверить ТТК «Котлеты»: изменён полуфабрикат «Фарш»']));
    expect((await tasks('ttk_dependent_review'))[0]).toMatchObject({ entity_id: dish, details: expect.stringMatching(/версии 2 \(причина: Замена говядины/) });
    expect(await tasks('tu_review')).toHaveLength(1);
    // журнал изменений: версия, причина, автор, утвердивший
    const h = (await getDish(chef.id, orgId, semi)).versions;
    expect(h[0]).toMatchObject({ version: 2, change_reason: 'Замена говядины: другая жирность', author_name: expect.any(String), approved_by_name: expect.any(String) });
    const a = (await withSystem((tx) => tx.query(`select after from audit_events where organization_id = $1 and action = 'ttk.approve' and entity_id = $2`, [orgId, nv.id]))).rows[0];
    expect(a.after).toMatchObject({ change_reason: 'Замена говядины: другая жирность', author: chef.id });
  });
});
