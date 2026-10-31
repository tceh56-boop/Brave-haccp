import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createProduct, createSupplier } from '../src/server/ops/catalog';
import { createReceipt, addReceiptLine, completeReceipt } from '../src/server/ops/receipts';
import { createDish, getDish, updateVersion, addLine, submitVersion, approveVersion } from '../src/server/ops/recipes';
import { createProduction, startProduction, completeProduction } from '../src/server/ops/production';
import { setProductNutrition, setProductAllergens } from '../src/server/ops/techspec';
import { setOpenedShelfLife, logPrint, getLabels } from '../src/server/ops/labels';
import { previewConsumerLabel, createConsumerLabel } from '../src/server/ops/consumerLabels';
import { makeUser, lastLinkToken } from './helpers';

/** Потребительская этикетка по ТР ТС 022/2011: данные из ТТК, расчёта ТУ и партии; при неполных сведениях — не печатается. */

afterAll(() => closePool());

type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, chef: U, tech: U, cook: U;
let orgId: string, siteId: string, beef: string, onion: string, broth: string, brothLot: string, beefLot: string;
const inDays = (n: number) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Цех полуфабрикатов', inn: '7700000001' });
  orgId = r.organization.id; siteId = r.site.id;
  chef = await invite('chef'); tech = await invite('technologist'); cook = await invite('line_staff');
  beef = (await createProduct(chef.id, orgId, { name: 'Говядина охлаждённая', unit: 'кг' })).id;
  onion = (await createProduct(chef.id, orgId, { name: 'Лук репчатый', unit: 'кг' })).id;
  const sup = (await createSupplier(chef.id, orgId, { name: 'ООО «Фермер»' })).id;
  for (const [p, q, no] of [[beef, 5, 'Г-1'], [onion, 2, 'Л-1']] as const) {
    const rc = await createReceipt(cook.id, orgId, { siteId, supplierId: sup });
    await addReceiptLine(cook.id, orgId, rc.id, { productId: p, quantity: q, unitPrice: 100, lotNo: no, expiresAt: inDays(5), expiryBasis: 'маркировка изготовителя',
      checks: { packaging: true, labeling: true, documents: true, quality: true }, decision: 'accepted' });
    await completeReceipt(cook.id, orgId, rc.id);
  }
  beefLot = (await withSystem((tx) => tx.query(`select id from lots where product_id = $1`, [beef]))).rows[0].id;
  const d = await createDish(chef.id, orgId, { name: 'Фарш говяжий с луком', kind: 'semi' });
  const v = (await getDish(chef.id, orgId, d.id)).current!.version.id;
  await updateVersion(chef.id, orgId, v, { yieldG: 1000, technology: 'Мясо и лук измельчают на мясорубке, перемешивают.', storageConditions: 'при температуре от +2 до +6 °C', shelfLife: '24 часа', shelfLifeHours: 24 });
  await addLine(chef.id, orgId, v, { productId: onion, unit: 'кг', brutto: 0.2, netto: 0.17 });
  await addLine(chef.id, orgId, v, { productId: beef, unit: 'кг', brutto: 0.9, netto: 0.85 });
  await submitVersion(chef.id, orgId, v); await approveVersion(chef.id, orgId, v);
  broth = d.id;
  const o = await createProduction(chef.id, orgId, { siteId, dishId: broth, plannedKg: 1, plannedFor: new Date().toISOString().slice(0, 10) });
  await startProduction(cook.id, orgId, o.id);
  brothLot = (await completeProduction(cook.id, orgId, o.id, { actualKg: 1, operationId: randomUUID() })).lot_id;
});

describe('Прослеживаемость партии полуфабриката', () => {
  it('партия п/ф: своя партия, версия ТТК задания, связи с партиями сырья', async () => {
    const o = (await withSystem((tx) => tx.query(`select o.ttk_version_id, v.status, v.dish_id from production_orders o join ttk_versions v on v.id = o.ttk_version_id where o.output_lot_id = $1`, [brothLot]))).rows[0];
    expect(o).toMatchObject({ status: 'approved', dish_id: broth });
    const parents = (await withSystem((tx) => tx.query(`select p.name from lot_links k join lots l on l.id = k.parent_lot_id join products p on p.id = l.product_id
      where k.child_lot_id = $1 and k.kind = 'production' order by p.name`, [brothLot]))).rows.map((r) => r.name);
    expect(parents).toEqual(['Говядина охлаждённая', 'Лук репчатый']);
  });
});

