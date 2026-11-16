'use client';
import { Fragment, Suspense, use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useOrg } from '@/lib/org';
import { api } from '@/lib/api';
import { dt, n } from '@/lib/fmt';
import type { GtuCalc, GtuData } from '@/lib/groupTu';

/**
 * Групповые ТУ по ГОСТ Р 51740-2016: титульный лист (прил. А; код ОКПД2 категории — 4.2.8; наименование во множественном
 * числе — 4.3.6), ассортимент и пример записи продукции (5.1.3, прил. Б), требования по каждому наименованию таблицами,
 * общие разделы, перечень ссылочных документов, лист регистрации изменений (ГОСТ Р 1.3-2018, прил. Б).
 * Без ?v — текущий расчёт (ПРОЕКТ); с ?v=N — утверждённый снимок.
 */

interface Approved { version: number; designation: string; snapshot: GtuCalc; lab_protocol: string; approved_at: string; approved_by_name: string }
const OL: [string, string][] = [['appearance', 'Внешний вид'], ['color', 'Цвет'], ['consistency', 'Консистенция'], ['taste', 'Вкус и запах']];

function Doc({ id }: { id: string }) {
  const { org } = useOrg();
  const v = useSearchParams().get('v');
  const [c, setC] = useState<GtuCalc | null>(null);
  const [appr, setAppr] = useState<Approved | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (v) api<Approved>(`/orgs/${org.id}/group-tu/${id}/versions/${v}`).then((a) => { setAppr(a); setC(a.snapshot); }).catch((e) => setErr(e.message));
    else api<GtuData>(`/orgs/${org.id}/group-tu/${id}`).then((d) => setC(d.calc)).catch((e) => setErr(e.message));
  }, [org.id, id, v]);
  if (err) return <div className="err">{err}</div>;
  if (!c) return <p className="muted">Загрузка…</p>;
  const t = c.title, year = new Date(appr?.approved_at || c.generated_at).getFullYear();
  const stamp = appr ? `УТВЕРЖДЕНО · версия ${appr.version}` : c.errors.length ? 'ОШИБКА В ДАННЫХ — НЕ ПРИМЕНЯТЬ' : c.status === 'ready' ? 'ГОТОВ К УТВЕРЖДЕНИЮ' : 'ПРОЕКТ';
  const dmy = (d: string | null | undefined) => (d ? d.slice(0, 10).split('-').reverse().join('.') : '__.__.____');
  const designation = appr?.designation || c.designation;
  const sanpin = c.normative.filter((d) => d.code.startsWith('СанПиН')).map((d) => d.code).join(', ');
  const reg = c.meat_regulation === 'trts034' ? 'ТР ТС 034/2013 «О безопасности мяса и мясной продукции»' : c.meat_regulation === 'trts051' ? 'ТР ЕАЭС 051/2021 «О безопасности мяса птицы и продукции его переработки»' : null;
  const lc = c.name.charAt(0).toLowerCase() + c.name.slice(1);
  let tn = 0; const T = () => ++tn;
  const cap = () => <caption className="tu-small" style={{ textAlign: 'left' }}>Таблица {tn}</caption>;
  return (
    <>
      <div className="noprint">
        <p className="small"><Link href={`/app/${org.id}/menu/group-tu/${id}`}>← Групповые ТУ</Link></p>
        <button className="btn block" onClick={() => window.print()}>Печать / сохранить PDF</button>
      </div>
      <article className="tu-doc">
        {c.errors.length > 0 && !appr && <div className="tu-warn"><b>Ошибки в данных — документ выпускать нельзя:</b><ul>{c.errors.map((w) => <li key={w}>{w}</li>)}</ul></div>}
        <p className="tu-center" style={{ textTransform: 'uppercase', fontWeight: 700 }}>{t.holder}</p>
        <div className="between" style={{ alignItems: 'flex-start', marginTop: 12 }}>
          <div className="tu-small" style={{ color: '#111' }}>ОКПД2 {t.okpd2 || '__.__.__'}<br />{t.oks ? `ОКС ${t.oks}` : 'ОКС ___________'}</div>
          <div className="tu-right">УТВЕРЖДАЮ<br />Руководитель {t.holder}<br />____________ / ____________<br />{appr ? dt(appr.approved_at, org.timezone, { day: '2-digit', month: '2-digit', year: 'numeric' }) : `«___» __________ ${year} г.`}</div>
        </div>
        <h1 style={{ fontSize: '17pt', marginTop: 50, textTransform: 'uppercase' }}>{c.name}</h1>
        <p className="tu-center" style={{ fontWeight: 700, margin: '6px 0' }}>Технические условия</p>
        <p className="tu-center" style={{ fontWeight: 700, margin: '6px 0' }}>{designation}</p>
        <p className="tu-center" style={{ margin: '6px 0' }}>({t.replaces ? `взамен ${t.replaces}` : 'утверждены впервые'})</p>
        <p className="tu-center">Дата введения в действие — {dmy(t.intro_date)} <span className="tu-stamp">{stamp}</span></p>
        {t.developer && <p className="tu-center" style={{ marginTop: 30 }}>РАЗРАБОТАНО<br />{t.developer}</p>}
        <p className="tu-center" style={{ marginTop: 60 }}>{t.location || '— местонахождение держателя подлинника —'}<br />{year}</p>

        <h2 style={{ pageBreakBefore: 'always' }}>1 Область применения</h2>
        <p>Настоящие технические условия распространяются на {lc} (далее — продукция), изготавливаемые {t.holder}, предназначенные {t.purpose} и реализуемые {c.channel}.</p>
        <p>Продукция изготавливается по рецептурам и технологической инструкции изготовителя и выпускается в следующем ассортименте:</p>
        <ul>{c.items.map((i, k, a) => <li key={i.dish_id}>{i.name}{i.okpd2 ? ` (ОКПД2 ${i.okpd2})` : ''}{k < a.length - 1 ? ';' : '.'}</li>)}</ul>
        <p>Пример записи продукции при ее заказе и (или) в других документах: «{c.items[0]?.name || '…'} {designation}».</p>

        <h2>2 Требования к качеству и безопасности</h2>
        <p>2.1 Продукция должна соответствовать требованиям настоящих технических условий и изготавливаться по рецептурам и технологической инструкции с соблюдением требований технических регламентов Таможенного союза «О безопасности пищевой продукции» (ТР ТС 021/2011), «Пищевая продукция в части ее маркировки» (ТР ТС 022/2011){reg ? `, ${reg}` : ''}{sanpin ? `, ${sanpin}` : ''} и иных нормативных правовых актов Российской Федерации.</p>
        <p>2.2 Рецептуры продукции приведены в таблицах {c.items.map(() => T()).join(', ')}.</p>
        {c.items.map((i, k) => (
          <Fragment key={i.dish_id}>
            <table><caption className="tu-small" style={{ textAlign: 'left' }}>Таблица {tn - c.items.length + k + 1} — {i.name} (выход {n(i.object.yield_g)} г)</caption>
              <thead><tr><th>№</th><th>Наименование сырья</th><th>Нетто на выход, г</th><th>На 1 кг, г</th><th>На 100 кг, кг</th></tr></thead>
              <tbody>{i.recipe.map((r, j) => <tr key={j}><td>{j + 1}</td><td>{r.name}</td><td>{n(r.netto_g)}</td><td>{n(r.per_1kg_g)}</td><td>{n(r.per_100kg_kg)}</td></tr>)}</tbody></table>
          </Fragment>))}
        <p>2.3 По органолептическим показателям продукция должна соответствовать требованиям, приведённым в таблице {T()}.</p>
        <table>{cap()}<thead><tr><th>Наименование показателя</th>{c.items.map((i) => <th key={i.dish_id}>{i.name}</th>)}</tr></thead>
          <tbody>{OL.map(([key, l]) => <tr key={key}><td>{l}</td>{c.items.map((i) => <td key={i.dish_id}>{i.organoleptic_table?.[key] || <span className="tu-warn">не заполнено в ТТК</span>}</td>)}</tr>)}</tbody></table>
        <p>2.4 По физико-химическим показателям продукция должна соответствовать требованиям, приведённым в таблице {T()}.</p>
        <table>{cap()}<thead><tr><th>Наименование продукции</th><th>Показатель</th><th>Значение</th><th>Расчётное</th></tr></thead>
          <tbody>{c.items.flatMap((i) => i.physico.map((x, j) => <tr key={i.dish_id + x.indicator}>{j === 0 && <td rowSpan={i.physico.length}>{i.name}</td>}<td>{x.indicator}</td><td>{typeof x.norm === 'number' ? n(x.norm) : x.norm}</td><td>{n(x.calc)}</td></tr>))}</tbody></table>
        <p>2.5 Требования безопасности. Содержание токсичных элементов, микотоксинов, нитратов, пестицидов, радионуклидов и остаточных количеств ветеринарных лекарственных средств не должно превышать уровни, установленные ТР ТС 021/2011{reg ? ` и ${reg.split(' «')[0]}` : ''}. По микробиологическим показателям продукция должна соответствовать требованиям, приведённым в таблице {T()}.</p>
        <table>{cap()}<thead><tr><th>Наименование показателя</th>{c.items.map((i) => <th key={i.dish_id}>{i.name}</th>)}</tr></thead>
          <tbody>{(c.items[0]?.micro.indicators || []).map((m) => (c.items.some((i) => i.micro.indicators.find((x) => x.code === m.code)?.norm) &&
            <tr key={m.code}><td>{m.name}</td>{c.items.map((i) => <td key={i.dish_id}>{i.micro.indicators.find((x) => x.code === m.code)?.norm || 'не нормируется'}</td>)}</tr>))}</tbody></table>
        <p className="tu-small">Основание: {[...new Set(c.items.map((i) => i.micro.index || '— группа не выбрана'))].join('; ')}.</p>
        <p>2.6 Пищевая и энергетическая ценность продукции (расчётная; коэффициенты — ТР ТС 022/2011, приложение 4) приведена в таблице {T()}.</p>
        <table>{cap()}<thead><tr><th>Наименование продукции</th><th>Белки, г</th><th>Жиры, г</th><th>Углеводы, г</th><th>ккал / кДж</th></tr></thead>
          <tbody>{c.items.map((i) => { const p = i.nutrition.per100; return <tr key={i.dish_id}><td>{i.name} (в 100 г)</td>{p ? <><td>{n(p.protein)}</td><td>{n(p.fat)}</td><td>{n(p.carbs)}</td><td>{p.kcal} / {p.kj}</td></> : <td colSpan={4} className="tu-warn">не рассчитано</td>}</tr>; })}</tbody></table>
        <p>2.7 Аллергены (ТР ТС 022/2011): {c.items.map((i) => `${i.name} — ${i.allergens.contains.length ? i.allergens.contains.map((a) => a.label).join(', ') : i.allergens.complete ? 'не содержит' : 'профиль неполный'}`).join('; ')}.</p>
        <p>2.8 Требования к сырью. Сырьё по качеству и безопасности должно соответствовать требованиям технических регламентов и других нормативных правовых актов. Для изготовления продукции применяют: {[...new Set(c.items.flatMap((i) => (i.raw || []).map((r) => (r.doc ? `${r.name} по ${r.doc}` : r.name))))].join('; ') || '—'}.</p>

        <h2>3 Маркировка</h2>
        <p>3.1 Маркировка упакованной продукции — по ТР ТС 022/2011 (статья 4.1, пункт 1){c.meat_regulation === 'trts034' ? ' и ТР ТС 034/2013 (пункты 106–120: группа и вид мясной продукции, термическое состояние)' : c.meat_regulation === 'trts051' ? ' и ТР ЕАЭС 051/2021 (пункты 103–116: вид и возрастная группа птицы, группа и вид продукции, термическое состояние)' : ''}. Дополнительно указывают обозначение настоящих технических условий. Маркировка транспортной упаковки — по ТР ТС 022/2011 и ГОСТ 14192.</p>
        <h2>4 Упаковка</h2>
        <p>4.1 Упаковка и материалы, контактирующие с продукцией, — по ТР ТС 005/2011. {c.packaging || <span className="tu-warn">Способ упаковывания и вид упаковки — заполните в групповых ТУ.</span>}</p>
        <h2>5 Правила приемки</h2>
        <p>5.1 Продукцию принимают партиями. Партией считают количество продукции одного наименования, одинаково упакованной, изготовленной за одну смену по настоящим техническим условиям и сопровождаемой документацией, обеспечивающей прослеживаемость.</p>
        <p>5.2 Порядок и периодичность контроля устанавливаются в программе производственного контроля изготовителя{c.ppk ? ` (версия ${c.ppk.version}, утверждена ${dmy(c.ppk.d)})` : ''}.</p>
        <h2>6 Методы контроля</h2>
        <p>6.1 Органолептические показатели — по ГОСТ 31986. Микробиологические показатели — по методам: {[...new Map(c.items.flatMap((i) => i.micro.indicators.filter((m) => m.norm).map((m) => [m.code, `${m.name.split(',')[0]} — ${m.method}`] as [string, string]))).values()].join('; ')}.</p>
        <h2>7 Правила транспортирования и хранения</h2>
        <p>7.1 Условия хранения и сроки годности приведены в таблице {T()}. Сроки, превышающие установленные санитарными правилами, обосновывают по МУК 4.2.1847-04.</p>
        <table>{cap()}<thead><tr><th>Наименование продукции</th><th>Условия хранения</th><th>Срок годности</th></tr></thead>
          <tbody>{c.items.map((i) => <tr key={i.dish_id}><td>{i.name}</td><td>{i.storage.conditions || <span className="tu-warn">не указаны</span>}</td><td>{i.storage.shelf_life || <span className="tu-warn">не указан</span>}</td></tr>)}</tbody></table>

        {!appr && c.warnings.length > 0 && <div className="tu-warn noprint"><b>Замечания (устранить до утверждения):</b><ul>{c.warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>}
        <h2 style={{ pageBreakBefore: 'always' }}>Приложение А (справочное) Перечень ссылочных документов</h2>
        <table><thead><tr><th>Обозначение</th><th>Наименование</th></tr></thead><tbody>{c.normative.map((d) => <tr key={d.code}><td>{d.code}</td><td>{d.title}</td></tr>)}</tbody></table>
        <h2 style={{ pageBreakBefore: 'always' }}>Лист регистрации изменений настоящих технических условий</h2>
        <p className="tu-small">Форма — ГОСТ Р 1.3-2018, приложение Б. Обозначение: {designation}.</p>
        <table className="tu-small"><thead><tr><th>Номер изменения</th><th>Номера страниц изменённых / заменённых / новых / изъятых</th><th>Всего страниц</th><th>№ документа</th><th>Подпись</th><th>Фамилия и дата</th></tr></thead>
          <tbody>{Array.from({ length: 8 }, (_, i) => <tr key={i}>{Array.from({ length: 6 }, (_, j) => <td key={j} style={{ height: 22 }} />)}</tr>)}</tbody></table>
        <p className="tu-small">{appr ? `Утверждено: ${appr.approved_by_name}, ${dt(appr.approved_at, org.timezone)}. Протоколы испытаний: ${appr.lab_protocol}.` : 'Сформировано системой «ЦЕХ» по утверждённым ТТК и данным сырья.'}</p>
      </article>
    </>
  );
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Suspense><Doc id={id} /></Suspense>;
}
