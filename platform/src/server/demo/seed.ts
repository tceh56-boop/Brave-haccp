import { execFileSync } from 'node:child_process';
import { withSystem, closePool } from '../db/pool';
import { register, verifyEmail, login, type SessionUser } from '../identity/auth';
import { createOrganization, inviteMember, acceptInvitation } from '../org/organizations';
import { createSupplier, createProduct } from '../ops/catalog';
import { importReference, createProductFromReference } from '../ops/reference';
import { createControlObject, createRule, approveRule } from '../ops/control';
import { recordMeasurement } from '../ops/measurements';
import { takeIncident, recordIncidentAction, confirmIncident, reportProblem } from '../ops/incidents';
import { createReceipt, addReceiptLine, completeReceipt } from '../ops/receipts';
import { seedStartList, createSource, addRequirement, markChecked, approveVersion, decideApplicability } from '../ops/regulatory';
import { addEntry, getJournal, signJournal } from '../ops/journals';
import { createPlan, addStep, confirmStep, addHazard, answerTree, classifyHazard, setMonitoring, approvePlan } from '../ops/haccp';
import { updateCapa } from '../ops/capa';
import { addEvidence } from '../ops/evidence';
import { importTtkArchive, listArchive, importFromArchive, createDish, getDish, updateVersion, addLine, submitVersion, approveVersion as approveTtk } from '../ops/recipes';
import { openShift, createOrder, addOrderLine, payOrder, setStop } from '../ops/pos';
import { confirm } from '../ops/readiness';
import { listLots } from '../ops/lots';
import { createLabels, logPrint, openLot, setOpenedShelfLife } from '../ops/labels';
import { createProduction, startProduction, recordCheck, completeProduction, addReleaseCheck } from '../ops/production';

/**
 * Демо-организация для показа и инструктажа (этап 8): «Кафе «Демо»» с сотрудниками всех ролей и данными за смену.
 * Всё создаётся настоящими операциями системы — журналы, аудит, связи и запреты работают как в жизни.
 * Нормативы и сроки в демо — условные и помечены «Демо»; реальное предприятие вносит свои по утверждённым документам.
 * Запуск: npm run demo:seed (повторный запуск ничего не меняет; DEMO_SUFFIX=2 — ещё одна демо-организация).
 */

export const DEMO_PASSWORD = 'Демо-ЦЕХ-2026';
const SUFFIX = process.env.DEMO_SUFFIX ? `-${process.env.DEMO_SUFFIX}` : '';
const PEOPLE = [
  ['owner', 'vladelec', 'Ольга Владелец'], ['chef', 'shef', 'Анна Шеф'], ['haccp_lead', 'haccp', 'Игорь ХАССП'], ['technologist', 'tehnolog', 'Мария Технолог'],
  ['storekeeper', 'sklad', 'Пётр Кладовщик'], ['line_staff', 'povar', 'Сергей Повар'], ['cashier', 'kassa', 'Ксения Кассир'], ['accountant', 'buh', 'Елена Бухгалтер'],
] as const;
export const demoEmail = (login: string) => `${login}${SUFFIX}@demo.test`;
const inDays = (n: number) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
let op = 0;
const opId = () => `demo-${Date.now().toString(36)}-${op++}`;