describe('Потребительская этикетка', () => {
  it('покупной товар — не печатается: на нём маркировка изготовителя', async () => {
    await expect(previewConsumerLabel(owner.id, orgId, beefLot)).rejects.toThrow(/не продукция собственного изготовления/);
  });

  it('пока сведений не хватает — перечень того, что исправить, печать запрещена', async () => {
    const p = await previewConsumerLabel(owner.id, orgId, brothLot);
    const b = p.blockers.join(' | ');
    expect(b).toMatch(/Профиль аллергенов неполный/);
    expect(b).toMatch(/Пищевая ценность не рассчитана/);
    expect(b).toMatch(/массу нетто/);
    expect(b).toMatch(/после вскрытия/);
    expect(b).toMatch(/адрес площадки/);
    await expect(createConsumerLabel(chef.id, orgId, brothLot, { netMassG: 500 })).rejects.toThrow(/печатать нельзя/);
    // справочные (неподтверждённые) данные о пищевой ценности — тоже нельзя
  });

  it('все сведения есть — этикетка: состав по убыванию массы, пищевая ценность, сроки, изготовитель; ЕАС без декларации не печатается', async () => {
    await setProductNutrition(tech.id, orgId, beef, { kcal: 187, protein: 18.6, fat: 12.4, carbs: 0, basis: 'маркировка изготовителя' });
    await setProductNutrition(tech.id, orgId, onion, { kcal: 41, protein: 1.4, fat: 0, carbs: 8.2, basis: 'маркировка изготовителя' });
    await setProductAllergens(tech.id, orgId, beef, { allergens: [], basis: 'спецификация поставщика' });
    await setProductAllergens(tech.id, orgId, onion, { allergens: [], basis: 'спецификация поставщика' });
    const product = (await withSystem((tx) => tx.query(`select product_id from lots where id = $1`, [brothLot]))).rows[0].product_id;
    await setOpenedShelfLife(chef.id, orgId, product, { hours: 12, basis: 'Тест: ТТК, раздел хранения' });
    await withSystem((tx) => tx.query(`update sites set address = 'Оренбургская обл., г. Оренбург, ул. Тестовая, 1' where id = $1`, [siteId]));
    const p = await previewConsumerLabel(owner.id, orgId, brothLot, '500');
    expect(p.blockers).toEqual([]);
    expect(p.payload).toMatchObject({ product: 'Фарш говяжий с луком', composition: ['Говядина охлаждённая', 'Лук репчатый'], allergen_text: 'Аллергены: не содержит.',
      net_mass_g: 500, storage: 'при температуре от +2 до +6 °C', after_opening: expect.stringMatching(/не более 12 ч/), manufacturer: 'Цех полуфабрикатов', eac: false });
    expect(p.payload.nutrition).toMatchObject({ protein: expect.any(Number), kcal: expect.any(Number) });
    expect(p.notes.join(' ')).toMatch(/Знак ЕАС не печатается/);
    await expect(createConsumerLabel(cook.id, orgId, brothLot, { netMassG: 500 })).resolves.toBeTruthy();   // у повара есть право печати этикеток
    const lb = await createConsumerLabel(chef.id, orgId, brothLot, { netMassG: 500 });
    expect(lb.reused).toBe(true);   // те же сведения — та же этикетка
    expect(await logPrint(chef.id, orgId, { labelIds: [lb.id], format: '58x60', copies: 3 })).toEqual({ printed: 3 });
    const [saved] = await getLabels(owner.id, orgId, [lb.id]);
    expect(saved).toMatchObject({ kind: 'consumer', printed: 3 });
    const other = await createConsumerLabel(chef.id, orgId, brothLot, { netMassG: 300 });
    expect(other.id).not.toBe(lb.id);   // другая масса — новая этикетка
  });
});
