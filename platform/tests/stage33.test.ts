import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, updateOrganization } from '../src/server/org/organizations';
import { createProduct } from '../src/server/ops/catalog';
import { createDish, getDish, updateVersion, addLine, submitVersion, approveVersion } from '../src/server/ops/recipes';
import { setMeatKind } from '../src/server/ops/declarations';
import { setProductNutrition, setProductAllergens, saveTechSpecParams } from '../src/server/ops/techspec';
import { createGroupTechSpec, updateGroupTechSpec, getGroupTechSpec, approveGroupTechSpec, getGroupTechSpecVersion, commonCategory } from '../src/server/ops/groupTechSpec';
import { makeUser } from './helpers';

/** Групповые ТУ по ГОСТ Р 51740-2016: ассортимент, код категории ОКПД2 (4.2.8), запрет смешения видов с разными показателями (4.3.8). */

afterAll(() => closePool());
let owner: Awaited<ReturnType<typeof makeUser>>, orgId: string;
const P: Record<string, string> = {};
const D: Record<string, string> = {};
const DOC = 'Тест: маркировка изготовителя';

async function semi(name: string, lines: [string, number][]) {
  const d = await createDish(owner.id, orgId, { name, kind: 'semi' });
  const v = (await getDish(owner.id, orgId, d.id)).current!.version.id;
  await updateVersion(owner.id, orgId, v, { yieldG: 1000, technology: 'Сырьё измельчают на мясорубке, перемешивают, формуют.', storageConditions: 'от +2 до +6 °C', shelfLife: '24 часа', shelfLifeHours: 24, shelfBasis: 'протоколы лабораторных исследований (обоснование сроков)',
    organoleptic: { appearance: 'однородная масса', color: 'розовый', consistency: 'упругая', taste: 'свойственный сырью' } });
  for (const [p, kg] of lines) await addLine(owner.id, orgId, v, { productId: p, unit: 'кг', brutto: kg, netto: kg });
  await submitVersion(owner.id, orgId, v); await approveVersion(owner.id, orgId, v);
  return d.id;
}

beforeAll(async () => {
  owner = await makeUser();
  orgId = (await createOrganization(owner, { name: 'Цех полуфабрикатов', legalForm: 'ООО', inn: '7100000077' })).organization.id;
  await updateOrganization(owner.id, orgId, { region: 'Тульская область' });
  for (const [k, name, kind, n] of [['beef', 'Говядина', 'slaughter', [187, 18.9, 12.4, 0]], ['pork', 'Свинина', 'slaughter', [259, 16, 21.6, 0]], ['onion', 'Лук', 'none', [41, 1.4, 0, 8.2]],
    ['chicken', 'Филе куриное', 'poultry', [113, 23.6, 1.9, 0.4]]] as const) {
    P[k] = (await createProduct(owner.id, orgId, { name, unit: 'кг' })).id;
    await setMeatKind(owner.id, orgId, P[k], { meatKind: kind });
    await setProductNutrition(owner.id, orgId, P[k], { kcal: n[0], protein: n[1], fat: n[2], carbs: n[3], basis: DOC });
    await setProductAllergens(owner.id, orgId, P[k], { allergens: [], basis: DOC });
  }
  D.beef = await semi('Фарш говяжий', [[P.beef, 0.9], [P.onion, 0.1]]);
  D.mix = await semi('Фарш домашний', [[P.beef, 0.45], [P.pork, 0.45], [P.onion, 0.1]]);
  D.chicken = await semi('Фарш куриный', [[P.chicken, 0.9], [P.onion, 0.1]]);
  for (const k of ['beef', 'mix']) await saveTechSpecParams(owner.id, orgId, D[k], { microGroupCode: 'm034_5c', processing: 'raw' });
  await saveTechSpecParams(owner.id, orgId, D.chicken, { microGroupCode: 'p051_3d', processing: 'raw' });
});

