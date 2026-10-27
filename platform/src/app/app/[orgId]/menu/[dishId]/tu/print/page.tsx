'use client';
import { Suspense, use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useOrg } from '@/lib/org';
import { api } from '@/lib/api';
import { dt, n } from '@/lib/fmt';
import type { TuCalc } from '../page';

/**
 * Документ ТУ по структуре ГОСТ Р 51740-2016 (вводная часть, технические требования, безопасность, приёмка,
 * методы контроля, транспортирование и хранение, приложение — нормативные документы).
 * Без ?v — текущий расчёт (ПРОЕКТ / ГОТОВ К ИСПЫТАНИЯМ); с ?v=N — утверждённый снимок.
 */

interface Approved { version: number; designation: string; snapshot: TuCalc; lab_protocol: string; approved_at: string; approved_by_name: string }

function Doc({ dishId }: { dishId: string }) {
  const { org } = useOrg();
  const v = useSearchParams().get('v');
  const [calc, setCalc] = useState<TuCalc | null>(null);
  const [appr, setAppr] = useState<Approved | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (v) api<Approved>(`/orgs/${org.id}/dishes/${dishId}/tu/versions/${v}`).then((a) => { setAppr(a); setCalc(a.snapshot); }).catch((e) => setErr(e.message));
    else api<{ calc: TuCalc }>(`/orgs/${org.id}/dishes/${dishId}/tu`).then((d) => setCalc(d.calc)).catch((e) => setErr(e.message));
  }, [org.id, dishId, v]);
  if (err) return <div className="err">{err}</div>;
  if (!calc) return <p className="muted">Загрузка…</p>;
  const c = calc, o = c.object, p = c.nutrition.per100, year = new Date(appr?.approved_at || c.generated_at).getFullYear();
  const errors = c.errors || [];   // в снимках, утверждённых до появления проверки, поля нет
  const stamp = appr ? `УТВЕРЖДЕНО · версия ${appr.version}` : errors.length ? 'ОШИБКА В ДАННЫХ — НЕ ПРИМЕНЯТЬ' : c.status === 'ready' ? 'ГОТОВ К ИСПЫТАНИЯМ' : 'ПРОЕКТ';
  const allergens = c.allergens.contains.length ? c.allergens.contains.map((a) => `${a.label} (${a.sources.join(', ')})`).join('; ') : c.allergens.complete ? 'не содержит' : errors.length ? 'не определены — часть сырья не вошла в расчёт (см. ошибки)' : 'профиль аллергенов неполный';
  return (
    <>
      <div className="noprint">
        <p className="small"><Link href={`/app/${org.id}/menu/${dishId}/tu`}>← Технические условия</Link></p>
        <button className="btn block" onClick={() => window.print()}>Печать / сохранить PDF</button>
        {!appr && <p className="small muted">Документ сформирован по текущему расчёту. Для проверки и согласования; действует только утверждённая версия.</p>}
      </div>
      <article className="tu-doc">
        {errors.length > 0 && <div className="tu-warn"><b>Ошибки в данных — документ выпускать нельзя, пока они не исправлены в ТТК:</b><ul>{errors.map((w) => <li key={w}>{w}</li>)}</ul></div>}
        <div className="tu-right">УТВЕРЖДАЮ<br />Руководитель {org.name}<br />____________ / ____________<br />«___» __________ {year} г.</div>
        <h1>{o.name}</h1>
        <div className="tu-center">ТЕХНИЧЕСКИЕ УСЛОВИЯ<br /><b>{appr?.designation || c.designation}</b><br />Дата введения: «___» __________ 20__ г. · <span className="tu-stamp">{stamp}</span></div>

        <h2>Вводная часть</h2>
        <p>Настоящие технические условия распространяются на {o.kind === 'semi' ? 'полуфабрикат' : 'продукцию общественного питания'} «{o.name}» (далее — продукция), изготавливаемую {org.name} и предназначенную для реализации {c.channel}. Продукция изготавливается по технологической документации предприятия (ТТК, версия {o.ttk_version}), разработанной в соответствии с ГОСТ 31987-2012.</p>
        <p>Пример записи при заказе: «{o.name} {appr?.designation || c.designation}».</p>

        <h2>1 Технические требования</h2>
        <p>1.1 Продукция должна соответствовать требованиям ТР ТС 021/2011, ТР ТС 022/2011, {c.normative.filter((d) => d.code.startsWith('СанПиН')).map((d) => d.code).join(', ') || 'действующих санитарных правил для организаций общественного питания'}, ГОСТ 30390-2013 и настоящих ТУ и изготавливаться по рецептуре и технологической инструкции.</p>
        <p>1.2 Рецептура (выход {n(o.yield_g)} г; закладка нетто {n(o.input_mass_g)} г{o.production_loss_pct >= 0 ? `; потери при производстве ${n(o.production_loss_pct)} % по ГОСТ 31988-2012` : ''}).</p>
        <table><thead><tr><th>№</th><th>Сырьё</th><th>Вид</th><th>Нетто на выход, г</th><th>На 1 кг, г</th><th>На 100 кг, кг</th></tr></thead>
          <tbody>{c.recipe.map((r, i) => <tr key={i}><td>{i + 1}</td><td>{r.name}</td><td>{r.kind}</td><td>{n(r.netto_g)}</td><td>{n(r.per_1kg_g)}</td><td>{n(r.per_100kg_kg)}</td></tr>)}</tbody></table>
        <p>1.3 Органолептические показатели: {c.organoleptic}</p>
        <p>1.4 Физико-химические показатели (допуск {Math.round(c.tolerance * 100)} % от расчётного значения).</p>
        <table><thead><tr><th>Показатель</th><th>Норма</th><th>Расчётное</th><th>Метод</th></tr></thead>
          <tbody>{c.physico.map((x) => <tr key={x.indicator}><td>{x.indicator}</td><td>{typeof x.norm === 'number' ? n(x.norm) : x.norm}</td><td>{n(x.calc)}</td><td>{x.method}</td></tr>)}</tbody></table>
        <p>1.5 Микробиологические показатели — {c.micro.mode === 'none' ? <span className="tu-warn">группа продукции по ТР ТС 021/2011 не подтверждена{c.micro.suggested ? ` (предложена «${c.micro.suggested.name}»)` : ''}</span>
          : c.micro.index || `группа «${c.micro.group}», ТР ТС 021/2011, приложения 1–2`}.</p>
        <table><thead><tr><th>Показатель</th><th>Норматив</th><th>Метод</th></tr></thead>
          <tbody>{c.micro.indicators.map((m) => <tr key={m.code}><td>{m.name}</td><td>{m.norm || (c.micro.mode === 'law' ? 'не нормируется' : '— не установлено')}</td><td>{m.method}</td></tr>)}</tbody></table>
        {c.micro.note && <p className="tu-small">{c.micro.note}</p>}
        <p>1.6 Пищевая и энергетическая ценность (расчётно; коэффициенты ТР ТС 022/2011, прил. 4; обработка: {c.processing.mode === 'thermal' ? 'тепловая, потери Б/Ж/У 6/12/9 %' : 'без тепловой обработки'}; данными покрыто {c.nutrition.coverage_pct} %, подтверждено документами {c.nutrition.verified_pct} %).</p>
        <table><thead><tr><th /><th>Белки, г</th><th>Жиры, г</th><th>Углеводы, г</th><th>Энерг. ценность, ккал / кДж</th></tr></thead>
          <tbody>{p ? <tr><td>На 100 г</td><td>{n(p.protein)}</td><td>{n(p.fat)}</td><td>{n(p.carbs)}</td><td>{p.kcal} / {p.kj}</td></tr> : <tr><td colSpan={5}>не рассчитано — нет данных пищевой ценности сырья</td></tr>}
            {c.nutrition.per_portion && <tr><td>На порцию {o.portion_g} г</td><td>{n(c.nutrition.per_portion.protein)}</td><td>{n(c.nutrition.per_portion.fat)}</td><td>{n(c.nutrition.per_portion.carbs)}</td><td>{c.nutrition.per_portion.kcal} / {c.nutrition.per_portion.kj}</td></tr>}</tbody></table>
        <p>1.7 Аллергены (ТР ТС 022/2011): {allergens}.</p>
        <p>1.8 Требования к сырью: сырьё и пищевые продукты должны сопровождаться документами, подтверждающими безопасность и прослеживаемость, и соответствовать ТР ТС 021/2011 и ТР ТС 029/2012.</p>
        <p>1.9 Упаковка — материалы, соответствующие ТР ТС 005/2011. Маркировка — по ТР ТС 022/2011: наименование, состав, количество, дата изготовления, срок годности, условия хранения, пищевая ценность, аллергены, изготовитель, обозначение настоящих ТУ.</p>

        <h2>2 Требования безопасности</h2>
        <p>Содержание потенциально опасных веществ и микробиологические показатели — не выше норм ТР ТС 021/2011 для сырья и группы продукции. Производство ведётся в рамках программы производственного контроля на принципах ХАССП.</p>
        <h2>3 Правила приёмки</h2>
        <p>Продукцию принимают партиями. Партия — продукция одного наименования, изготовленная за одну смену. Каждая партия проходит органолептическую оценку (бракераж) по ГОСТ 31986-2012 с записью в журнале. Периодичность контроля физико-химических и микробиологических показателей — по программе производственного контроля.</p>
        <h2>4 Методы контроля</h2>
        <p>Органолептические показатели — по ГОСТ 31986-2012; микробиологические — методами, указанными в 1.5; физико-химические — по методикам аккредитованной лаборатории. Отбор проб — по нормативным документам на методы испытаний.</p>
        <h2>5 Транспортирование и хранение</h2>
        <p>Условия хранения: {c.storage.conditions || '— указать'}. Срок годности: {c.storage.shelf_life || '— указать'} (источник: утверждённая ТТК). Транспортирование — с соблюдением температурного режима по {c.normative.find((d) => d.code.startsWith('СанПиН'))?.code || 'действующим санитарным правилам'}. Срок годности сверх установленного санитарными правилами обосновывается по МУК 4.2.1847-04.</p>
        {c.warnings.length > 0 && <div className="tu-warn"><b>Замечания расчёта (устранить до утверждения ТУ):</b><ul>{c.warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>}

        <h2>Приложение А (справочное). Нормативные документы</h2>
        <table><thead><tr><th>Обозначение</th><th>Наименование</th><th>Нормативная база системы</th></tr></thead>
          <tbody>{c.normative.map((d) => <tr key={d.code}><td>{d.code}</td><td>{d.title}</td><td>{d.state}</td></tr>)}</tbody></table>
        <p className="tu-small">{appr ? `Утверждено: ${appr.approved_by_name}, ${dt(appr.approved_at, org.timezone)}. Протокол испытаний: ${appr.lab_protocol}.` : 'Сформировано системой «ЦЕХ» по рецептуре и данным сырья.'} Расчётные показатели подтверждаются протоколом испытаний аккредитованной лаборатории.</p>
      </article>
    </>
  );
}

export default function Page({ params }: { params: Promise<{ dishId: string }> }) {
  const { dishId } = use(params);
  return <Suspense><Doc dishId={dishId} /></Suspense>;
}