async function person(email: string, fullName: string): Promise<SessionUser> {
  await register({ email, password: DEMO_PASSWORD, fullName });
  const tok = (await withSystem((tx) => tx.query(`select body from outbox_emails where to_email = $1 and template = 'verify_email' order by created_at desc limit 1`, [email]))).rows[0].body;
  await verifyEmail(/token=([A-Za-z0-9_-]+)/.exec(tok)![1]);
  return (await login({ email, password: DEMO_PASSWORD }, { ip: '127.0.0.1' })).session.user;
}
async function inviteToken(email: string) {
  const b = (await withSystem((tx) => tx.query(`select body from outbox_emails where to_email = $1 and template = 'invitation' order by created_at desc limit 1`, [email]))).rows[0].body;
  return /token=([A-Za-z0-9_-]+)/.exec(b)![1];
}
async function refId(code: string) {
  return (await withSystem((tx) => tx.query(`select id from reference_products where code = $1`, [code]))).rows[0]?.id as string | undefined;
}
function photo(text: string): Buffer | null {
  try { return execFileSync('convert', ['-size', '480x320', 'xc:#e9e4dc', '-fill', '#3B2A20', '-pointsize', '30', '-gravity', 'center', '-annotate', '+0+0', text, 'jpg:-']); } catch { return null; }
}