describe('Групповые ТУ', () => {
  it('код категории — общее начало кодов наименований', () => {
    expect(commonCategory(['10.13.14.700', '10.13.14.790'])).toBe('10.13.14');
    expect(commonCategory(['10.13.14.700', '10.12.10.110'])).toBe(null);
  });

  it('проект: меньше двух наименований нельзя; мясо и птица в одних ТУ — ошибка', async () => {
    await expect(createGroupTechSpec(owner.id, orgId, { title: 'Фарши', dishIds: [D.beef] })).rejects.toThrow(/не менее двух/);
    const g = await createGroupTechSpec(owner.id, orgId, { title: 'Полуфабрикаты мясные рубленые', dishIds: [D.beef, D.mix, D.chicken] });
    const x = await getGroupTechSpec(owner.id, orgId, g.id);
    expect(x.calc.errors.join(' ')).toMatch(/разных регламентов/);
  });

  it('фарши по ТР ТС 034: категория ОКПД2, ассортимент, обозначение; код категории, не включающий наименование, — ошибка', async () => {
    const g = await createGroupTechSpec(owner.id, orgId, { title: 'Полуфабрикаты мясные рубленые', dishIds: [D.beef, D.mix] });
    let x = await updateGroupTechSpec(owner.id, orgId, g.id, { items: { [D.beef]: { okpd2: '10.13.14.700' }, [D.mix]: { okpd2: '10.13.14.700' } }, okpo: '12345678', tuLocation: 'Тульская обл., г. Тула' });
    expect(x.calc.suggested_category).toBe('10.13.14.700');
    expect(x.calc.items.map((i) => i.name)).toEqual(['Фарш говяжий', 'Фарш домашний']);
    expect(x.calc.items.every((i) => i.micro.code === 'm034_5c' && i.meat_regulation === 'trts034')).toBe(true);
    expect(x.calc.normative.map((n) => n.code)).toContain('ТР ТС 034/2013');
    expect(x.calc.designation).toMatch(/^ТУ 10\.13\.14-00\d-12345678-\d{4}$/);
    x = await updateGroupTechSpec(owner.id, orgId, g.id, { okpd2: '10.12' });
    expect(x.calc.errors.join(' ')).toMatch(/не включает коды всех наименований.*4\.2\.8/);
    x = await updateGroupTechSpec(owner.id, orgId, g.id, { okpd2: '10.13.14' });
    expect(x.calc.errors).toEqual([]);
    expect(x.calc.status, x.calc.warnings.join(' | ')).toBe('ready');
    const a = await approveGroupTechSpec(owner.id, orgId, g.id, { labProtocol: 'Протоколы № 1/26 и № 2/26 от 01.11.2026, ИЛЦ' });
    expect(a.content_hash).toMatch(/^[0-9a-f]{64}$/);
    const v = await getGroupTechSpecVersion(owner.id, orgId, g.id, 1);
    expect(v.integrity.content_hash).toBe(a.content_hash);
    await expect(withSystem((tx) => tx.query(`update group_tech_spec_versions set lab_protocol = 'x' where spec_id = $1`, [g.id]))).rejects.toThrow();
  });

  it('разные виды ОКПД2 с разными показателями в одних ТУ — ошибка (4.3.8)', async () => {
    const other = await semi('Фарш свиной', [[P.pork, 0.9], [P.onion, 0.1]]);
    await saveTechSpecParams(owner.id, orgId, other, { microGroupCode: 'm034_5a', processing: 'raw' });
    const g = await createGroupTechSpec(owner.id, orgId, { title: 'Полуфабрикаты мясные', dishIds: [D.beef, other] });
    const x = await updateGroupTechSpec(owner.id, orgId, g.id, { items: { [D.beef]: { okpd2: '10.13.14.700' }, [other]: { okpd2: '10.13.14.710' } } });
    expect(x.calc.errors.join(' ')).toMatch(/разных видов ОКПД2.*4\.3\.8/);
  });
});
