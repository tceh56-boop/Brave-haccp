import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createProduct, createSupplier } from '../src/server/ops/catalog';
import { createReceipt, addReceiptLine, completeReceipt } from '../src/server/ops/receipts';
import { importReference, createProductFromReference } from '../src/server/ops/reference';
import { setUnitConversion } from '../src/server/ops/stock';
import {
  importTtkArchive, listArchive, importFromArchive, createDish, updateDish, getDish, listDishes, updateVersion, addLine, updateLine, matchLine, unmatchedNames,
  submitVersion, returnVersion, approveVersion, newVersion,
} from '../src/server/ops/recipes';
import { makeUser, lastLinkToken } from './helpers';

afterAll(() => closePool());

type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, chef: U, tech: U, cook: U, store: U, stranger: U;
let orgId: string, siteId: string, supplierId: string;
let beef: string, onion: string, dishId: string, v1: string;

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}
const ALL_OK = { packaging: true, labeling: true, documents: true, quality: true };
const inDays = (n: number) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
async function receive(productId: string, quantity: number, unitPrice: number | null) {
  const r = await createReceipt(store.id, orgId, { siteId, supplierId });
  await addReceiptLine(store.id, orgId, r.id, { productId, quantity, unitPrice, lotNo: `L-${Math.random().toString(36).slice(2, 6)}`, expiresAt: inDays(5), expiryBasis: 'маркировка', checks: ALL_OK, decision: 'accepted' });
  await completeReceipt(store.id, orgId, r.id);
}
const TECH = { technology: 'Говядину нарезать брусочками, обжарить, добавить лук, тушить в соусе 10 минут.', storageConditions: 'при +2…+6 °C', shelfLife: '2 часа на раздаче' };

beforeAll(async () => {
  await importReference();
  expect((await importTtkArchive()).cards).toBe(559);
  owner = await makeUser({ name: 'Ольга Владелец' });
  const r = await createOrganization(owner, { name: 'Кафе «Меню»' });
  orgId = r.organization.id; siteId = r.site.id;
  chef = await invite('chef'); tech = await invite('technologist'); cook = await invite('line_staff'); store = await invite('storekeeper');
  stranger = await makeUser();
  await createOrganization(stranger, { name: 'Чужое кафе' });
  supplierId = (await createSupplier(store.id, orgId, { name: 'ООО «Поставщик»' })).id;
  const ref = (await withSystem((tx) => tx.query(`select id from reference_products where code = 'PROD-0093'`))).rows[0].id;
  beef = (await createProductFromReference(chef.id, orgId, { referenceId: ref, name: 'Говядина вырезка', unit: 'кг' })).id;
  onion = (await createProduct(chef.id, orgId, { name: 'Лук репчатый', unit: 'кг' })).id;
});

