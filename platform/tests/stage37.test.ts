import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { parseCsv, parsePercent, parseExposure, importRegimes, approveRegime, updateAgent, archiveRegime } from '../src/server/ops/disinfectants';
import { approveDisinfectant, createPlan, listSanitation, recordDone } from '../src/server/ops/sanitation';
import { addEvidence } from '../src/server/ops/evidence';
import { makeUser, lastLinkToken } from './helpers';

/** ТЗ 3.0 §16.1, §25.2: режимы дезсредств по объектам, импорт таблицы с предпросмотром и протоколом. */

afterAll(() => closePool());
type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, haccp: U, cook: U, orgId: string, siteId: string;
const PDF = Buffer.from('%PDF-1.4\n% инструкция\n');
const CSV = [
  'Средство,Объект обработки,Концентрация раствора,Время экспозиции,Способ обработки,Расход,Срок годности раствора',
  'ДЕЗ-А,"Поверхности, жёсткая мебель","0,5%",30 мин,Протирание,150 мл/м²,28 суток',
  ',Посуда с остатками пищи,"2,0%",30 мин,Погружение,2 л/комплект,28 суток',
  ',Туберкулёз: посуда,15-20%,30-120 мин,Погружение,2 л/комплект,28 суток',
  'ГЕЛЬ-Б,"Поверхности, оборудование",Готовый раствор,30 сек – 3 мин,"Протирание, орошение",30 мл/м²,Готовое средство',
  'МОЮЩЕЕ-В,"Полы, стены","0,5-3%",Не требуется,"Протирание, швабра",—,Уточнять на упаковке',
].join('\n');

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Кафе «Дезсредства»' });
  orgId = r.organization.id; siteId = r.site.id;
  haccp = await invite('haccp_lead'); cook = await invite('line_staff');
});

describe('Разбор значений из инструкции', () => {
  it('проценты и экспозиция — только однозначные записи', () => {
    expect(parsePercent('0,5%')).toEqual({ min: 0.5, max: 0.5 });
    expect(parsePercent('15-20%')).toEqual({ min: 15, max: 20 });
    expect(parsePercent('0,1% (1 г/л)')).toEqual({ min: 0.1, max: 0.1 });
    expect(parsePercent('Готовый раствор')).toBeNull();
    expect(parsePercent('Неразведённый (гель)')).toBeNull();
    expect(parseExposure('30 мин')).toEqual({ min: 30, max: 30 });
    expect(parseExposure('30-120 мин')).toEqual({ min: 30, max: 120 });
    expect(parseExposure('30 сек – 3 мин')).toEqual({ min: 0.5, max: 3 });
    expect(parseExposure('30-180 сек')).toEqual({ min: 0.5, max: 3 });
    expect(parseExposure('Не требуется')).toBeNull();
    expect(parseExposure('По необходимости')).toBeNull();
    expect(parseCsv('a;b\n"x;y";"он сказал ""да"""\n')).toEqual([['a', 'b'], ['x;y', 'он сказал "да"']]);
  });
});

