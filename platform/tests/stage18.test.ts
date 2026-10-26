import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createProduct } from '../src/server/ops/catalog';
import { importTtkArchive, createDish, getDish, updateDish, updateVersion, addLine, updateLine, submitVersion, approveVersion, newVersion, addHeading, renameHeading, moveLine,
  insertFromDish, approvedRecipe } from '../src/server/ops/recipes';
import {
  listMethods, createNorm, approveNorm, archiveNorm, listNorms, normsToday, setNormDefault, setLineSteps, applyNormToDrafts, suggestFromArchive,
} from '../src/server/ops/processing';
import { previewCosting, createCosting, getCosting, listCosting } from '../src/server/ops/costing';
import { chain, factors, inSeason, seasonsOverlap, retention } from '../src/server/recipes/chain';
import { makeUser, lastLinkToken } from './helpers';

/** Обработка сырья в ТТК: нормы отходов и потерь (данные в тесте — условные), цепочка брутто → нетто → выход. */

afterAll(() => closePool());

type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, tech: U, cook: U, stranger: U;
let orgId: string, carrot: string, salt: string, rice: string, dishId: string, v1: string;
let autumn: string, winter: string, boil: string;

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}
const today = () => withSystem(async (tx) => (await tx.query(`select (now() at time zone 'Europe/Moscow')::date::text as d`)).rows[0].d as string);
const lineOf = async (name: string) => (await getDish(tech.id, orgId, dishId)).current!.lines.find((l: any) => l.name_raw === name)!;

beforeAll(async () => {
  await importTtkArchive();
  owner = await makeUser({ name: 'Ольга Владелец' });
  const r = await createOrganization(owner, { name: 'Кафе «Обработка»' });
  orgId = r.organization.id;
  tech = await invite('technologist'); cook = await invite('line_staff');
  stranger = await makeUser();
  await createOrganization(stranger, { name: 'Чужое кафе' });
  carrot = (await createProduct(tech.id, orgId, { name: 'Морковь свежая', unit: 'кг' })).id;
  salt = (await createProduct(tech.id, orgId, { name: 'Соль поваренная', unit: 'кг' })).id;
  rice = (await createProduct(tech.id, orgId, { name: 'Рис круглозёрный', unit: 'кг' })).id;
});

describe('Расчёт цепочки (ГОСТ 31988-2012)', () => {
  it('брутто → холодная → нетто → тепловая → выход и обратно', () => {
    const steps = [{ kind: 'cold' as const, loss_pct: 20 }, { kind: 'thermal' as const, loss_pct: 3 }];
    expect(factors(steps)).toEqual({ toNetto: 0.8, toReady: 0.97 });
    expect(chain(steps, 'brutto', 125)).toEqual({ brutto: 125, netto: 100, ready: 97 });
    expect(chain(steps, 'ready', 97)).toEqual({ brutto: 125, netto: 100, ready: 97 });
    expect(chain(steps, 'netto', 100).brutto).toBe(125);
    // привар: отрицательный процент; холодная после тепловой входит в выход
    expect(chain([{ kind: 'thermal', loss_pct: -150 }], 'netto', 100).ready).toBe(250);
    expect(chain([{ kind: 'thermal', loss_pct: 10 }, { kind: 'cold', loss_pct: 10 }], 'brutto', 100)).toEqual({ brutto: 100, netto: 100, ready: 81 });
  });

  it('сезоны с переходом через Новый год; потери нутриентов — только если известны', () => {
    expect(inSeason(1015, 901, 1231)).toBe(true);
    expect(inSeason(215, 901, 1231)).toBe(false);
    expect(inSeason(215, 1101, 331)).toBe(true);
    expect(seasonsOverlap([901, 1231], [101, 831])).toBe(false);
    expect(seasonsOverlap([null, null], [101, 831])).toBe(true);
    expect(retention([{ kind: 'thermal', protein_loss_pct: 10, fat_loss_pct: 20, carbs_loss_pct: 0 }])).toEqual({ protein: 0.9, fat: 0.8, carbs: 1 });
    expect(retention([{ kind: 'thermal', protein_loss_pct: null, fat_loss_pct: null, carbs_loss_pct: null }])).toBeNull();
  });
});

