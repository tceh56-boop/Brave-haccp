import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createProduct } from '../src/server/ops/catalog';
import { createDish, getDish, updateVersion, addLine, submitVersion, approveVersion } from '../src/server/ops/recipes';
import { getTechSpec, saveTechSpecParams, approveTechSpec, getTechSpecVersion, setProductNutrition, setProductAllergens, MICRO } from '../src/server/ops/techspec';
import { saveLaboratory, recordResult } from '../src/server/ops/lab';
import { addEvidence } from '../src/server/ops/evidence';
import { makeUser, lastLinkToken } from './helpers';

afterAll(() => closePool());

type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, chef: U, tech: U, cook: U, stranger: U;
let orgId: string, siteId: string, labId: string;
const P: Record<string, string> = {};
let sauce: string, casserole: string, draftOnly: string;

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}
async function withTtk(name: string, kind: 'dish' | 'semi', yieldG: number, technology: string, lines: Record<string, unknown>[], approve = true) {
  const d = await createDish(chef.id, orgId, { name, kind, salePrice: kind === 'dish' ? 350 : undefined });
  const v = (await getDish(chef.id, orgId, d.id)).current!.version.id;
  await updateVersion(chef.id, orgId, v, { yieldG, portionG: kind === 'dish' ? yieldG : undefined, technology, storageConditions: 'при +2…+6 °C', shelfLife: '24 часа', shelfLifeHours: 24, shelfBasis: 'протоколы лабораторных исследований (обоснование сроков)' });
  for (const l of lines) await addLine(chef.id, orgId, v, l);
  if (approve) { await submitVersion(chef.id, orgId, v); await approveVersion(chef.id, orgId, v); }
  return d.id as string;
}

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Кафе «Технические условия»' });
  siteId = r.site.id;
  orgId = r.organization.id;
  chef = await invite('chef'); tech = await invite('technologist'); cook = await invite('line_staff');
  stranger = await makeUser(); await createOrganization(stranger, { name: 'Чужое кафе' });
  for (const [k, name] of [['milk', 'Молоко 3,2%'], ['flour', 'Мука пшеничная'], ['butter', 'Масло сливочное 82,5%'], ['salt', 'Соль поваренная'], ['pasta', 'Макароны']])
    P[k] = (await createProduct(chef.id, orgId, { name, unit: 'кг' })).id;
  sauce = await withTtk('Соус бешамель', 'semi', 1000, 'Муку обжарить на масле, влить горячее молоко, варить 10 минут, посолить.', [
    { productId: P.milk, unit: 'кг', brutto: 0.9, netto: 0.9 }, { productId: P.flour, unit: 'кг', brutto: 0.06, netto: 0.06 },
    { productId: P.butter, unit: 'кг', brutto: 0.06, netto: 0.06 }, { productId: P.salt, unit: 'кг', brutto: 0.01, netto: 0.01 }]);
  casserole = await withTtk('Макароны с соусом', 'dish', 250, 'Отварить макароны, смешать с соусом.', [
    { subDishId: sauce, unit: 'г', brutto: 100, netto: 100 }, { productId: P.pasta, unit: 'г', brutto: 150, netto: 150 }]);
  draftOnly = await withTtk('Черновик', 'dish', 200, 'Смешать.', [{ productId: P.milk, unit: 'г', brutto: 200, netto: 200 }], false);
});

