import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation, updateOrganization, updateSite } from '../src/server/org/organizations';
import { createProduct } from '../src/server/ops/catalog';
import { createDish, getDish, updateVersion, addLine, submitVersion, approveVersion } from '../src/server/ops/recipes';
import { addEvidence } from '../src/server/ops/evidence';
import { saveProfile } from '../src/server/ops/regulatory';
import { validateEnterpriseReadiness } from '../src/server/readiness/engine';
import {
  createDeclaration, getDeclaration, updateDeclaration, setMeatKind, acceptDeclaration, registerDeclaration, terminateDeclaration, listDeclarations,
  activeDeclarationFor, suggestMeatKind,
} from '../src/server/ops/declarations';
import { makeUser, lastLinkToken } from './helpers';

/** Декларация о соответствии: ТР ТС 021/2011 ст. 21–23, ТР ТС 034/2013, решения ЕЭК N 293 и N 44, приказ МЭР N 478. */

afterAll(() => closePool());
type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, tech: U, orgId: string, siteId: string;
const P = { beef: '', onion: '', rice: '', chicken: '', salt: '' };
const D = { meatballs: '', chickenCutlet: '', soup: '' };
const PDF = Buffer.from('%PDF-1.4\n% протокол испытаний\n');
const inDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}
async function dish(name: string, lines: [string, number][]) {
  const d = await createDish(owner.id, orgId, { name, kind: 'dish' });
  const v = (await getDish(owner.id, orgId, d.id)).current!.version.id;
  await updateVersion(owner.id, orgId, v, { yieldG: 1000, portionG: 250, technology: 'Ингредиенты подготавливают, формуют, тушат до готовности.', storageConditions: 'при температуре от +2 до +6 °C', shelfLife: '48 часов', shelfLifeHours: 48 });
  for (const [p, kg] of lines) await addLine(owner.id, orgId, v, { productId: p, unit: 'кг', brutto: kg, netto: kg });
  await submitVersion(owner.id, orgId, v); await approveVersion(owner.id, orgId, v);
  return d.id;
}

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Кулинария «Тефтель»', legalForm: 'ООО', inn: '7100000001', phone: '+7 900 000-00-00' });
  orgId = r.organization.id; siteId = r.site.id;
  tech = await invite('technologist');
  P.beef = (await createProduct(owner.id, orgId, { name: 'Говядина т/б', unit: 'кг' })).id;
  P.onion = (await createProduct(owner.id, orgId, { name: 'Лук репчатый', unit: 'кг' })).id;
  P.rice = (await createProduct(owner.id, orgId, { name: 'Рис', unit: 'кг' })).id;
  P.chicken = (await createProduct(owner.id, orgId, { name: 'Филе куриное', unit: 'кг' })).id;
  P.salt = (await createProduct(owner.id, orgId, { name: 'Соль поваренная', unit: 'кг' })).id;
  D.meatballs = await dish('Тефтели с рисом', [[P.beef, 0.3], [P.onion, 0.2], [P.rice, 0.5]]);
  D.chickenCutlet = await dish('Котлета куриная', [[P.chicken, 0.5], [P.beef, 0.1], [P.onion, 0.4]]);
  D.soup = await dish('Суп рисовый', [[P.beef, 0.03], [P.rice, 0.5], [P.onion, 0.47]]);
});