describe('Нормы обработки: вносит технолог по основанию, утверждает человек, значения не меняются', () => {
  it('справочник способов — только названия', async () => {
    const m = await listMethods(cook.id, orgId);
    expect(m.find((x: any) => x.code === 'clean')).toMatchObject({ name: 'Очистка', kind: 'cold' });
    expect(m.find((x: any) => x.code === 'boil')).toMatchObject({ name: 'Варка', kind: 'thermal' });
  });

  it('без основания и сотрудником цеха — нельзя; сезонные нормы моркови', async () => {
    await expect(createNorm(tech.id, orgId, { productId: carrot, method: 'clean', lossPct: 20, basis: '' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(createNorm(cook.id, orgId, { productId: carrot, method: 'clean', lossPct: 20, basis: 'Акт проработки № 1' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(createNorm(tech.id, orgId, { productId: carrot, method: 'clean', lossPct: 20, seasonFrom: '01.09', basis: 'Акт проработки № 1' })).rejects.toThrow(/обе даты/);
    await expect(createNorm(tech.id, orgId, { productId: carrot, method: 'clean', lossPct: 5, proteinLossPct: 1, fatLossPct: 1, carbsLossPct: 1, basis: 'Акт проработки № 1' })).rejects.toThrow(/тепловой/);
    autumn = (await createNorm(tech.id, orgId, { productId: carrot, method: 'clean', lossPct: 20, seasonFrom: '01.09', seasonTo: '31.12', basis: 'Тест: акт проработки № 1' })).id;
    winter = (await createNorm(tech.id, orgId, { productId: carrot, method: 'clean', lossPct: 25, seasonFrom: '01.01', seasonTo: '31.08', basis: 'Тест: акт проработки № 2' })).id;
    boil = (await createNorm(tech.id, orgId, { productId: carrot, method: 'boil', lossPct: 3, proteinLossPct: 10, fatLossPct: 0, carbsLossPct: 10, basis: 'Тест: акт проработки № 3' })).id;
    await expect(approveNorm(cook.id, orgId, autumn)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    for (const id of [autumn, winter, boil]) await approveNorm(tech.id, orgId, id);
    const l = await listNorms(cook.id, orgId, { productId: carrot });
    expect(l.norms.map((n: any) => `${n.method_code}:${n.loss_pct}:${n.season}:${n.status}`).sort()).toEqual(
      ['boil:3:круглый год:approved', 'clean:20:с 01.09 по 31.12:approved', 'clean:25:с 01.01 по 31.08:approved']);
    await expect(withSystem((tx) => tx.query(`update processing_norms set loss_pct = 1 where id = $1`, [boil]))).rejects.toThrow(/не изменяются/);
    await expect(withSystem((tx) => tx.query(`delete from processing_norms where id = $1`, [boil]))).rejects.toThrow(/не удаляется/);
  });

  it('действующая сегодня норма — по сезону; чужая организация норм не видит', async () => {
    const t = await normsToday(cook.id, orgId, carrot);
    const md = Number((await today()).slice(5, 7)) * 100 + Number((await today()).slice(8, 10));
    expect((t.norms as any).clean.loss_pct).toBe(md >= 901 ? 20 : 25);
    await expect(listNorms(stranger.id, orgId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('подсказка из архива ТТК — статистика, не норма', async () => {
    const s = await suggestFromArchive(tech.id, orgId, carrot);
    expect(s.cold!.n).toBeGreaterThan(0);
    expect(s.cold!.min).toBeLessThanOrEqual(s.cold!.max);
  });
});

describe('Строка ТТК: шаги обработки, брутто/нетто/выход, учёт в выходе', () => {
  let coldPct: number;

  beforeAll(async () => {
    const d = await createDish(tech.id, orgId, { name: 'Морковь отварная', category: 'Гарниры' });
    dishId = d.id;
    v1 = (await getDish(tech.id, orgId, dishId)).current!.version.id;
    await updateVersion(tech.id, orgId, v1, { technology: 'Морковь очистить, отварить в подсоленной воде до готовности.', storageConditions: 'при +2…+6 °C', shelfLife: 'по СанПиН', yieldG: 100, portionG: 100 });
    coldPct = (((await normsToday(tech.id, orgId, carrot)).norms as any).clean.loss_pct);
  });

  it('выход 100 г: очистка + варка по нормам → брутто и нетто считаются', async () => {
    const l = await addLine(tech.id, orgId, v1, { productId: carrot, unit: 'г', netto: 100 });
    const r = await setLineSteps(tech.id, orgId, l.id, { steps: [{ method: 'clean' }, { method: 'boil' }], from: 'ready', value: 100 });
    const k = 1 - coldPct / 100;
    expect(r.ready).toBe(100);
    expect(r.netto).toBeCloseTo(100 / 0.97, 3);
    expect(r.brutto).toBeCloseTo(100 / 0.97 / k, 2);
    const line = await lineOf('Морковь свежая');
    expect(line.steps.map((s: any) => `${s.method_name} −${s.loss_pct} %`)).toEqual([`Очистка −${coldPct} %`, 'Варка −3 %']);
    expect(line.steps[0].basis).toMatch(/акт проработки № [12] \(с /);
  });

  it('без нормы — процент вручную только с основанием', async () => {
    const l = await addLine(tech.id, orgId, v1, { productId: rice, unit: 'г', netto: 40 });
    await expect(setLineSteps(tech.id, orgId, l.id, { steps: [{ method: 'boil' }], from: 'netto', value: 40 })).rejects.toThrow(/нет утверждённой нормы/);
    await expect(setLineSteps(tech.id, orgId, l.id, { steps: [{ method: 'boil', lossPct: -150 }], from: 'netto', value: 40 })).rejects.toThrow(/основание/);
    const r = await setLineSteps(tech.id, orgId, l.id, { steps: [{ method: 'boil', lossPct: -150, basis: 'Тест: акт контрольной проработки № 7' }], from: 'netto', value: 40 });
    expect(r).toMatchObject({ brutto: 40, netto: 40, ready: 100 });
    // привар — нетто не больше брутто (в препятствиях нет)
    expect((await getDish(tech.id, orgId, dishId)).current!.blockers.join(' ')).not.toMatch(/Рис.*нетто больше брутто/);
    await setLineSteps(tech.id, orgId, l.id, { steps: [], from: 'netto', value: 40 });
    await updateLine(tech.id, orgId, l.id, { unit: 'г', brutto: 0, netto: 0, ready: 0, inYield: false });
  });

  it('изменение величины в строке с шагами — пересчёт цепочкой', async () => {
    const l = await lineOf('Морковь свежая');
    await updateLine(tech.id, orgId, l.id, { unit: 'г', brutto: Number(l.brutto), netto: Number(l.netto), ready: 50 });
    const x = await lineOf('Морковь свежая');
    expect(Number(x.ready)).toBe(50);
    expect(Number(x.netto)).toBeCloseTo(50 / 0.97, 3);
  });

  it('соль не входит в выход; выход по обработке сверяется с выходом карты', async () => {
    await addLine(tech.id, orgId, v1, { productId: salt, unit: 'г', brutto: 2, netto: 2, inYield: false });
    const d = await getDish(tech.id, orgId, dishId);
    expect(d.current!.output.ready_g).toBe(50);
    expect(d.current!.warnings.join(' ')).toMatch(/Выход карты \(100 г\) расходится с выходом по обработке сырья \(50 г\)/);
    const l = await lineOf('Морковь свежая');
    await updateLine(tech.id, orgId, l.id, { unit: 'г', ready: 100, brutto: Number(l.brutto), netto: Number(l.netto) });
    expect((await getDish(tech.id, orgId, dishId)).current!.warnings.join(' ')).not.toMatch(/расходится/);
  });

  it('обработка по умолчанию подставляется в новую строку', async () => {
    await setNormDefault(tech.id, orgId, autumn, { isDefault: true });
    await setNormDefault(tech.id, orgId, winter, { isDefault: true });
    const l = await addLine(tech.id, orgId, v1, { name: 'Морковь для украшения', productId: carrot, unit: 'г', netto: 8 });
    expect(Number(l.brutto)).toBeCloseTo(8 / (1 - coldPct / 100), 3);
    const x = await lineOf('Морковь для украшения');
    expect(x.steps.map((s: any) => s.method_code)).toEqual(['clean']);
  });

  it('утверждённая ТТК: шаги не меняются; новая версия копирует шаги', async () => {
    const rice = await lineOf('Рис круглозёрный');
    await (await import('../src/server/ops/recipes')).removeLine(tech.id, orgId, rice.id);
    await submitVersion(tech.id, orgId, v1);
    await approveVersion(tech.id, orgId, v1);
    const l = (await getDish(tech.id, orgId, dishId)).current!.lines[0];
    await expect(setLineSteps(tech.id, orgId, l.id, { steps: [], from: 'brutto', value: 1 })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(withSystem((tx) => tx.query(`delete from ttk_line_steps where version_id = $1`, [v1]))).rejects.toThrow(/новой версией/);
    await newVersion(tech.id, orgId, dishId, { changeReason: 'Новая норма очистки' });
    const nv = await lineOf('Морковь свежая');
    expect(nv.steps).toHaveLength(2);
  });

  it('новая норма заменяет старую; черновики пересчитываются по решению человека, выход сохраняется', async () => {
    const n = await createNorm(tech.id, orgId, { productId: carrot, method: 'clean', lossPct: 10, basis: 'Тест: акт проработки № 9' });
    const res = await approveNorm(tech.id, orgId, n.id);
    expect(res.replaced).toBe(2);   // круглый год пересекается с обоими сезонами
    const before = await lineOf('Морковь свежая');
    expect(Number(before.ready)).toBe(100);
    expect((await applyNormToDrafts(tech.id, orgId, n.id)).lines).toBe(2);
    const after = await lineOf('Морковь свежая');
    expect(Number(after.ready)).toBe(100);
    expect(Number(after.brutto)).toBeCloseTo(100 / 0.97 / 0.9, 2);
    expect(after.steps[0]).toMatchObject({ loss_pct: 10, norm_id: n.id });
    await archiveNorm(tech.id, orgId, boil, { reason: 'Тест: заменим актом' });
    expect((await listNorms(tech.id, orgId, { productId: carrot })).norms.map((x: any) => x.method_code)).toEqual(['clean']);
  });

  it('КБЖУ учитывает потери нутриентов по норме варки', async () => {
    const k = (await getDish(tech.id, orgId, dishId)).current!.kbju;
    expect(k.losses).toBe('all');
  });
});

describe('Рецептура как в Шеф Эксперте: подзаголовки, выход через «/», номер и дата, вставка состава', () => {
  let steakId: string, sv: string;

  it('номер рецептуры — по порядку; дату и выход п/ф задаёт технолог', async () => {
    const a = await createDish(tech.id, orgId, { name: 'Стейк из свинины с крокетами', category: 'Горячее' });
    steakId = a.id;
    const d = await getDish(tech.id, orgId, steakId);
    sv = d.current!.version.id;
    expect(Number(d.dish.card_no)).toBeGreaterThan(1);
    await updateDish(tech.id, orgId, steakId, { cardNo: '199' });
    await updateVersion(tech.id, orgId, sv, { technology: 'Стейк обжарить, довести в пароконвектомате; картофель обжарить во фритюре.', storageConditions: 'на раздаче при +65 °C',
      shelfLife: 'по СанПиН', yieldG: 220, portionG: 220, cardDate: '2026-04-03', semiYieldG: 0 });
    const v = (await getDish(tech.id, orgId, steakId));
    expect(v.dish.card_no).toBe('199');
    expect(v.current!.version.card_date.toISOString?.() ?? String(v.current!.version.card_date)).toMatch(/2026-04-0[23]/);
  });

  it('подзаголовки делят состав; выход по разделам «120/100»; соль в выход не входит', async () => {
    await addLine(tech.id, orgId, sv, { name: 'Свинина корейка', productId: carrot, unit: 'г', brutto: 176, netto: 176, ready: 120 });
    await addLine(tech.id, orgId, sv, { productId: salt, unit: 'г', brutto: 2, netto: 2, inYield: false });
    await addHeading(tech.id, orgId, sv, { title: 'Гарнир' });
    await addLine(tech.id, orgId, sv, { name: 'Картофель фри', productId: rice, unit: 'г', brutto: 333, netto: 250, ready: 100 });
    const c = (await getDish(tech.id, orgId, steakId)).current!;
    expect(c.output.sections).toMatchObject({ label: '120/100', list: [{ title: null, ready_g: 120 }, { title: 'Гарнир', ready_g: 100 }] });
    const h = c.lines.find((l: any) => l.kind === 'heading')!;
    await expect(updateLine(tech.id, orgId, h.id, { unit: 'г', brutto: 1, netto: 1 })).rejects.toThrow(/подзаголовок/);
    await expect(setLineSteps(tech.id, orgId, h.id, { steps: [], from: 'brutto', value: 1 })).rejects.toThrow(/подзаголовок/);
    await renameHeading(tech.id, orgId, h.id, { title: 'Выход гарнира' });
    // подзаголовок не мешает утверждению и не попадает в рецептуру для списания
    expect((await getDish(tech.id, orgId, steakId)).current!.blockers).toEqual([]);
  });

  it('строку вверх/вниз: подзаголовок поднят — разделы пересчитаны', async () => {
    const c = (await getDish(tech.id, orgId, steakId)).current!;
    const h = c.lines.find((l: any) => l.kind === 'heading')!;
    await moveLine(tech.id, orgId, h.id, { dir: 'up' });   // соль уходит во второй раздел (в выход не входит)
    await moveLine(tech.id, orgId, h.id, { dir: 'up' });   // свинина тоже
    const x = (await getDish(tech.id, orgId, steakId)).current!;
    expect(x.lines[0].kind).toBe('heading');
    expect(x.output.sections!.label).toBe('220');
    await moveLine(tech.id, orgId, h.id, { dir: 'down' }); await moveLine(tech.id, orgId, h.id, { dir: 'down' });
    expect((await getDish(tech.id, orgId, steakId)).current!.output.sections!.label).toBe('120/100');
  });

  it('вставка состава из другой рецептуры — со строками, подзаголовками и обработкой', async () => {
    const b = await createDish(tech.id, orgId, { name: 'Стейк из свинины с овощами' });
    const bv = (await getDish(tech.id, orgId, b.id)).current!.version.id;
    await expect(insertFromDish(tech.id, orgId, bv, { dishId: b.id })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect((await insertFromDish(tech.id, orgId, bv, { dishId: steakId })).lines).toBe(4);
    const x = (await getDish(tech.id, orgId, b.id)).current!;
    expect(x.lines.map((l: any) => l.kind === 'heading' ? `# ${l.name_raw}` : l.name_raw)).toEqual(['Свинина корейка', 'Соль поваренная', '# Выход гарнира', 'Картофель фри']);
    // и из карты с шагами обработки: шаги копируются
    await insertFromDish(tech.id, orgId, bv, { dishId });
    expect((await getDish(tech.id, orgId, b.id)).current!.lines.filter((l: any) => l.steps.length).length).toBeGreaterThan(0);
  });

  it('после утверждения подзаголовок не попадает в состав для списания и производства', async () => {
    await submitVersion(tech.id, orgId, sv);
    await approveVersion(tech.id, orgId, sv);
    const r = await withSystem((tx) => approvedRecipe(tx, orgId, steakId));
    expect(r!.lines.map((l: any) => l.name_raw)).toEqual(['Свинина корейка', 'Соль поваренная', 'Картофель фри']);
    await expect(withSystem((tx) => tx.query(`update ttk_versions set card_date = '2020-01-01' where id = $1`, [sv]))).rejects.toThrow(/не изменяется/);
    const nv = await newVersion(tech.id, orgId, steakId, { changeReason: 'Проверка копирования подзаголовков' });
    expect((await getDish(tech.id, orgId, steakId, nv.id)).current!.output.sections!.label).toBe('120/100');
  });
});

describe('Калькуляционная карточка ОП-1: снимок цен, неизвестная цена ≠ 0', () => {
  let saladId: string;

  it('по утверждённой ТТК; нет цены партии — только вручную с основанием', async () => {
    const d = await createDish(tech.id, orgId, { name: 'Салат из моркови' });
    saladId = d.id;
    const sv = (await getDish(tech.id, orgId, saladId)).current!.version.id;
    await updateVersion(tech.id, orgId, sv, { technology: 'Морковь натереть, заправить, посолить.', storageConditions: 'при +2…+6 °C', shelfLife: 'по СанПиН', yieldG: 200, portionG: 100 });
    await addLine(tech.id, orgId, sv, { name: 'Морковь', productId: carrot, unit: 'г', brutto: 210, netto: 190 });
    await addLine(tech.id, orgId, sv, { productId: salt, unit: 'г', brutto: 2, netto: 2, inYield: false });
    await expect(previewCosting(owner.id, orgId, saladId)).rejects.toThrow(/нет утверждённой ТТК/);
    await submitVersion(tech.id, orgId, sv); await approveVersion(tech.id, orgId, sv);
    const p = await previewCosting(owner.id, orgId, saladId);
    expect(p.lines.map((l: any) => `${l.name}:${l.norm}`)).toEqual(['Морковь свежая:0.105', 'Соль поваренная:0.001']);
    expect(p.missing).toHaveLength(2);
    expect(p.cost_1).toBeNull();
    await expect(createCosting(owner.id, orgId, saladId, { salePrice: 150 })).rejects.toThrow(/нет цены закупки/);
    await expect(createCosting(owner.id, orgId, saladId, { salePrice: 150, prices: [{ key: `p:${carrot}`, price: 60, basis: '' }] })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(createCosting(cook.id, orgId, saladId, { salePrice: 150 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('утверждена: норма × цена, на 100 блюд, наценка; снимок не меняется; следующая — № 2', async () => {
    const c = await createCosting(owner.id, orgId, saladId, { salePrice: 150, signers: { chef: 'П. П. Петров' }, prices: [
      { key: `p:${carrot}`, price: 60, basis: 'Тест: прайс поставщика от 01.10' }, { key: `p:${salt}`, price: 20, basis: 'Тест: счёт № 5' }] });
    expect(c.seq).toBe(1);
    const card = await getCosting(owner.id, orgId, c.id);
    expect(card.lines.map((l: any) => `${l.norm}×${l.price}=${l.sum}`)).toEqual(['0.105×60=6.3', '0.001×20=0.02']);
    expect(Number(card.cost_1)).toBe(6.32);
    expect(Number(card.raw_100)).toBe(632);
    expect(Number(card.markup_pct)).toBe(Math.round((150 - 6.32) / 6.32 * 10000) / 100);
    expect(card.lines[0].price_source).toMatch(/^вручную: Тест: прайс/);
    await expect(withSystem((tx) => tx.query(`update costing_cards set cost_1 = 1 where id = $1`, [c.id]))).rejects.toThrow(/не изменяются/);
    const c2 = await createCosting(owner.id, orgId, saladId, { salePrice: 160, prices: [{ key: `p:${carrot}`, price: 70, basis: 'Тест: новый прайс' }, { key: `p:${salt}`, price: 20, basis: 'Тест: счёт № 5' }] });
    expect(c2.seq).toBe(2);
    expect((await listCosting(owner.id, orgId, saladId)).map((x: any) => x.seq)).toEqual([2, 1]);
    await expect(getCosting(cook.id, orgId, c.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
