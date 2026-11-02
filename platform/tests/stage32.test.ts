import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization } from '../src/server/org/organizations';
import { createProduct } from '../src/server/ops/catalog';
import { createDish, getDish, updateVersion, addLine, submitVersion, approveVersion } from '../src/server/ops/recipes';
import { setMeatKind } from '../src/server/ops/declarations';
import { calcTechSpec } from '../src/server/ops/techspec';
import { MICRO_GROUPS, resolveMicro } from '../src/server/norms/micro';
import { makeUser } from './helpers';

/** Микробиология мясной продукции и продукции из мяса птицы: ТР ТС 034/2013 и ТР ЕАЭС 051/2021, прил. 1; выбор группы в ТУ по составу. */

afterAll(() => closePool());
let owner: Awaited<ReturnType<typeof makeUser>>, orgId: string;
const D = { beef: '', chicken: '' };

async function dish(name: string, lines: [string, number][]) {
  const d = await createDish(owner.id, orgId, { name, kind: 'semi' });
  const v = (await getDish(owner.id, orgId, d.id)).current!.version.id;
  await updateVersion(owner.id, orgId, v, { yieldG: 1000, technology: 'Сырьё измельчают и перемешивают.', storageConditions: 'от +2 до +6 °C', shelfLife: '24 часа', shelfLifeHours: 24 });
  for (const [p, kg] of lines) await addLine(owner.id, orgId, v, { productId: p, unit: 'кг', brutto: kg, netto: kg });
  await submitVersion(owner.id, orgId, v); await approveVersion(owner.id, orgId, v);
  return d.id;
}

beforeAll(async () => {
  owner = await makeUser();
  orgId = (await createOrganization(owner, { name: 'Цех фарша' })).organization.id;
  const beef = (await createProduct(owner.id, orgId, { name: 'Говядина', unit: 'кг' })).id;
  const chicken = (await createProduct(owner.id, orgId, { name: 'Филе куриное', unit: 'кг' })).id;
  const onion = (await createProduct(owner.id, orgId, { name: 'Лук', unit: 'кг' })).id;
  await setMeatKind(owner.id, orgId, beef, { meatKind: 'slaughter' });
  await setMeatKind(owner.id, orgId, chicken, { meatKind: 'poultry' });
  await setMeatKind(owner.id, orgId, onion, { meatKind: 'none' });
  D.beef = await dish('Фарш говяжий', [[beef, 0.9], [onion, 0.1]]);
  D.chicken = await dish('Фарш куриный', [[chicken, 0.9], [onion, 0.1]]);
});

describe('Справочник групп', () => {
  it('ТР ТС 034: фарш — КМАФАнМ 5×10⁶, БГКП 0,0001 г; патогены и листерии — по ТР ТС 021, прил. 1', () => {
    const r = resolveMicro({ microGroupCode: 'm034_5c' }, '');
    const v = Object.fromEntries(r.indicators.filter((i) => i.norm).map((i) => [i.code, i.norm]));
    expect(v).toEqual({ KMAFANM: '5×10⁶', BGKP: '0,0001', SALMONELLA: '25', LISTERIA: '25' });
    expect(r.indicators.find((i) => i.code === 'LISTERIA')!.basis).toBe('ТР ТС 021/2011, прил. 1 — «Мясо и мясная продукция»');
    expect(r.indicators.find((i) => i.code === 'KMAFANM')!.basis).toMatch(/^ТР ТС 034\/2013, прил. 1, п. 5 «в»/);
  });
  it('ТР ЕАЭС 051: кулинарные изделия из мяса птицы — КМАФАнМ 1×10³, клостридии 0,1 г; замороженные блюда — энтерококки', () => {
    const r = resolveMicro({ microGroupCode: 'p051_8g' }, '');
    expect(Object.fromEntries(r.indicators.filter((i) => i.norm).map((i) => [i.code, i.norm]))).toMatchObject({ KMAFANM: '1×10³', CLOSTRIDIA: '0,1', BGKP: '1,0', SAUREUS: '1,0', PROTEUS: '0,1', SALMONELLA: '25', LISTERIA: '25' });
    expect(MICRO_GROUPS.find((g) => g.code === 'p051_5a')!.values).toMatchObject({ KMAFANM: '1×10⁴', ENTEROCOCCUS: '1×10⁴' });
    expect(MICRO_GROUPS.find((g) => g.code === 'm034_22a')!.values).toMatchObject({ KMAFANM: '1×10⁴', ENTEROCOCCUS: '1×10³' });
  });
});

describe('ТУ: группа нормативов — из регламента, под который продукция подпадает по составу', () => {
  it('фарш говяжий: группа ТР ТС 034 — без ошибок, ТР ТС 034 в нормативных ссылках; группа ТР ЕАЭС 051 — ошибка', async () => {
    const ok = await withSystem((tx) => calcTechSpec(tx, orgId, D.beef, { microGroupCode: 'm034_5c' }));
    expect(ok.meat_regulation).toBe('trts034');
    expect(ok.errors.join(' ')).not.toMatch(/Группа/);
    expect(ok.normative.map((n) => n.code)).toEqual(expect.arrayContaining(['ТР ТС 034/2013', 'ГОСТ 31659-2012']));
    expect(ok.normative.map((n) => n.code)).not.toContain('ТР ЕАЭС 051/2021');
    const bad = await withSystem((tx) => calcTechSpec(tx, orgId, D.beef, { microGroupCode: 'p051_3d' }));
    expect(bad.errors.join(' ')).toMatch(/из ТР ЕАЭС 051\/2021, а по составу продукция относится к ТР ТС 034\/2013/);
  });
  it('фарш куриный: ТР ЕАЭС 051; группа ТР ТС 021 (общепит) — предупреждение, а не молчание', async () => {
    const w = await withSystem((tx) => calcTechSpec(tx, orgId, D.chicken, { microGroupCode: 'poultry' }));
    expect(w.meat_regulation).toBe('trts051');
    expect(w.warnings.join(' ')).toMatch(/По составу продукция — ТР ЕАЭС 051\/2021/);
    const ok = await withSystem((tx) => calcTechSpec(tx, orgId, D.chicken, { microGroupCode: 'p051_3d' }));
    expect(ok.errors.join(' ')).not.toMatch(/Группа/);
    expect(ok.normative.map((n) => n.code)).toContain('ТР ЕАЭС 051/2021');
  });
});