describe('ТТК: черновик → согласование → утверждение (человек), версия не меняется', () => {
  it('блюдо: цену продажи ставит шеф/руководитель, технолог — нет', async () => {
    await expect(createDish(tech.id, orgId, { name: 'Бефстроганов', salePrice: 450 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const d = await createDish(chef.id, orgId, { name: 'Бефстроганов', category: 'Горячее', salePrice: 450 });
    dishId = d.id;
    await expect(createDish(chef.id, orgId, { name: 'бефстроганов' })).rejects.toMatchObject({ code: 'CONFLICT' });
    v1 = (await getDish(chef.id, orgId, dishId)).current!.version.id;
  });

  it('отправить без технологии, выхода и состава нельзя — список причин', async () => {
    await expect(submitVersion(tech.id, orgId, v1)).rejects.toThrow(/технологию.*условия хранения.*срок годности.*выход.*выход порции.*Нет состава/);
    await updateVersion(tech.id, orgId, v1, { ...TECH, yieldG: 150, portionG: 150 });
    await addLine(tech.id, orgId, v1, { productId: beef, unit: 'кг', brutto: 0.15, netto: 0.12 });
    const l = await addLine(tech.id, orgId, v1, { name: 'Лук', unit: 'г', brutto: 30, netto: 35 });
    const b = (await getDish(tech.id, orgId, dishId)).current!.blockers.join(' ');
    expect(b).toMatch(/«Лук»: не сопоставлено/);
    await matchLine(tech.id, orgId, l.id, { productId: onion });
    expect((await getDish(tech.id, orgId, dishId)).current!.blockers.join(' ')).toMatch(/«Лук»: нетто больше брутто/);
    await updateLine(tech.id, orgId, l.id, { unit: 'г', brutto: 30, netto: 25 });
    expect((await getDish(tech.id, orgId, dishId)).current!.blockers).toEqual([]);
  });

  it('на согласовании состав не правится; вернуть с замечанием; утверждает человек с правом', async () => {
    await submitVersion(tech.id, orgId, v1);
    const line = (await getDish(tech.id, orgId, dishId)).current!.lines[0];
    await expect(updateLine(tech.id, orgId, line.id, { unit: 'кг', brutto: 0.2, netto: 0.15 })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(approveVersion(cook.id, orgId, v1)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await returnVersion(chef.id, orgId, v1, { note: 'Уточните срок хранения' });
    expect((await getDish(tech.id, orgId, dishId)).current!.version).toMatchObject({ status: 'draft', return_note: 'Уточните срок хранения' });
    await updateVersion(tech.id, orgId, v1, { ...TECH, shelfLife: '2 часа на раздаче при +65 °C', yieldG: 150, portionG: 150 });
    await submitVersion(tech.id, orgId, v1);
    await approveVersion(chef.id, orgId, v1);
    const d = await getDish(cook.id, orgId, dishId);
    expect(d.current!.version.status_label).toBe('Утверждена');
    await expect(withSystem((tx) => tx.query(`update ttk_lines set netto = 1 where version_id = $1`, [v1]))).rejects.toThrow(/новой версией/);
    await expect(withSystem((tx) => tx.query(`update ttk_versions set technology = 'x' where id = $1`, [v1]))).rejects.toThrow(/не изменяется/);
  });
});

describe('Себестоимость по ценам партий; неизвестная цена ≠ 0; КБЖУ из справочника', () => {
  it('без цены лука — себестоимость неполная, а не заниженная', async () => {
    await receive(beef, 10, 800);
    const c = (await getDish(chef.id, orgId, dishId)).current!.cost!;
    expect(c.complete).toBe(false);
    expect(c.total).toBeNull();
    expect(c.known).toBe(120);
    expect(c.missing).toEqual(['Лук репчатый: нет цены закупки']);
  });

  it('все цены есть — на порцию и фудкост; сотрудник цеха себестоимость и цену не видит', async () => {
    await receive(onion, 5, 40);
    const d = await getDish(chef.id, orgId, dishId);
    expect(d.current!.cost).toMatchObject({ complete: true, total: 121.2, per_portion: 121.2, food_cost_pct: 26.9 });
    const forCook = await getDish(cook.id, orgId, dishId);
    expect(forCook.current!.cost).toBeNull();
    expect(forCook.dish.sale_price).toBeNull();
    // средневзвешенная по остатку
    await receive(beef, 10, 1000);
    expect((await getDish(chef.id, orgId, dishId)).current!.cost!.total).toBe(136.2);
  });

  it('КБЖУ на 100 г выхода — ориентировочно, справочник не проверен; несопоставленное не считается', async () => {
    const k = (await getDish(chef.id, orgId, dishId)).current!.kbju;
    expect(k.per100!.kcal).toBe(Math.round(120 * 141 / 100 / 150 * 100));
    expect(k.complete).toBe(false);
    expect(k.missing).toEqual(['Лук репчатый: нет данных справочника']);
    expect(k.verified).toBe(false);
  });

  it('штуки без подтверждённого коэффициента — препятствие; с коэффициентом — можно', async () => {
    const v2 = await newVersion(tech.id, orgId, dishId, { changeReason: 'Лук в штуках по закупке' });
    const lines = (await getDish(tech.id, orgId, dishId)).current!.lines;
    expect(lines).toHaveLength(2);
    await updateLine(tech.id, orgId, lines[1].id, { unit: 'шт', brutto: 0.5, netto: 0.4 });
    expect((await getDish(tech.id, orgId, dishId)).current!.blockers.join(' ')).toMatch(/нет коэффициента «шт → кг»/);
    await setUnitConversion(store.id, orgId, { productId: onion, fromUnit: 'шт', toUnit: 'кг', factor: 0.1, source: 'взвешивание 10 луковиц' });
    expect((await getDish(tech.id, orgId, dishId)).current!.blockers).toEqual([]);
    await submitVersion(tech.id, orgId, v2.id);
    await approveVersion(owner.id, orgId, v2.id);
    const d = await getDish(chef.id, orgId, dishId);
    expect(d.versions.map((v) => `${v.version}:${v.status}`)).toEqual(['2:approved', '1:archived']);
    expect(d.current!.cost!.total).toBe(135 + 0.5 * 0.1 * 40);   // говядина 0,15 кг × средняя 900 ₽ + лук 0,05 кг × 40 ₽
  });
});

describe('Архив ТТК: 559 карт, импорт черновиками, сопоставление сырья один раз', () => {
  let holodecId: string;

  it('поиск и импорт; повторный импорт не создаёт дублей', async () => {
    const a = await listArchive(cook.id, orgId, { q: 'холодец' });
    expect(a.categories.length).toBeGreaterThan(3);
    const ids = a.cards.filter((c) => c.name.startsWith('Холодец')).map((c) => c.id);
    expect(ids).toHaveLength(2);
    await expect(importFromArchive(cook.id, orgId, { archiveIds: ids })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const r = await importFromArchive(tech.id, orgId, { archiveIds: ids });
    expect(r).toMatchObject({ dishes: 2, skipped: 0 });
    expect((await importFromArchive(tech.id, orgId, { archiveIds: ids })).skipped).toBe(2);
    const dishes = await listDishes(cook.id, orgId);
    const semi = dishes.find((d) => d.name === 'Холодец  п/ф 1кг')!;
    expect(semi.kind).toBe('semi');
    holodecId = dishes.find((d) => d.name.startsWith('Холодец домашний'))!.id;
    const card = await getDish(tech.id, orgId, holodecId);
    expect(card.current!.version).toMatchObject({ status: 'draft', source: expect.stringContaining('Архив ТТК:'), portion_g: '90' });
    expect(card.current!.lines.every((l) => !l.product_id)).toBe(true);
  });

  it('сопоставили название один раз — применилось во всех черновиках; новые импорты — сразу', async () => {
    const names = await unmatchedNames(tech.id, orgId);
    const salt = names.find((n) => n.name === 'Соль пищевая');
    const salt2 = names.find((n) => n.name.startsWith('Хрен'))!;
    expect(salt2.count).toBe(1);
    const p = await createProduct(chef.id, orgId, { name: 'Хрен сливочный', unit: 'кг' });
    const r = await matchLine(tech.id, orgId, salt2.line_id, { productId: p.id });
    expect(r.applied).toBe(1);
    expect(salt?.count ?? 0).toBeGreaterThanOrEqual(1);
    const semi = (await listDishes(tech.id, orgId)).find((d) => d.name === 'Холодец  п/ф 1кг')!;
    const line = (await getDish(tech.id, orgId, holodecId)).current!.lines.find((l) => l.name_raw.startsWith('Холодец'))!;
    await matchLine(tech.id, orgId, line.id, { subDishId: semi.id });
    expect((await getDish(tech.id, orgId, holodecId)).current!.blockers.join(' ')).toMatch(/у полуфабриката нет утверждённой ТТК/);
    const other = (await listArchive(tech.id, orgId, { q: 'хрен' })).cards.filter((c) => !c.dish_id).slice(0, 3);
    if (other.length) {
      const imp = await importFromArchive(tech.id, orgId, { archiveIds: other.map((c) => c.id) });
      expect(imp.matched).toBeGreaterThan(0);
    }
  });

  it('изоляция: чужая организация не видит блюда', async () => {
    await expect(getDish(stranger.id, orgId, dishId)).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/) });
    await expect(updateDish(cook.id, orgId, dishId, { salePrice: 1 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('КБЖУ: неизвестно ≠ 0', () => {
  it('ни у одного ингредиента нет данных справочника — «не рассчитано», а не 0 ккал', async () => {
    const d = await createDish(chef.id, orgId, { name: 'Луковый гарнир' });
    const v = (await getDish(chef.id, orgId, d.id)).current!.version.id;
    await updateVersion(chef.id, orgId, v, { yieldG: 100 });
    await addLine(chef.id, orgId, v, { productId: onion, unit: 'г', brutto: 120, netto: 100 });
    const k = (await getDish(chef.id, orgId, d.id)).current!.kbju;
    expect(k.per100).toBeNull();
    expect(k.complete).toBe(false);
  });
});