describe('Импорт таблицы режимов', () => {
  it('предпросмотр без записи; импорт — черновики и протокол; повтор — дубли; утверждение — только с инструкцией и видом средства', async () => {
    await expect(importRegimes(cook.id, orgId, { csv: CSV, basis: 'Таблица режимов заказчика' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(importRegimes(haccp.id, orgId, { csv: CSV, basis: ' ' })).rejects.toThrow(/источник режимов/);
    const pv = await importRegimes(haccp.id, orgId, { csv: CSV, basis: 'Таблица режимов заказчика от 03.11.2026', filename: 'режимы.csv' });
    expect(pv).toMatchObject({ preview: true, summary: { rows: 5, new_regimes: 5, duplicates: 0, new_agents: ['ДЕЗ-А', 'ГЕЛЬ-Б', 'МОЮЩЕЕ-В'], errors: [] } });
    const row = (o: string) => (pv as { rows: { object: string; warnings: string[]; name: string; consumption: string | null }[] }).rows.find((r) => r.object === o)!;
    expect(row('Посуда с остатками пищи')).toMatchObject({ name: 'ДЕЗ-А', warnings: [] });                 // пустая ячейка — то же средство
    expect(row('Туберкулёз: посуда').warnings.join()).toMatch(/диапазон 15-20%/);
    expect(row('Поверхности, оборудование').warnings.join()).toMatch(/не в процентах.*замер.*невозможен/);
    expect(row('Полы, стены')).toMatchObject({ consumption: null });
    expect(row('Полы, стены').warnings.join()).toMatch(/экспозиция «Не требуется».*срок годности раствора не указан/);
    expect((await withSystem((tx) => tx.query(`select count(*)::int as n from disinfectant_regimes where organization_id = $1`, [orgId]))).rows[0].n).toBe(0);

    const done = await importRegimes(haccp.id, orgId, { csv: CSV, basis: 'Таблица режимов заказчика от 03.11.2026', filename: 'режимы.csv', confirm: true });
    expect(done).toMatchObject({ preview: false, summary: { new_regimes: 5 } });
    const job = (await withSystem((tx) => tx.query(`select kind, filename, rows_total, file_sha256, result from import_jobs where id = $1`, [(done as { import_job_id: string }).import_job_id]))).rows[0];
    expect(job).toMatchObject({ kind: 'disinfectant_regimes', filename: 'режимы.csv', rows_total: 5, result: { basis: 'Таблица режимов заказчика от 03.11.2026' } });
    expect(job.file_sha256).toMatch(/^[0-9a-f]{64}$/);
    const again = await importRegimes(haccp.id, orgId, { csv: CSV, basis: 'Таблица режимов заказчика', confirm: false });
    expect(again).toMatchObject({ summary: { new_regimes: 0, duplicates: 5, new_agents: [] } });
    await expect(importRegimes(haccp.id, orgId, { csv: CSV, basis: 'Таблица режимов заказчика', confirm: true })).rejects.toThrow(/уже есть/);

    const s = await listSanitation(haccp.id, orgId, siteId);
    const a = s.disinfectants.find((x: { name: string }) => x.name === 'ДЕЗ-А')!;
    expect(a).toMatchObject({ status: 'draft', agent_kind: null, has_instruction: false });
    const surf = a.regimes.find((r: { object: string }) => r.object === 'Поверхности, жёсткая мебель')!;
    expect(surf).toMatchObject({ status: 'draft', concentration_min: 0.5, concentration_max: 0.5, exposure_min: 30, method: 'Протирание', consumption: '150 мл/м²', solution_shelf: '28 суток',
      basis: expect.stringMatching(/Таблица режимов заказчика от 03\.11\.2026 \(импорт режимы\.csv, строка 2\)/) });
    await expect(approveRegime(haccp.id, orgId, surf.id)).rejects.toThrow(/Приложите к средству «ДЕЗ-А» инструкцию производителя/);
    await addEvidence(haccp.id, orgId, { entityType: 'disinfectant', entityId: a.id, filename: 'инструкция-дез-а.pdf' }, PDF);
    await expect(approveRegime(haccp.id, orgId, surf.id)).rejects.toThrow(/Укажите вид средства/);
    await updateAgent(haccp.id, orgId, a.id, { agentKind: 'disinfectant', manufacturer: 'ООО «Изготовитель»', activeSubstance: 'ЧАС' });
    await approveRegime(haccp.id, orgId, surf.id);

    // план по режиму: замер сравнивается с режимом объекта, а не со средством в целом
    await approveDisinfectant(haccp.id, orgId, a.id);
    const tub = a.regimes.find((r: { object: string }) => r.object === 'Туберкулёз: посуда')!;
    await expect(createPlan(haccp.id, orgId, { siteId, area: 'Мойка', work: 'Дезинфекция посуды', kind: 'disinfection', periodDays: 1, disinfectantId: a.id, regimeId: tub.id, checkConcentration: true }))
      .rejects.toThrow(/не утверждён/);
    const plan = await createPlan(haccp.id, orgId, { siteId, area: 'Горячий цех', work: 'Дезинфекция столов', kind: 'disinfection', periodDays: 1, disinfectantId: a.id, regimeId: surf.id, checkConcentration: true });
    const bad = await recordDone(cook.id, orgId, plan.id, { concentration: 2 });
    expect(bad).toMatchObject({ result: 'deviation' });
    expect(await recordDone(cook.id, orgId, plan.id, { concentration: 0.5 })).toMatchObject({ result: 'done' });
    await expect(archiveRegime(haccp.id, orgId, surf.id, { reason: 'новая редакция инструкции' })).rejects.toThrow(/действующем плане/);

    const g = s.disinfectants.find((x: { name: string }) => x.name === 'ГЕЛЬ-Б')!;
    await addEvidence(haccp.id, orgId, { entityType: 'disinfectant', entityId: g.id, filename: 'инструкция-гель.pdf' }, PDF);
    await updateAgent(haccp.id, orgId, g.id, { agentKind: 'combined' });
    await approveRegime(haccp.id, orgId, g.regimes[0].id); await approveDisinfectant(haccp.id, orgId, g.id);
    await expect(createPlan(haccp.id, orgId, { siteId, area: 'Цех', work: 'Обработка оборудования', kind: 'disinfection', periodDays: 1, disinfectantId: g.id, regimeId: g.regimes[0].id, checkConcentration: true }))
      .rejects.toThrow(/концентрация не в процентах/);
  });
});