export async function seedDemo() {
  const ownerEmail = demoEmail('vladelec');
  const exists = (await withSystem((tx) => tx.query(`select u.id, m.organization_id from users u left join memberships m on m.user_id = u.id where u.email = $1`, [ownerEmail]))).rows[0];
  if (exists) return { created: false, orgId: exists.organization_id as string };

  if (!(await withSystem((tx) => tx.query(`select 1 from reference_products limit 1`))).rowCount) await importReference();
  if (!(await withSystem((tx) => tx.query(`select 1 from ttk_archive limit 1`))).rowCount) await importTtkArchive();

  // Люди и предприятие
  const owner = await person(ownerEmail, 'Ольга Владелец');
  const { organization, site } = await createOrganization(owner, { name: `Кафе «Демо»${SUFFIX ? ` ${SUFFIX.slice(1)}` : ''}`, legalForm: 'ООО', region: 'Москва', timezone: 'Europe/Moscow' });
  const orgId = organization.id, siteId = site.id;
  const u: Record<string, SessionUser> = { owner };
  for (const [role, loginName, name] of PEOPLE.slice(1)) {
    const email = demoEmail(loginName);
    const p = await person(email, name);
    await inviteMember(owner.id, orgId, { email, role, fullName: name });
    await acceptInvitation(p, await inviteToken(email));
    u[role] = p;
  }
  const { chef, haccp_lead: haccp, technologist: tech, storekeeper: store, line_staff: cook, cashier, accountant } = u;
  void accountant;

  // Нормативный реестр: стартовый перечень (требует проверки) + своя утверждённая процедура
  await seedStartList(haccp.id, orgId);
  const { version } = await createSource(haccp.id, orgId, { code: 'ПК-03 (Демо)', kind: 'Внутренний', title: 'Демо: процедура контроля холодильного хранения', binding: 'mandatory', edition: 'ред. 1', effectiveFrom: inDays(-30) });
  const reqMeat = await addRequirement(haccp.id, orgId, version.id, { clause: 'п. 2', text: 'Охлаждённое мясо хранят при температуре от 0 до +4 °C; при отклонении продукцию изолируют до решения ответственного.', scope: 'холодильное хранение мяса', processes: ['storage'] });
  const reqDairy = await addRequirement(haccp.id, orgId, version.id, { clause: 'п. 3', text: 'Молочную продукцию хранят при температуре от +2 до +6 °C; температуру контролируют не реже раза в 4 часа.', scope: 'холодильное хранение молочной продукции', processes: ['storage'] });
  await markChecked(tech.id, orgId, version.id, { evidence: 'Демо: сверено с приказом директора № 12 (оригинал в папке ХАССП)', nextCheckAt: inDays(180) });
  await approveVersion(owner.id, orgId, version.id);
  for (const r of [reqMeat, reqDairy]) await decideApplicability(haccp.id, orgId, r.id, { applicable: true, rationale: 'кафе хранит охлаждённое мясо и молочную продукцию' });

  // Объекты контроля и утверждённые правила
  const objects: Record<string, string> = {};
  for (const [name, kind, min, max, req] of [['Камера мяса', 'fridge', 0, 4, reqMeat.id], ['Холодильник молочный', 'fridge', 2, 6, reqDairy.id], ['Морозильник', 'freezer', -25, -18, null]] as const) {
    objects[name] = (await createControlObject(owner.id, orgId, { siteId, name, kind })).id;
    const rule = await createRule(haccp.id, orgId, { controlObjectId: objects[name], minValue: min, maxValue: max, frequencyHours: 4,
      ...(req ? { requirementId: req } : { sourceRef: 'Демо: процедура ПК-04, п. 1' }),
      reaction: 'Повторить замер через 15 минут; проверить дверь и уплотнитель; при повторном отклонении изолировать продукцию и сообщить ответственному.', allowIsolation: true });
    await approveRule(haccp.id, orgId, rule.id);
  }

  // Товары (из справочника MON CHEF, где есть) и поставщик
  const prod = async (name: string, unit: 'кг' | 'л' | 'шт', code?: string) => {
    const ref = code ? await refId(code) : undefined;
    return (ref ? await createProductFromReference(store.id, orgId, { referenceId: ref, name, unit }) : await createProduct(store.id, orgId, { name, unit })).id as string;
  };
  const p = { beef: await prod('Говядина вырезка', 'кг', 'PROD-0093'), onion: await prod('Лук репчатый', 'кг'), cream: await prod('Сливки 33%', 'л'), milk: await prod('Молоко 3,2%', 'л'),
    cranberry: await prod('Клюква замороженная', 'кг'), potato: await prod('Картофель', 'кг') };
  const supplier = (await createSupplier(store.id, orgId, { name: 'ООО «Демо-Поставщик»' })).id;
  const ok = { packaging: true, labeling: true, documents: true, quality: true };
  const rec = await createReceipt(store.id, orgId, { siteId, supplierId: supplier, documentNo: 'УПД-101' });
  const line = (productId: string, quantity: number, unitPrice: number, lotNo: string, expiresAt: string | null, storage: string | null, extra: Record<string, unknown> = {}) =>
    addReceiptLine(store.id, orgId, rec.id, { productId, quantity, unitPrice, lotNo, expiresAt, expiryBasis: expiresAt ? 'маркировка изготовителя' : null, checks: ok, decision: 'accepted', storageObjectId: storage, temperature: 3, ...extra });
  await line(p.beef, 8, 890, 'Г-0421', inDays(5), objects['Камера мяса']);
  await line(p.onion, 10, 38, 'Л-17', inDays(20), null);
  await line(p.cream, 6, 410, 'С-552', inDays(1), objects['Холодильник молочный']);       // скоро истекает
  await line(p.milk, 12, 95, 'М-310', null, objects['Холодильник молочный']);             // срок не подтверждён
  await line(p.cranberry, 3, 520, 'К-08', inDays(120), objects['Морозильник']);
  await line(p.potato, 20, 32, 'К-221', inDays(14), null, { checks: { ...ok, quality: false }, decision: 'quarantine', decisionReason: 'часть клубней с гнилью — на проверку' });
  await completeReceipt(store.id, orgId, rec.id);

  // Маркировка: этикетки партий приёмки, правило «после вскрытия» для сливок, вскрытая тара с новой этикеткой
  const lots = await listLots(store.id, orgId, siteId);
  const labels = await createLabels(store.id, orgId, { lotIds: lots.map((l) => l.id) });
  await logPrint(store.id, orgId, { labelIds: labels.map((l) => l.id), format: '58x40', copies: 1 });
  await setOpenedShelfLife(store.id, orgId, p.cream, { hours: 72, basis: 'маркировка изготовителя: после вскрытия 72 ч при +2…+6 °C' });
  const opened = await openLot(cook.id, orgId, lots.find((l) => l.lot_no === 'С-552')!.id, { quantity: 1, operationId: `demo-open-${SUFFIX || 'main'}` });
  await logPrint(cook.id, orgId, { labelIds: [opened.label_id], format: '58x40', copies: 1 });

  // Смена: замеры, отклонение → действие → подтверждение → CAPA; сообщение сотрудника
  await recordMeasurement(cook.id, orgId, { controlObjectId: objects['Холодильник молочный'], value: 4.1 });
  await recordMeasurement(cook.id, orgId, { controlObjectId: objects['Морозильник'], value: -20 });
  const dev = await recordMeasurement(cook.id, orgId, { controlObjectId: objects['Камера мяса'], value: 6.8 });
  const img = photo('Термометр камеры: 6,8 °C');
  if (img) await addEvidence(cook.id, orgId, { entityType: 'incident', entityId: dev.incidentId, filename: 'термометр.jpg', note: 'показания при замере' }, img);
  await takeIncident(haccp.id, orgId, dev.incidentId!);
  await recordIncidentAction(haccp.id, orgId, dev.incidentId!, { note: 'Дверь камеры была неплотно закрыта, уплотнитель заменён. Повторный замер 3,9 °C.', isolateLots: false });
  await recordMeasurement(cook.id, orgId, { controlObjectId: objects['Камера мяса'], value: 3.9 });
  const closed = await confirmIncident(chef.id, orgId, dev.incidentId!, { note: 'проверено на месте' });
  if (closed.capaId) {
    await updateCapa(haccp.id, orgId, closed.capaId, { rootCause: 'Износ уплотнителя двери камеры; замена не была в графике ТО', correctiveAction: 'Уплотнитель заменён',
      preventiveAction: 'Осмотр уплотнителей раз в месяц включён в график ТО', effectivenessCriterion: 'Нет отклонений температуры камеры 14 дней', responsibleUserId: haccp.id, dueAt: inDays(3), checkDueAt: inDays(14) });
  }
  await reportProblem(cook.id, orgId, { siteId, what: 'Течёт кран в моечной, вода на полу' });

  // Журналы: ручная запись бракеража и подпись J01 за сегодня
  await addEntry(cook.id, orgId, 'J02', { siteId, values: { 0: today().split('-').reverse().join('.'), 1: '12:30', 2: 'Бефстроганов', 3: 'отлично', 4: 'разрешено к раздаче' } });
  const j01 = await getJournal(chef.id, orgId, 'J01', { siteId, from: today(), to: today() });
  await signJournal(chef.id, orgId, 'J01', { siteId, from: today(), to: today(), contentHash: j01.content_hash, note: 'проверено' });

  // План ХАССП (утверждён)
  const plan = await createPlan(tech.id, orgId, { scope: 'Демо: горячий цех и холодильное хранение сырья', team: 'Мария Технолог, Игорь ХАССП, Анна Шеф' });
  const st: Record<string, string> = {};
  for (const name of ['Приёмка сырья', 'Хранение в холоде', 'Тепловая обработка']) st[name] = (await addStep(tech.id, orgId, plan.id, { name })).id;
  for (const id of Object.values(st)) await confirmStep(tech.id, orgId, id, { note: 'Проверено на месте с шеф-поваром, схема совпадает' });
  const h1 = (await addHazard(tech.id, orgId, plan.id, { stepId: st['Тепловая обработка'], hazardType: 'biological', description: 'Выживание патогенов при недостаточной термообработке мяса',
    likelihood: 3, severity: 3, controlMeasures: 'Термообработка до температуры в толще по ТТК, контроль щупом' })).id;
  await answerTree(tech.id, orgId, h1, { q1: true, q2: true });
  await classifyHazard(tech.id, orgId, h1, { class: 'ccp', rationale: 'Этап устраняет опасность; последующих этапов, снижающих её, нет.' });
  await setMonitoring(tech.id, orgId, h1, { what: 'Температура в толще продукта', method: 'Щуп-термометр', frequency: 'каждая партия', criticalLimit: 'по утверждённой ТТК (вносит технолог)',
    responsibleRole: 'chef', recordForm: 'J22', correctiveAction: 'Продолжить обработку до предела; без достижения — не выпускать.' });
  const h2 = (await addHazard(tech.id, orgId, plan.id, { stepId: st['Хранение в холоде'], hazardType: 'biological', description: 'Рост микроорганизмов при нарушении температуры хранения мяса',
    likelihood: 2, severity: 3, controlMeasures: 'Хранение по правилу камеры, контроль температуры' })).id;
  await answerTree(tech.id, orgId, h2, { q1: true, q2: false, q3: true, q4: true });
  await classifyHazard(tech.id, orgId, h2, { class: 'oprp', rationale: 'Значимая опасность, управляется программой контроля температуры камеры; критического предела этапа нет.' });
  const rule = (await withSystem((tx) => tx.query(`select id from control_rules where control_object_id = $1 and status = 'approved'`, [objects['Камера мяса']]))).rows[0].id;
  await setMonitoring(tech.id, orgId, h2, { what: 'Температура камеры', method: 'Термометр камеры', frequency: 'каждые 4 часа', responsibleRole: 'line_staff', recordForm: 'J01', controlRuleId: rule,
    correctiveAction: 'По процедуре ПК-03 (Демо)' });
  await approvePlan(owner.id, orgId, plan.id, { note: 'Демо: утверждено' });

  // Блюда и ТТК: две утверждённые, одна без ТТК (её продажи попадут в очередь), карты из архива — черновиками
  const dish = async (name: string, price: number, yieldG: number, technology: string, lines: { productId: string; unit: string; brutto: number; netto: number }[]) => {
    const d = await createDish(chef.id, orgId, { name, salePrice: price, category: 'Горячее' });
    const v = (await getDish(chef.id, orgId, d.id)).current!.version.id;
    await updateVersion(chef.id, orgId, v, { yieldG, portionG: yieldG, technology, storageConditions: 'при +2…+6 °C', shelfLife: 'Демо: 2 часа на раздаче' });
    for (const l of lines) await addLine(chef.id, orgId, v, l);
    await submitVersion(chef.id, orgId, v);
    await approveTtk(owner.id, orgId, v);
    return d.id as string;
  };
  const stroganoff = await dish('Бефстроганов', 450, 150, 'Говядину нарезать брусочками, обжарить, добавить лук, тушить в сливочном соусе 10 минут.',
    [{ productId: p.beef, unit: 'кг', brutto: 0.15, netto: 0.12 }, { productId: p.onion, unit: 'г', brutto: 30, netto: 25 }, { productId: p.cream, unit: 'л', brutto: 0.03, netto: 0.03 }]);
  const mors = await dish('Морс клюквенный', 150, 300, 'Клюкву протереть, залить горячей водой, настоять, процедить, охладить.', [{ productId: p.cranberry, unit: 'г', brutto: 50, netto: 50 }]);
  const compote = (await createDish(chef.id, orgId, { name: 'Компот из сухофруктов', salePrice: 120, category: 'Напитки' })).id;
  const holodets = (await listArchive(chef.id, orgId, { q: 'холодец' })).cards.map((c: { id: string }) => c.id);
  if (holodets.length) await importFromArchive(tech.id, orgId, { archiveIds: holodets });

  // Производство п/ф: «Соус сливочный» с ККТ «температура в толще» и сроком партии 24 ч — выпущенная партия и задание в плане
  const sauce = (await createDish(chef.id, orgId, { name: 'Соус сливочный', kind: 'semi', category: 'Полуфабрикаты' })).id;
  const sv = (await getDish(chef.id, orgId, sauce)).current!.version.id;
  await updateVersion(chef.id, orgId, sv, { yieldG: 1000, technology: 'Лук пассеровать, добавить сливки, довести до кипения, уварить на треть.', storageConditions: 'при +2…+6 °C', shelfLife: '24 часа', shelfLifeHours: 24 });
  await addLine(chef.id, orgId, sv, { productId: p.cream, unit: 'л', brutto: 1.2, netto: 1.2 });
  await addLine(chef.id, orgId, sv, { productId: p.onion, unit: 'г', brutto: 120, netto: 100 });
  await submitVersion(chef.id, orgId, sv);
  await approveTtk(owner.id, orgId, sv);
  const tcheck = await addReleaseCheck(haccp.id, orgId, sauce, { name: 'Температура в толще продукта', unit: '°C', min: 75, basis: 'Демо: план ХАССП, ККТ-1 — тепловая обработка' });
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
  const po = await createProduction(chef.id, orgId, { siteId, dishId: sauce, plannedKg: 1, plannedFor: day, note: 'к обеду' });
  await startProduction(cook.id, orgId, po.id);
  await recordCheck(cook.id, orgId, po.id, { checkId: tcheck.id, value: 82 });
  await completeProduction(cook.id, orgId, po.id, { actualKg: 0.95, operationId: `demo-prod-${SUFFIX || 'main'}` });
  await createProduction(chef.id, orgId, { siteId, dishId: sauce, plannedKg: 2, plannedFor: day, note: 'на вечер' });

  // Касса: смена, два оплаченных заказа, один открытый; ручной стоп
  await openShift(cashier.id, orgId, { siteId, cashStart: 3000 });
  const o1 = await createOrder(cashier.id, orgId, { siteId, tableLabel: '3' });
  await addOrderLine(cashier.id, orgId, o1.order.id, { dishId: stroganoff, qty: 2 });
  await addOrderLine(cashier.id, orgId, o1.order.id, { dishId: mors, qty: 2 });
  await payOrder(cashier.id, orgId, o1.order.id, { payments: [{ method: 'card', amount: 1200 }], operationId: opId() });
  const o2 = await createOrder(cashier.id, orgId, { siteId, tableLabel: '5' });
  await addOrderLine(cashier.id, orgId, o2.order.id, { dishId: stroganoff });
  await addOrderLine(cashier.id, orgId, o2.order.id, { dishId: compote });
  await payOrder(cashier.id, orgId, o2.order.id, { payments: [{ method: 'cash', amount: 600 }], operationId: opId() });
  const o3 = await createOrder(cashier.id, orgId, { siteId, tableLabel: '7' });
  await addOrderLine(cashier.id, orgId, o3.order.id, { dishId: mors });
  await setStop(chef.id, orgId, { siteId, dishId: compote, reason: 'закончились сухофрукты' });

  // Подтверждения пилота: часть есть, часть ждёт — видно на экране готовности
  await confirm(owner.id, orgId, { key: 'paper_fallback', evidence: 'Демо: бланки журналов в папке на кухне, перенос — Игорь ХАССП' });
  await confirm(owner.id, orgId, { key: 'kkt', evidence: 'Демо: чеки пробиваются на ККТ предприятия, возврат — по процедуре кассы' });

  return { created: true, orgId };
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  // Учётные записи с известным паролем — только на стенде: на сервере пилота (HTTPS, production) не запускаем.
  if ((process.env.NODE_ENV === 'production' || process.env.APP_URL?.startsWith('https://')) && process.env.DEMO_FORCE !== '1') {
    console.error('Демо-организация не создаётся на рабочем сервере (NODE_ENV=production или APP_URL https). Для стенда: DEMO_FORCE=1.');
    process.exit(1);
  }
  seedDemo().then((r) => {
    console.log(r.created ? 'Демо-организация создана.' : 'Демо-организация уже есть — ничего не менял.');
    console.log(`Пароль для всех: ${DEMO_PASSWORD}`);
    for (const [, l, n] of PEOPLE) console.log(`  ${n.padEnd(16)} ${demoEmail(l)}`);
  }).catch((e) => { console.error(e); process.exitCode = 1; }).finally(closePool);
}
