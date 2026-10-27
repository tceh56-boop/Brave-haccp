'use client';
import { Suspense, use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useOrg } from '@/lib/org';
import { api } from '@/lib/api';
import { dt, n } from '@/lib/fmt';
import type { TuCalc } from '../page';

/**
 * Технические условия по ГОСТ Р 51740-2016: титульный лист по приложению А (поля 1–13, п. 4.2), основная часть из
 * разделов п. 4.1.3 в установленном порядке (содержание — по разделу 5), перечень ссылочных документов последним
 * справочным приложением (5.8), лист регистрации изменений по форме ГОСТ Р 1.3-2018 (приложение Б).
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
  const allergens = c.allergens.contains.length ? c.allergens.contains.map((a) => `${a.label} (${a.sources.join(', ')})`).join('; ')
    : c.allergens.complete ? 'не содержит' : errors.length ? 'не определены — часть сырья не вошла в расчёт (см. ошибки)' : 'профиль аллергенов неполный';
  const t = c.title || { holder: org.name, okpd2: null, oks: null, replaces: null, intro_date: null, developer: null, location: null, purpose: 'для непосредственного употребления в пищу' };
  const sanpin = c.normative.filter((d) => d.code.startsWith('СанПиН')).map((d) => d.code).join(', ');
  const ol = c.organoleptic_table || {};
  const OL: [string, string][] = [['appearance', 'Внешний вид'], ['color', 'Цвет'], ['consistency', 'Консистенция'], ['taste', 'Вкус и запах']];
  const dmy = (d: string | null | undefined) => (d ? d.slice(0, 10).split('-').reverse().join('.') : '__.__.____');
  const name = o.name;
  let tn = 0; const T = () => ++tn;   // сквозная нумерация таблиц
  return (
    <>
      <div className="noprint">
        <p className="small"><Link href={`/app/${org.id}/menu/${dishId}/tu`}>← Технические условия</Link></p>
        <button className="btn block" onClick={() => window.print()}>Печать / сохранить PDF</button>
        {!appr && <p className="small muted">Документ сформирован по текущему расчёту. Для проверки и согласования; действует только утверждённая версия.</p>}
      </div>
      <article className="tu-doc">
        {errors.length > 0 && <div className="tu-warn"><b>Ошибки в данных — документ выпускать нельзя, пока они не исправлены в ТТК:</b><ul>{errors.map((w) => <li key={w}>{w}</li>)}</ul></div>}

        {/* Титульный лист — ГОСТ Р 51740-2016, приложение А, рисунок А.1 */}
        <p className="tu-center" style={{ textTransform: 'uppercase', fontWeight: 700 }}>{t.holder}</p>
        <div className="between" style={{ alignItems: 'flex-start', marginTop: 12 }}>
          <div className="tu-small" style={{ color: '#111' }}>ОКПД2 {t.okpd2 || '__.__.__.___'}<br />{t.oks ? `ОКС ${t.oks}` : 'ОКС ___________'}</div>
          <div className="tu-right">УТВЕРЖДАЮ<br />Руководитель {t.holder}<br />____________ / ____________<br />{appr ? dt(appr.approved_at, org.timezone, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '«___» __________ ' + year + ' г.'}</div>
        </div>
        <h1 style={{ fontSize: '17pt', marginTop: 50, textTransform: 'uppercase' }}>{name}</h1>
        <p className="tu-center" style={{ fontWeight: 700, margin: '6px 0' }}>Технические условия</p>
        <p className="tu-center" style={{ fontWeight: 700, margin: '6px 0' }}>{appr?.designation || c.designation}</p>
        <p className="tu-center" style={{ margin: '6px 0' }}>({t.replaces ? `взамен ${t.replaces}` : 'утверждены впервые'})</p>
        <p className="tu-center">Дата введения в действие — {dmy(t.intro_date)} <span className="tu-stamp">{stamp}</span></p>
        {t.developer && <p className="tu-center" style={{ marginTop: 30 }}>РАЗРАБОТАНО<br />{t.developer}</p>}
        <p className="tu-center" style={{ marginTop: 60 }}>{t.location || '— местонахождение держателя подлинника —'}<br />{year}</p>

        <h2 style={{ pageBreakBefore: 'always' }}>1 Область применения</h2>
        <p>Настоящие технические условия распространяются на {o.kind === 'semi' ? 'полуфабрикат' : 'продукцию общественного питания'} «{name}» (далее — продукт), изготавливаемый {t.holder}, предназначенный {t.purpose} и реализуемый {c.channel}.</p>
        <p>Продукт изготавливается по рецептуре и технологической инструкции изготовителя, разработанным в соответствии с ГОСТ 31987.</p>

        <h2>2 Требования к качеству и безопасности</h2>
        <p>2.1 Продукт должен соответствовать требованиям настоящих технических условий и изготавливаться по рецептуре и технологической инструкции с соблюдением требований к производству, установленных техническими регламентами Таможенного союза «О безопасности пищевой продукции» (ТР ТС 021/2011) и «Пищевая продукция в части ее маркировки» (ТР ТС 022/2011){sanpin ? `, ${sanpin}` : ''} и иными нормативными правовыми актами Российской Федерации.</p>
        <p>2.2 Рецептура продукта (выход {n(o.yield_g)} г; закладка нетто {n(o.input_mass_g)} г{o.production_loss_pct >= 0 ? `; потери при производстве ${n(o.production_loss_pct)} %, расчёт по ГОСТ 31988` : ''}) приведена в таблице {T()}.</p>
        <table><caption className="tu-small" style={{ textAlign: 'left' }}>Таблица {tn}</caption><thead><tr><th>№</th><th>Наименование сырья</th><th>Вид</th><th>Нетто на выход, г</th><th>На 1 кг, г</th><th>На 100 кг, кг</th></tr></thead>
          <tbody>{c.recipe.map((r, i) => <tr key={i}><td>{i + 1}</td><td>{r.name}</td><td>{r.kind}</td><td>{n(r.netto_g)}</td><td>{n(r.per_1kg_g)}</td><td>{n(r.per_100kg_kg)}</td></tr>)}</tbody></table>
        <p>2.3 По органолептическим показателям продукт должен соответствовать требованиям, приведённым в таблице {T()}.</p>
        <table><caption className="tu-small" style={{ textAlign: 'left' }}>Таблица {tn}</caption><thead><tr><th>Наименование показателя</th><th>Характеристика показателя</th></tr></thead>
          <tbody>{OL.map(([k, l]) => <tr key={k}><td>{l}</td><td>{ol[k] || <span className="tu-warn">не заполнено в ТТК</span>}</td></tr>)}</tbody></table>
        <p>2.4 По физико-химическим показателям продукт должен соответствовать требованиям, приведённым в таблице {T()} (допуск {Math.round(c.tolerance * 100)} % от расчётного значения).</p>
        <table><caption className="tu-small" style={{ textAlign: 'left' }}>Таблица {tn}</caption><thead><tr><th>Наименование показателя</th><th>Значение показателя</th><th>Расчётное</th></tr></thead>
          <tbody>{c.physico.map((x) => <tr key={x.indicator}><td>{x.indicator}</td><td>{typeof x.norm === 'number' ? n(x.norm) : x.norm}</td><td>{n(x.calc)}</td></tr>)}</tbody></table>
        <p>2.5 Требования безопасности. Содержание токсичных элементов, микотоксинов, нитратов, пестицидов и радионуклидов в продукте не должно превышать уровни, установленные в ТР ТС 021/2011.
          По микробиологическим показателям продукт должен соответствовать требованиям, приведённым в таблице {T()} ({c.micro.mode === 'none' ? <span className="tu-warn">группа продукции по ТР ТС 021/2011 не подтверждена{c.micro.suggested ? `; предложена «${c.micro.suggested.name}»` : ''}</span> : c.micro.index || `ТР ТС 021/2011, группа «${c.micro.group}»`}).</p>
        <table><caption className="tu-small" style={{ textAlign: 'left' }}>Таблица {tn}</caption><thead><tr><th>Наименование показателя</th><th>Допустимый уровень</th></tr></thead>
          <tbody>{c.micro.indicators.map((m) => <tr key={m.code}><td>{m.name}</td><td>{m.norm || (c.micro.mode === 'law' ? 'не нормируется' : '— не установлено')}</td></tr>)}</tbody></table>
        {c.micro.note && <p className="tu-small">{c.micro.note}</p>}
        <p>2.6 Пищевая и энергетическая ценность продукта (расчётная; коэффициенты пересчёта — ТР ТС 022/2011, приложение 4; {c.processing.by_norms_pct ? 'потери пищевых веществ — по нормам обработки сырья' : c.processing.mode === 'thermal' ? 'без учёта потерь при тепловой обработке: норм обработки с основанием нет' : 'без тепловой обработки'}) приведена в таблице {T()}.</p>
        <table><caption className="tu-small" style={{ textAlign: 'left' }}>Таблица {tn}</caption><thead><tr><th /><th>Белки, г</th><th>Жиры, г</th><th>Углеводы, г</th><th>Энергетическая ценность, ккал / кДж</th></tr></thead>
          <tbody>{p ? <tr><td>В 100 г продукта</td><td>{n(p.protein)}</td><td>{n(p.fat)}</td><td>{n(p.carbs)}</td><td>{p.kcal} / {p.kj}</td></tr> : <tr><td colSpan={5}>не рассчитано — нет данных пищевой ценности сырья</td></tr>}
            {c.nutrition.per_portion && <tr><td>В порции {o.portion_g} г</td><td>{n(c.nutrition.per_portion.protein)}</td><td>{n(c.nutrition.per_portion.fat)}</td><td>{n(c.nutrition.per_portion.carbs)}</td><td>{c.nutrition.per_portion.kcal} / {c.nutrition.per_portion.kj}</td></tr>}</tbody></table>
        <p>2.7 Аллергены (ТР ТС 022/2011): {allergens}.</p>
        <p>2.8 Требования к сырью. Все сырьё, используемое для изготовления пищевой продукции, по качеству и безопасности должно соответствовать требованиям технических регламентов и других нормативных правовых актов.
          {(c.raw || []).length > 0 && <> Для изготовления продукта применяют:</>}</p>
        {(c.raw || []).length > 0 && <ul>{c.raw!.map((r) => <li key={r.name}>{r.name}{r.doc ? ` по ${r.doc}` : ''};</li>)}</ul>}
        <p>Допускается применение аналогичных видов сырья отечественного или импортного производства, не уступающих по качественным характеристикам вышеперечисленным и соответствующих требованиям действующего законодательства в области качества и безопасности сырья (и пищевых добавок) для пищевой продукции.</p>

        <h2>3 Маркировка</h2>
        <p>3.1 Маркировку наносят на потребительскую упаковку или этикетку (ярлык) типографским способом или печатью этикетки на месте изготовления; маркировка излагается на русском языке.</p>
        <p>3.2 Маркировка упакованного продукта — по ТР ТС 022/2011 (статья 4.1, пункт 1): наименование; состав (с указанием аллергенов); количество; дата изготовления; срок годности; условия хранения, в том числе после вскрытия упаковки; наименование и место нахождения изготовителя; рекомендации и (или) ограничения по использованию; показатели пищевой ценности; сведения о наличии компонентов, полученных с применением ГМО; единый знак обращения продукции на рынке. Дополнительно указывают обозначение настоящих технических условий.</p>
        <p>3.3 В маркировке указывают один режим хранения и один срок годности, установленные в разделе 7.</p>
        <p>3.4 Маркировка транспортной упаковки — по ТР ТС 022/2011 и ГОСТ 14192.</p>

        <h2>4 Упаковка</h2>
        <p>4.1 Упаковка и упаковочные материалы, контактирующие с продуктом, должны соответствовать ТР ТС 005/2011 и быть предназначены для контакта с пищевой продукцией.</p>
        <p>4.2 {c.packaging || <span className="tu-warn">Способ упаковывания, вид потребительской и транспортной упаковки, количество продукта в упаковке — заполните в параметрах ТИ/ТУ.</span>}</p>

        <h2>5 Правила приемки</h2>
        <p>5.1 Продукт принимают партиями. Партией считают количество продукта одного наименования, одинаково упакованного, изготовленного изготовителем по настоящим техническим условиям за одну смену и сопровождаемого документацией, обеспечивающей прослеживаемость.</p>
        <p>5.2 Каждую партию подвергают органолептической оценке (бракераж) по ГОСТ 31986 с записью результатов в журнале бракеража готовой продукции.</p>
        <p>5.3 Порядок и периодичность производственного контроля по показателям качества и безопасности устанавливаются в программе производственного контроля изготовителя{c.ppk ? ` (версия ${c.ppk.version}, утверждена ${dmy(c.ppk.d)})` : ''}.</p>
        <p>5.4 Изготовитель по результатам приемки удостоверяет соответствие качества и безопасности каждой партии продукта требованиям настоящих технических условий.</p>

        <h2>6 Методы контроля</h2>
        <p>6.1 Органолептические показатели определяют по ГОСТ 31986.</p>
        <p>6.2 Физико-химические показатели определяют по методикам аккредитованной испытательной лаборатории.</p>
        <p>6.3 Микробиологические показатели определяют: {c.micro.indicators.filter((m) => m.norm).map((m) => `${m.name.split(',')[0]} — по ${m.method}`).join('; ') || '— по методам стандартов на показатели'}.</p>
        <p>6.4 Отбор и подготовку проб проводят в соответствии с нормативными документами на методы испытаний.</p>

        <h2>7 Правила транспортирования и хранения</h2>
        <p>7.1 Продукт транспортируют специализированными транспортными средствами в соответствии с правилами перевозки пищевой продукции, установленными на данном виде транспорта, с соблюдением требований ТР ТС 021/2011{sanpin ? ` и ${sanpin}` : ''} и температурного режима хранения продукта.</p>
        <p>7.2 Условия хранения: {c.storage.conditions || <span className="tu-warn">не указаны в ТТК</span>}.</p>
        <p>7.3 Срок годности: {c.storage.shelf_life || <span className="tu-warn">не указан в ТТК</span>} (с момента окончания технологического процесса). Срок годности, превышающий установленный санитарными правилами, обосновывается по МУК 4.2.1847-04.</p>

        {!appr && c.warnings.length > 0 && <div className="tu-warn noprint"><b>Замечания (устранить до утверждения ТУ):</b><ul>{c.warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>}

        <h2 style={{ pageBreakBefore: 'always' }}>Приложение А (справочное) Перечень ссылочных документов</h2>
        <table><thead><tr><th>Обозначение</th><th>Наименование</th></tr></thead>
          <tbody>{c.normative.map((d) => <tr key={d.code}><td>{d.code}</td><td>{d.title}</td></tr>)}</tbody></table>
        <p className="tu-small noprint">Состояние документов в нормативной базе системы: {c.normative.map((d) => `${d.code} — ${d.state}`).join('; ')}. Действие ссылочных документов проверяют не реже одного раза в год (ГОСТ Р 51740-2016, 5.8.5).</p>

        <h2 style={{ pageBreakBefore: 'always' }}>Лист регистрации изменений настоящих технических условий</h2>
        <p className="tu-small">Форма — ГОСТ Р 1.3-2018, приложение Б, рисунок Б.1. Обозначение: {appr?.designation || c.designation}.</p>
        <table className="tu-small"><thead>
          <tr><th rowSpan={2}>Номер изменения</th><th colSpan={4}>Номера страниц</th><th rowSpan={2}>Всего страниц после внесения изменения</th><th rowSpan={2}>№ документа</th><th rowSpan={2}>Информация о поступлении изменения (номер сопроводительного письма)</th><th rowSpan={2}>Подпись лица, внесшего изменения</th><th rowSpan={2}>Фамилия лица, внесшего изменения, и дата внесения изменения</th></tr>
          <tr><th>заменённых</th><th>дополнительных</th><th>исключённых</th><th>изменённых</th></tr></thead>
          <tbody>{Array.from({ length: 8 }, (_, i) => <tr key={i}>{Array.from({ length: 10 }, (_, j) => <td key={j} style={{ height: 22 }} />)}</tr>)}</tbody></table>
        <p className="tu-small">{appr ? `Утверждено: ${appr.approved_by_name}, ${dt(appr.approved_at, org.timezone)}. Протокол испытаний: ${appr.lab_protocol}.` : 'Сформировано системой «ЦЕХ» по рецептуре и данным сырья.'} Расчётные показатели подтверждаются протоколом испытаний аккредитованной лаборатории.</p>
      </article>
    </>
  );
}

export default function Page({ params }: { params: Promise<{ dishId: string }> }) {
  const { dishId } = use(params);
  return <Suspense><Doc dishId={dishId} /></Suspense>;
}