describe('Расчёт ТУ по утверждённой ТТК', () => {
  it('без утверждённой ТТК ТУ не рассчитываются; чужая организация не видит', async () => {
    await expect(getTechSpec(chef.id, orgId, draftOnly)).rejects.toThrow(/нет утверждённой ТТК/);
    await expect(getTechSpec(stranger.id, orgId, sauce)).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/) });
  });

  it('без данных — проект: нет пищевой ценности, профилей аллергенов, не подтверждена группа микробиологии; подсказка аллергенов по названию', async () => {
    const t = await getTechSpec(cook.id, orgId, sauce);
    expect(t.calc.status).toBe('project');
    expect(t.calc.nutrition.coverage_pct).toBe(0);
    expect(t.calc.nutrition.per100).toBeNull();                      // неизвестное — не ноль
    expect(t.calc.physico.filter((x: { indicator: string }) => /жира|белка/.test(x.indicator))).toEqual([]);
    expect(t.calc.processing).toMatchObject({ mode: 'thermal', auto: 'thermal' });
    const w = t.calc.warnings.join(' ');
    expect(w).toMatch(/Нет пищевой ценности: .*Молоко 3,2%/);
    expect(w).toMatch(/Нет профиля аллергенов/);
    expect(w).toMatch(/Группа продукции по ТР ТС 021\/2011 не подтверждена: система предлагает «Соусы и заправки для вторых блюд»/);
    expect(t.calc.allergens.contains).toEqual([]);
    expect(t.calc.allergens.suggest.map((a: { code: string }) => a.code).sort()).toEqual(['gluten', 'milk']);   // подсказка, не вывод
    expect(t.products.map((p: { name: string }) => p.name)).toEqual(['Масло сливочное 82,5%', 'Молоко 3,2%', 'Мука пшеничная', 'Соль поваренная']);
  });

  it('с данными по документу: КБЖУ (потери — только по нормам с основанием), физико-химия, рецептура на 100 кг, потери производства, аллергены', async () => {
    const doc = 'маркировка изготовителя на упаковке';
    await expect(setProductNutrition(cook.id, orgId, P.milk, { kcal: 60, protein: 2.9, fat: 3.2, carbs: 4.7, basis: doc })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(setProductNutrition(tech.id, orgId, P.milk, { kcal: 60, protein: 60, fat: 30, carbs: 20, basis: doc })).rejects.toThrow(/не больше 100 г/);
    await setProductNutrition(tech.id, orgId, P.milk, { kcal: 60, protein: '2,9', fat: '3,2', carbs: '4,7', basis: doc });
    await setProductNutrition(tech.id, orgId, P.flour, { kcal: 334, protein: 10.3, fat: 1.1, carbs: 70, basis: doc });
    await setProductNutrition(tech.id, orgId, P.butter, { kcal: 748, protein: 0.5, fat: 82.5, carbs: 0.8, basis: doc });
    await setProductNutrition(tech.id, orgId, P.salt, { kcal: 0, protein: 0, fat: 0, carbs: 0, basis: doc });
    await setProductAllergens(tech.id, orgId, P.milk, { allergens: ['milk'], basis: 'состав на маркировке' });
    await setProductAllergens(tech.id, orgId, P.flour, { allergens: ['gluten'], basis: 'состав на маркировке' });
    await setProductAllergens(tech.id, orgId, P.butter, { allergens: ['milk'], basis: 'состав на маркировке' });
    await setProductAllergens(tech.id, orgId, P.salt, { allergens: [], basis: 'спецификация поставщика: не содержит' });
    await expect(setProductAllergens(tech.id, orgId, P.salt, { allergens: ['соль'], basis: 'спецификация' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(withSystem((tx) => tx.query(`update product_nutrition set kcal_100 = 1 where product_id = $1`, [P.milk]))).rejects.toThrow(/не изменяются/);

    const c = (await getTechSpec(cook.id, orgId, sauce)).calc;
    // Б 32,58 / Ж 78,96 / У 84,78 г на закладку 1030 г, выход 1000 г; норм обработки с потерями нет — без потерь, с пометкой
    expect(c.nutrition.per100).toEqual({ protein: 3.3, fat: 7.9, carbs: 8.5, kcal: 118, kj: 493 });
    expect(c.warnings.join(' ')).toMatch(/Тепловая обработка без норм обработки сырья: потери пищевых веществ не учтены/);
    expect(c.nutrition).toMatchObject({ coverage_pct: 100, verified_pct: 100 });
    expect(c.object).toMatchObject({ yield_g: 1000, input_mass_g: 1030, production_loss_pct: 2.9 });
    expect(c.physico).toEqual(expect.arrayContaining([
      expect.objectContaining({ indicator: 'Массовая доля жира, %, не менее', calc: 7.9, norm: 7.1 }),
      expect.objectContaining({ indicator: 'Массовая доля белка, %, не менее', calc: 3.3, norm: 3 }),
      expect.objectContaining({ indicator: 'Массовая доля хлорида натрия (соли), %, не более', calc: 1, norm: 1.1 })]));
    expect(c.recipe.find((x: { name: string }) => x.name === 'Молоко 3,2%')).toMatchObject({ netto_g: 900, per_1kg_g: 900, per_100kg_kg: 90 });
    expect(c.allergens.contains.map((a: { code: string }) => a.code).sort()).toEqual(['gluten', 'milk']);
    expect(c.allergens.complete).toBe(true);

    const raw = (await saveTechSpecParams(chef.id, orgId, sauce, { processing: 'raw' }), (await getTechSpec(cook.id, orgId, sauce)).calc);
    expect(raw.nutrition.per100).toMatchObject({ protein: 3.3, fat: 7.9, carbs: 8.5 });   // без потерь
    await saveTechSpecParams(chef.id, orgId, sauce, { processing: null });
  });

  it('блюдо с п/ф: КБЖУ на порцию и аллергены через полуфабрикат; без профиля у сырья — неполно', async () => {
    const c = (await getTechSpec(cook.id, orgId, casserole)).calc;
    expect(c.object.portion_g).toBe(250);
    expect(c.nutrition.per_portion).not.toBeNull();
    expect(c.allergens.contains.find((a: { code: string; sources: string[] }) => a.code === 'milk')!.sources).toEqual(expect.arrayContaining(['Молоко 3,2% (в Соус бешамель)']));
    expect(c.allergens.no_profile).toEqual(['Макароны']);
    expect(c.allergens.suggest.map((a: { code: string }) => a.code)).toContain('gluten');
    expect(c.nutrition.coverage_pct).toBeLessThan(100);
    expect(c.recipe.map((r: { kind: string }) => r.kind)).toEqual(['п/ф', 'сырьё']);
  });

  it('КБЖУ в карточке блюда берёт данные по документу и считается подтверждённым', async () => {
    const d = await getDish(chef.id, orgId, sauce);
    expect(d.current!.kbju.verified).toBe(true);
    expect(d.current!.kbju.complete).toBe(true);
  });
});

/** Протокол аккредитованной лаборатории по всем нормируемым показателям ТУ блюда, со сканом. */
async function protocol(dishId: string, no: string) {
  if (!labId) labId = (await saveLaboratory(owner.id, orgId, null, { name: 'ИЛЦ «Тест»', accreditationNo: 'RA.RU.21ТС01', scope: 'Пищевая продукция: микробиологические показатели (КМАФАнМ, БГКП, S. aureus, патогенные)' })).id;
  const ind = (await getTechSpec(owner.id, orgId, dishId)).calc.micro.indicators.filter((i: { norm: string | null }) => i.norm);
  const r = await recordResult(owner.id, orgId, { siteId, testType: 'Микробиология', target: 'ТУ', dishId, laboratoryId: labId, sampleRef: `обр. ${no}`, protocolNo: no, sampledOn: '2026-10-15', resultOn: '2026-10-20',
    params: ind.map((i: { code: string; name: string; norm: string | null }) => ({ code: i.code, name: i.name.split(',')[0], norm: i.norm, fact: 'не обнаружено', pass: true })) });
  await addEvidence(owner.id, orgId, { entityType: 'lab_result', entityId: r.id, filename: `протокол-${no}.pdf` }, Buffer.from('%PDF-1.4\n'));
  return r.id as string;
}

describe('Параметры и утверждение ТУ', () => {
  it('параметры — разработчик ТТК; формат кодов проверяется; утверждение проекта невозможно', async () => {
    await expect(saveTechSpecParams(cook.id, orgId, sauce, { okpd2: '10.85.19' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(saveTechSpecParams(chef.id, orgId, sauce, { okpd2: 'десять' })).rejects.toThrow(/ОКПД2/);
    await expect(saveTechSpecParams(chef.id, orgId, sauce, { okpo: '123' })).rejects.toThrow(/ОКПО/);
    await expect(approveTechSpec(chef.id, orgId, sauce, { labResultIds: [await protocol(sauce, '14')] })).rejects.toThrow(/ТУ — проект, утвердить нельзя/);
  });

  it('полные проверенные данные + санитарные правила в реестре → «готов к испытаниям»; утверждение с протоколом — неизменяемый снимок', async () => {
    await saveTechSpecParams(tech.id, orgId, sauce, { okpd2: '10.85.19.110', tuLocation: 'Тульская обл., г. Тула', seq: '7', okpo: '12345678', microGroupCode: 'sauce', tolerance: 0.1 });
    // санитарные правила: утверждённая действующая редакция в реестре предприятия
    await withSystem(async (tx) => {
      const s = (await tx.query(`insert into reg_sources (organization_id, code, kind, title, binding) values ($1, 'СанПиН 2.3/2.4.4282-26', 'СанПиН', 'СанПиН 2.3/2.4.4282-26 (санитарные требования к организациям общественного питания)', 'mandatory') returning id`, [orgId])).rows[0];
      await tx.query(`insert into reg_source_versions (organization_id, source_id, edition, effective_from, workflow_status, last_checked_at, checked_by, check_evidence, approved_by, owner_user_id, next_check_at)
        values ($1, $2, 'утв. 02.06.2026 № 18', '2026-09-01', 'approved', now(), $3, 'сверено с официальной публикацией', $3, $3, now() + interval '90 days')`, [orgId, s.id, owner.id]);
    });
    const t = await getTechSpec(cook.id, orgId, sauce);
    expect(t.calc.warnings).toEqual([expect.stringMatching(/потери пищевых веществ не учтены/)]);   // предупреждение, не препятствие
    expect(t.calc.status).toBe('ready');
    expect(t.calc.designation).toBe(`ТУ 10.85.19-007-12345678-${new Date().getFullYear()}`);   // ГОСТ Р 51740-2016, 4.4.1: первые шесть знаков ОКПД2
    expect(t.calc.title).toMatchObject({ okpd2: '10.85.19.110', location: 'Тульская обл., г. Тула' });
    expect(t.calc.normative.map((d: { code: string }) => d.code)).toEqual(expect.arrayContaining(['ГОСТ Р 51740-2016', 'ГОСТ 10444.15-94', 'ГОСТ 31659-2012']));
    expect(t.calc.normative.map((d: { code: string }) => d.code)).not.toContain('ГОСТ 32031-2022');   // листерии для соусов не нормируются — метод не нужен
    expect(t.calc.normative.find((n: { code: string }) => n.code === 'СанПиН 2.3/2.4.4282-26')).toMatchObject({ state: 'действует, текст в нормативной базе' });
    const p15 = await protocol(sauce, '15');
    await expect(approveTechSpec(cook.id, orgId, sauce, { labResultIds: [p15] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(approveTechSpec(chef.id, orgId, sauce, { labResultIds: [] })).rejects.toThrow(/протоколы испытаний/);
    const v = await approveTechSpec(chef.id, orgId, sauce, { labResultIds: [p15] });
    expect(v.version).toBe(1);
    const got = await getTechSpecVersion(cook.id, orgId, sauce, 1);
    expect(got.snapshot.nutrition.per100.kcal).toBe(118);
    expect(got).toMatchObject({ designation: t.calc.designation, lab_protocol: 'протокол № 15 от 20.10.2026, ИЛЦ «Тест» (аттестат RA.RU.21ТС01)', lab_result_ids: [p15], change_note: 'первая редакция' });
    await expect(withSystem((tx) => tx.query(`update tech_spec_versions set lab_protocol = 'x' where dish_id = $1`, [sauce]))).rejects.toThrow(/не изменяются/);
    expect((await getTechSpec(cook.id, orgId, sauce)).versions).toEqual([expect.objectContaining({ version: 1 })]);
  });
});

describe('Протоколы испытаний для ТУ (ТЗ 5.4)', () => {
  it('не из реестра, без скана, чужой образец, не все показатели, лаборатория приостановлена — не утверждается; v2 — с записью изменения', async () => {
    const ind = (await getTechSpec(owner.id, orgId, sauce)).calc.micro.indicators.filter((i: { norm: string | null }) => i.norm);
    const base = { siteId, testType: 'Микробиология', target: 'ТУ', sampledOn: '2026-10-21', resultOn: '2026-10-25' };
    const all = ind.map((i: { code: string; name: string; norm: string | null }) => ({ code: i.code, name: i.name.split(',')[0], norm: i.norm, fact: 'не обнаружено', pass: true }));
    const noReg = (await recordResult(owner.id, orgId, { ...base, dishId: sauce, labName: 'Какая-то лаборатория', protocolNo: '21', params: all })).id;
    const noFile = (await recordResult(owner.id, orgId, { ...base, dishId: sauce, laboratoryId: labId, protocolNo: '22', params: all })).id;
    const other = (await recordResult(owner.id, orgId, { ...base, dishId: casserole, laboratoryId: labId, protocolNo: '23', params: all })).id;
    const partial = (await recordResult(owner.id, orgId, { ...base, dishId: sauce, laboratoryId: labId, protocolNo: '24', params: all.slice(0, 1) })).id;
    for (const id of [noReg, noFile, other, partial].filter((x) => x !== noFile)) await addEvidence(owner.id, orgId, { entityType: 'lab_result', entityId: id, filename: 'п.pdf' }, Buffer.from('%PDF-1.4\n'));
    const msg = async (ids: string[]) => (await approveTechSpec(chef.id, orgId, sauce, { labResultIds: ids, changeNote: 'уточнены показатели' }).then(() => '', (e: Error) => e.message));
    expect(await msg([noReg])).toMatch(/№ 21: лаборатория не из реестра/);
    expect(await msg([noFile])).toMatch(/№ 22: не приложен файл протокола/);
    expect(await msg([other])).toMatch(/№ 23: образец не связан с этим блюдом/);
    expect(await msg([partial])).toMatch(/не исследован ни в одном выбранном протоколе/);
    // повторная версия — только с записью в лист регистрации изменений
    const p26 = await protocol(sauce, '26');
    await expect(approveTechSpec(chef.id, orgId, sauce, { labResultIds: [p26] })).rejects.toThrow(/листа регистрации изменений/);
    const v2 = await approveTechSpec(chef.id, orgId, sauce, { labResultIds: [partial, p26], changeNote: 'новые протоколы испытаний' });
    expect(v2.version).toBe(2);
    const t = await getTechSpec(chef.id, orgId, sauce);
    expect(t.versions[0]).toMatchObject({ version: 2, change_note: 'новые протоколы испытаний', outdated: false, ppk_version: null, haccp_version: null });
    expect(t.protocols.map((p: { protocol_no: string }) => p.protocol_no)).toEqual(expect.arrayContaining(['15', '21', '22', '24', '26']));
    // лаборатория приостановлена — её протоколы больше не подтверждают ТУ
    await saveLaboratory(owner.id, orgId, labId, { name: 'ИЛЦ «Тест»', accreditationNo: 'RA.RU.21ТС01', scope: 'Пищевая продукция: микробиологические показатели (КМАФАнМ, БГКП, S. aureus, патогенные)', status: 'suspended' });
    expect(await msg([p26])).toMatch(/в реестре не действует/);
    await expect(recordResult(owner.id, orgId, { ...base, dishId: sauce, laboratoryId: labId, protocolNo: '27', params: all })).rejects.toThrow(/аккредитация приостановлена/);
    await saveLaboratory(owner.id, orgId, labId, { name: 'ИЛЦ «Тест»', accreditationNo: 'RA.RU.21ТС01', scope: 'Пищевая продукция: микробиологические показатели (КМАФАнМ, БГКП, S. aureus, патогенные)', status: 'active' });
  });

  it('новая ТТК — действующие ТУ помечаются «устарели»', async () => {
    const { newVersion } = await import('../src/server/ops/recipes');
    const nv = await newVersion(chef.id, orgId, sauce, { changeReason: 'уточнена технология' });
    await submitVersion(chef.id, orgId, nv.id); await approveVersion(chef.id, orgId, nv.id);
    expect((await getTechSpec(chef.id, orgId, sauce)).versions[0]).toMatchObject({ version: 2, outdated: true });
  });
});

describe('ТУ по нормативной базе: микробиология ТР ТС 021 и невозможные данные', () => {
  it('группа «Соусы и заправки для вторых блюд» — значения регламента с основанием; чего регламент не устанавливает — «не нормируется»', async () => {
    const m = (await getTechSpec(chef.id, orgId, sauce)).calc.micro;
    expect(m).toMatchObject({ mode: 'law', code: 'sauce', confirmed: true });
    const by = (c: string) => m.indicators.find((i: { code: string }) => i.code === c)!;
    expect(by('KMAFANM').norm).toBe('5×10³');
    expect(by('BGKP').norm).toBe('1,0');
    expect(by('SALMONELLA').norm).toBe('25');
    expect(by('LISTERIA').norm).toBeNull();
    expect(by('KMAFANM').basis).toMatch(/ТР ТС 021\/2011, прил\. 2, табл\. 1, п\. 1\.8/);
    await expect(saveTechSpecParams(tech.id, orgId, sauce, { microGroupCode: 'нет-такой' })).rejects.toThrow(/Нет такой группы/);
  });

  it('ссылки — на встроенную нормативную базу: СанПиН 2.3/2.4.4282-26 действует, ГОСТ без текста помечен', async () => {
    const n = (await getTechSpec(chef.id, orgId, sauce)).calc.normative;
    expect(n.find((d: { code: string }) => d.code === 'СанПиН 2.3/2.4.4282-26')!.state).toBe('действует, текст в нормативной базе');
    expect(n.find((d: { code: string }) => d.code === 'ГОСТ 30390-2013')!.state).toBe('текст в нормативную базу не загружен');
  });

  it('выход больше закладки — ошибка: ТУ не готовы и не утверждаются; «не менее 0» в показатели не попадает', async () => {
    const bad = await withTtk('Соус ошибочный', 'semi', 1000, 'Варить 5 минут.', [{ productId: P.salt, unit: 'г', brutto: 100, netto: 100 }]);
    await saveTechSpecParams(tech.id, orgId, bad, { microGroupCode: 'sauce' });
    const c = (await getTechSpec(chef.id, orgId, bad)).calc;
    expect(c.status).toBe('error');
    expect(c.errors.join(' ')).toMatch(/больше закладки нетто/);
    expect(c.physico.every((x: { norm: number | string }) => typeof x.norm !== 'number' || x.norm > 0)).toBe(true);
    await expect(approveTechSpec(chef.id, orgId, bad, { labResultIds: [await protocol(bad, '1')] })).rejects.toThrow(/больше закладки/);
  });
});

describe('Аллергены при ошибке данных', () => {
  it('строка не вошла в расчёт — «не содержит» не утверждается', async () => {
    const cream = (await createProduct(chef.id, orgId, { name: 'Сливки 33%', unit: 'л' })).id;
    const d = await withTtk('Соус со сливками', 'semi', 100, 'Варить 5 минут.', [{ productId: cream, unit: 'л', brutto: 0.1, netto: 0.1 }, { productId: P.salt, unit: 'г', brutto: 1, netto: 1 }]);
    const c = (await getTechSpec(chef.id, orgId, d)).calc;
    expect(c.errors.join(' ')).toMatch(/Сливки 33%: нет пересч/);
    expect(c.allergens.complete).toBe(false);
  });
});

describe('Правка черновика ТТК', () => {
  it('частичное сохранение не стирает остальные поля карты', async () => {
    const d = await createDish(chef.id, orgId, { name: 'Тефтели частично' });
    const v = (await getDish(chef.id, orgId, d.id)).current!.version.id;
    await updateVersion(chef.id, orgId, v, { yieldG: 1655, technology: 'Тушат в пароконвектомате.', storageConditions: 'не ниже +65 °C', shelfLife: '3 часа' });
    await updateVersion(chef.id, orgId, v, { portionG: 1655 });
    const x = (await getDish(chef.id, orgId, d.id)).current!.version;
    expect(x).toMatchObject({ technology: 'Тушат в пароконвектомате.', storage_conditions: 'не ниже +65 °C', shelf_life: '3 часа' });
    expect(Number(x.yield_g)).toBe(1655); expect(Number(x.portion_g)).toBe(1655);
    await updateVersion(chef.id, orgId, v, { shelfLife: '' });   // явная очистка
    expect((await getDish(chef.id, orgId, d.id)).current!.version.shelf_life).toBeNull();
  });
});