describe('Вид сырья и применимость регламентов', () => {
  it('подсказка по названию — только предложение; без подтверждённого вида регламент не определяется', async () => {
    expect(suggestMeatKind('Говядина т/б')).toBe('slaughter');
    expect(suggestMeatKind('Филе куриное')).toBe('poultry');
    expect(suggestMeatKind('Рис')).toBe('none');
    const d = await createDeclaration(tech.id, orgId, { dishId: D.meatballs, siteId });
    const v = await getDeclaration(tech.id, orgId, d.id);
    expect(v.regime.reg034).toBeNull();
    expect(v.errors.map((e) => e.text).join(' ')).toMatch(/Не указан вид сырья.*Говядина т\/б/);
  });

  it('30 % продуктов убоя — ТР ТС 034, мясосодержащий, только схемы 3д/4д/6д', async () => {
    await setMeatKind(tech.id, orgId, P.beef, { meatKind: 'slaughter' });
    for (const p of [P.onion, P.rice, P.salt]) await setMeatKind(tech.id, orgId, p, { meatKind: 'none' });
    await setMeatKind(tech.id, orgId, P.chicken, { meatKind: 'poultry' });
    const d = (await listDeclarations(owner.id, orgId))[0];
    const v = await getDeclaration(owner.id, orgId, d.id);
    expect(v.regime).toMatchObject({ reg034: true, schemes: ['3д', '4д', '6д'], meat: { meat_pct: 30, group: 'мясосодержащий' } });
    expect(v.regime.regulations).toContain('ТР ТС 034/2013 «О безопасности мяса и мясной продукции»');
  });

  it('птица больше продуктов убоя и не меньше 5 % — ТР ЕАЭС 051/2021, схемы 3д/4д/6д, без ТР ТС 034', async () => {
    const d = await createDeclaration(owner.id, orgId, { dishId: D.chickenCutlet, siteId });
    const v = await getDeclaration(owner.id, orgId, d.id);
    expect(v.regime).toMatchObject({ special: 'trts051', reg034: false, schemes: ['3д', '4д', '6д'], meat: { poultry_pct: 50, slaughter_pct: 10 } });
    expect(v.regime.regulations).toContain('ТР ЕАЭС 051/2021 «О безопасности мяса птицы и продукции его переработки»');
    expect(v.regime.regulations.join(' ')).not.toMatch(/034/);
    const u = await updateDeclaration(owner.id, orgId, d.id, { channel: 'outside', scheme: '1д', noTerm: true });
    const t = u.errors.map((e) => e.text).join(' | ');
    expect(t).toMatch(/Схема 1д не установлена ТР ЕАЭС 051\/2021 \(п\. 130/);
    expect(t).toMatch(/ТР ЕАЭС 051\/2021 устанавливает срок действия/);
    expect(u.notes.join(' ')).toMatch(/п\. 115–116/);
  });

  it('мясных ингредиентов менее 5 % — ТР ТС 021, схемы 1д/2д/3д', async () => {
    const d = await createDeclaration(owner.id, orgId, { dishId: D.soup, siteId });
    const v = await getDeclaration(owner.id, orgId, d.id);
    expect(v.regime).toMatchObject({ reg034: false, schemes: ['1д', '2д', '3д'] });
    expect(v.notes.join(' ')).toMatch(/менее|< 5 %/);
  });

  it('продажа в зале — декларация не оформляется; специализированная продукция — госрегистрация', async () => {
    const d = (await listDeclarations(owner.id, orgId)).find((x) => x.dish === 'Суп рисовый')!;
    let v = await updateDeclaration(owner.id, orgId, d.id, { channel: 'services' });
    expect(v.regime.decision).toBe('not_required');
    expect(v.errors.map((e) => e.text).join(' ')).toMatch(/ст\. 21 ч\. 3/);
    v = await updateDeclaration(owner.id, orgId, d.id, { channel: 'outside', specialized: true });
    expect(v.regime.decision).toBe('state_registration');
    v = await updateDeclaration(owner.id, orgId, d.id, { specialized: false, channel: 'offsite' });
    expect(v.regime.decision).toBe('decided_by_applicant');
  });
});

describe('Проект декларации, принятие, регистрация', () => {
  let id: string, fileId: string;

  it('незаполненные поля — замечания со ссылкой на пункт; принять нельзя', async () => {
    id = (await listDeclarations(owner.id, orgId)).find((x) => x.dish === 'Тефтели с рисом')!.id;
    const v = await updateDeclaration(tech.id, orgId, id, { channel: 'outside', scheme: '1д' });
    const t = v.errors.map((e) => `[${e.field}] ${e.text}`).join(' | ');
    expect(t).toMatch(/\[7\] Схема 1д не установлена ТР ТС 034/);
    expect(t).toMatch(/\[3\] Не указан ОГРН/);
    expect(t).toMatch(/\[3\] .*электронной почты/);
    expect(t).toMatch(/\[3\] .*уведомлении о начале/);
    expect(t).toMatch(/\[4\] Укажите должность/);
    expect(t).toMatch(/\[5\] Не указан код ТН ВЭД/);
    expect(t).toMatch(/\[7\] Нет протоколов/);
    expect(v.errors.every((e) => e.basis.length > 0)).toBe(true);
    await expect(acceptDeclaration(owner.id, orgId, id)).rejects.toThrow(/Принять нельзя/);
  });

  it('аккредитация лаборатории, скан протокола и предельный срок по схеме проверяются', async () => {
    await updateOrganization(owner.id, orgId, { ogrn: '1027100000001', legalAddress: '300000, Тульская обл., г. Тула, ул. Ленина, д. 1', email: 'info@teftel.test',
      headPosition: 'Генеральный директор', headName: 'Иванов Иван Иванович', headBasis: 'Устава', activityNotice: 'Уведомление о начале деятельности № 1 от 01.02.2024, Управление Роспотребнадзора по Тульской области' });
    await updateSite(owner.id, orgId, siteId, { address: '300000, Тульская обл., г. Тула, ул. Ленина, д. 1' });
    let v = await updateDeclaration(tech.id, orgId, id, { scheme: '3д', tnved: '1602 50', validTo: inDays(365 * 4),
      protocols: [{ number: '15/26', date: inDays(-3), lab: 'ИЛЦ ФБУЗ «Центр гигиены и эпидемиологии в Тульской области»', accreditation: null, sampleMadeOn: inDays(-10) }] });
    let t = v.errors.map((e) => e.text).join(' | ');
    expect(t).toMatch(/аккредитованной лаборатории — укажите уникальный номер записи/);
    expect(t).toMatch(/прикрепите скан-копию протокола/);
    expect(t).toMatch(/не более 3 лет/);
    fileId = (await addEvidence(tech.id, orgId, { entityType: 'declaration', entityId: id, filename: 'протокол 15-26.pdf' }, PDF)).id;
    v = await updateDeclaration(tech.id, orgId, id, { validTo: inDays(365 * 3 - 5),
      protocols: [{ number: '15/26', date: inDays(-3), lab: 'ИЛЦ ФБУЗ «Центр гигиены и эпидемиологии в Тульской области»', accreditation: 'RA.RU.510001', sampleMadeOn: inDays(-10), fileId }] });
    expect(v.errors).toEqual([]);
    expect(v.fields.f3).toMatch(/^Общество с ограниченной ответственностью «Кулинария «Тефтель»»|^Общество с ограниченной ответственностью/);
    expect(v.fields.f3).toMatch(/ОГРН: 1027100000001/);
    expect(v.fields.f4).toBe('Генеральный директор Иванов Иван Иванович, действующего на основании Устава');
    expect(v.fields.f5).toMatch(/Тефтели с рисом \(мясосодержащий продукт\).*Код ТН ВЭД ЕАЭС 160250.*Серийный выпуск/);
    expect(v.fields.f6).toBe('ТР ТС 021/2011 «О безопасности пищевой продукции», ТР ТС 022/2011 «Пищевая продукция в части ее маркировки», ТР ТС 034/2013 «О безопасности мяса и мясной продукции»');
    expect(v.fields.f7).toMatch(/Протокол испытаний № 15\/26 .*RA\.RU\.510001.*Схема декларирования соответствия: 3д/);
    expect(v.fields.f8).toMatch(/Условия хранения: при температуре от \+2 до \+6 °C\. Срок годности: 48 часов\. Декларация о соответствии распространяется/);
    expect(v.complect.find((c) => /Протоколы испытаний продукции/.test(c.item))!.status).toBe('ok');
    expect(v.application.find((a) => /п\. 7\.2/.test(a.label))!.value).toBe('ОГРН 1027100000001');
  });

  it('принимает только руководитель (decl.accept); после принятия текст не меняется', async () => {
    await expect(acceptDeclaration(tech.id, orgId, id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const a = await acceptDeclaration(owner.id, orgId, id);
    expect(a.content_hash).toMatch(/^[0-9a-f]{64}$/);
    await expect(updateDeclaration(tech.id, orgId, id, { tnved: '1602' })).rejects.toThrow(/не изменяется/);
    await expect(withSystem((tx) => tx.query(`update declarations set input = '{}' where id = $1`, [id]))).rejects.toThrow(/не изменяется/);
    const v = await getDeclaration(tech.id, orgId, id);
    expect(v.status).toBe('accepted');
    expect(v.integrity?.content_hash).toBe(a.content_hash);
  });

  it('регистрация: номер по формату реестра, срок схемы считается от даты регистрации; повторно не вносится', async () => {
    await expect(registerDeclaration(owner.id, orgId, id, { regNumber: '12345/26', regDate: inDays(0) })).rejects.toThrow(/ЕАЭС N RU Д-RU/);
    await expect(registerDeclaration(owner.id, orgId, id, { regNumber: 'ЕАЭС N RU Д-RU.РА01.В.12345/26', regDate: inDays(1) })).rejects.toThrow(/позже сегодняшней/);
    expect(await withSystem((tx) => activeDeclarationFor(tx, orgId, D.meatballs))).toBeNull();
    const r = await registerDeclaration(owner.id, orgId, id, { regNumber: 'ЕАЭС № RU Д-RU.РА01.В.12345/26', regDate: inDays(0) });
    expect(r.reg_number).toBe('ЕАЭС N RU Д-RU.РА01.В.12345/26');
    await expect(registerDeclaration(owner.id, orgId, id, { regNumber: 'ЕАЭС N RU Д-RU.РА01.В.99999/26', regDate: inDays(0) })).rejects.toThrow(/уже внесены/);
    const v = await getDeclaration(owner.id, orgId, id);
    expect(v).toMatchObject({ status: 'registered', fields: { f11: 'ЕАЭС N RU Д-RU.РА01.В.12345/26' } });
    expect((await withSystem((tx) => activeDeclarationFor(tx, orgId, D.meatballs)))?.reg_number).toBe(r.reg_number);
  });

  it('движок готовности: при продаже вне услуг питания — действующая декларация засчитывается', async () => {
    await saveProfile(owner.id, orgId, { objectTypes: ['cafe'], features: ['outside_sales'] });
    const it0 = (await withSystem((tx) => validateEnterpriseReadiness(tx, orgId, null, { keys: ['declarations'] }))).items[0];
    expect(it0, it0.detail).toMatchObject({ status: 'ok' });
    expect(it0.basis).toContain('trts034:132');
  });

  it('подмена принятого текста в базе — выдача заблокирована, событие в аудите', async () => {
    await withSystem(async (tx) => {
      await tx.query(`alter table declaration_acceptances disable trigger user`);
      await tx.query(`update declaration_acceptances set snapshot = jsonb_set(snapshot, '{fields,f9}', '"31.12.2099"') where declaration_id = $1`, [id]);
      await tx.query(`alter table declaration_acceptances enable trigger user`);
    });
    await expect(getDeclaration(owner.id, orgId, id)).rejects.toThrow(/не прошёл проверку целостности/);
    const n = (await withSystem((tx) => tx.query(`select count(*)::int as n from audit_events where organization_id = $1 and action = 'security.snapshot_mismatch'`, [orgId]))).rows[0].n;
    expect(n).toBeGreaterThan(0);
  });

  it('прекращение действия — знак ЕАС больше не разрешён', async () => {
    await terminateDeclaration(owner.id, orgId, id, { on: inDays(0), reason: 'Изменение рецептуры' });
    expect(await withSystem((tx) => activeDeclarationFor(tx, orgId, D.meatballs))).toBeNull();
  });

  it('чужая организация декларацию не видит', async () => {
    const stranger = await makeUser();
    await createOrganization(stranger, { name: 'Чужое кафе' });
    await expect(getDeclaration(stranger.id, orgId, id)).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/) });
  });
});
