'use client';
import { Suspense, use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useOrg } from '@/lib/org';
import { api } from '@/lib/api';
import { dt } from '@/lib/fmt';
import { dmy, fx, orgTitle } from '@/lib/ttkdoc';
import type { TiCalc } from '@/lib/ti';

interface Ver { version: number; designation: string; change_note: string; approved_at: string; approved_by_name: string }

/** Технологическая инструкция: титульный лист, разделы 1–9, лист регистрации изменений. Без ?v — текущий расчёт («ПРОЕКТ»). */
export default function TiPrintPage({ params }: { params: Promise<{ dishId: string }> }) {
  return <Suspense fallback={<p className="muted">Загрузка…</p>}><Doc params={params} /></Suspense>;
}

const GATE: Record<string, string> = { block: 'без действующей медицинской книжки к работе с продукцией не допускаются (система блокирует операции)',
  warn: 'допуск к работе — при действующей медицинской книжке (система предупреждает о просроченных)', off: 'допуск к работе — при действующей медицинской книжке' };

function Doc({ params }: { params: Promise<{ dishId: string }> }) {
  const { dishId } = use(params);
  const v = useSearchParams().get('v');
  const { org } = useOrg();
  const [c, setC] = useState<TiCalc | null>(null);
  const [vers, setVers] = useState<Ver[]>([]);
  const [appr, setAppr] = useState<Ver | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (v) api<Ver & { snapshot: TiCalc; versions: Ver[] }>(`/orgs/${org.id}/dishes/${dishId}/ti/versions/${v}`).then((x) => { setC(x.snapshot); setVers(x.versions); setAppr(x); }).catch((e) => setErr(e.message));
    else api<{ calc: TiCalc; versions: Ver[] }>(`/orgs/${org.id}/dishes/${dishId}/ti`).then((x) => { setC(x.calc); setVers(x.versions); }).catch((e) => setErr(e.message));
  }, [org.id, dishId, v]);
  if (err) return <div className="err">{err}</div>;
  if (!c) return <p className="muted">Загрузка…</p>;
  const year = appr ? new Date(appr.approved_at).getFullYear() : c.title.year;
  const isDish = c.dish.kind === 'dish';
  let no = 0;
  return (
    <>
      <div className="noprint">
        <p className="small"><Link href={`/app/${org.id}/menu/${dishId}/ti`}>← Технологическая инструкция</Link></p>
        <button className="btn block" onClick={() => window.print()}>Печать / сохранить PDF</button>
        {!appr && <p className="small muted">Текущий расчёт; действует только утверждённая версия.</p>}
      </div>
      <article className="tu-doc">
        {/* титульный лист */}
        <p className="tu-center" style={{ textTransform: 'uppercase', marginTop: 0 }}>{orgTitle(c.org)}</p>
        <table style={{ border: 0 }}><tbody><tr>
          <td style={{ border: 0, fontWeight: 700 }}>{c.title.okpd2 ? `ОКПД2 ${c.title.okpd2}` : ''}</td>
          <td style={{ border: 0, textAlign: 'right', fontWeight: 700 }}>{c.title.group ? `Группа ${c.title.group}` : ''}{c.title.oks ? <><br />(ОКС {c.title.oks})</> : null}</td>
        </tr></tbody></table>
        <div className="tu-right" style={{ marginTop: 10 }}><b>УТВЕРЖДАЮ</b><br />Руководитель<br />{orgTitle(c.org)}<br /><br />____________ / ____________<br />«___» __________ {year} г.</div>
        <h1 style={{ fontSize: '18pt', marginTop: 30, letterSpacing: 1 }}>ТЕХНОЛОГИЧЕСКАЯ ИНСТРУКЦИЯ</h1>
        <p className="tu-center"><b>по производству {isDish ? 'блюда' : 'полуфабриката'} «{c.dish.name}»</b></p>
        <p className="tu-center" style={{ fontSize: '13pt' }}><b>{c.designation}</b>{!appr && <> <span className="tu-stamp">{c.status === 'ready' ? 'ГОТОВА К УТВЕРЖДЕНИЮ' : 'ПРОЕКТ'}</span></>}</p>
        <p style={{ textAlign: 'right', marginTop: 20 }}><b>Дата введения в действие:</b><br />«___» __________ {year} г.</p>
        <p style={{ textAlign: 'right' }}>РАЗРАБОТАНО:<br />Технолог (заведующий производством)<br /><br />____________<br />«___» ________ {year} г.</p>
        <p className="tu-center" style={{ marginTop: 20 }}><b>{c.title.city ? `г. ${c.title.city}` : ''}<br />{year}</b></p>

        <h2 style={{ pageBreakBefore: 'always' }}>1. Область применения</h2>
        <p>Настоящая технологическая инструкция распространяется на {isDish ? 'блюдо' : 'полуфабрикат'} «{c.dish.name}», изготавливаемое {orgTitle(c.org)}{c.sites.length ? ` (${c.sites.join(', ')})` : ''},
          и устанавливает требования к сырью, рецептуре, технологическому процессу, упаковке и маркировке, контролю производства, хранению и транспортированию, санитарно-гигиенические требования и требования безопасности.
          Инструкция применяется совместно с технико-технологической картой № {c.ttk.card_no || '—'} от {dmy(c.ttk.card_date)}{c.tu ? ` и ${c.tu.designation}` : ''}.</p>

        <h2>2. Требования к сырью и материалам</h2>
        <p>Сырьё, пищевые продукты и материалы должны соответствовать требованиям нормативных документов, указанных ниже, и сопровождаться документами, подтверждающими их безопасность и качество.</p>
        <table><thead><tr><th>№</th><th>Сырьё</th><th>Нормативный документ</th></tr></thead>
          <tbody>{c.raw.map((r, i) => <tr key={r.product_id}><td>{i + 1}</td><td>{r.name}</td><td>{r.doc || <span className="tu-warn">не указан</span>}</td></tr>)}</tbody></table>

        <h2>3. Рецептура</h2>
        <table>
          <thead><tr><th rowSpan={2}>№</th><th rowSpan={2}>Наименование сырья</th><th colSpan={2}>{isDish ? 'На 1 порцию' : `На выход ${fx(c.out_g, 0)} г`}, г</th><th colSpan={2}>На 1 кг готовой продукции, г</th>
            {isDish && <th colSpan={2}>На 100 порций, кг</th>}<th rowSpan={2}>Нормы отходов и потерь</th></tr>
            <tr><th>брутто</th><th>нетто</th><th>брутто</th><th>нетто</th>{isDish && <><th>брутто</th><th>нетто</th></>}</tr></thead>
          <tbody>{c.recipe.map((r, i) => (
            <tr key={i}><td>{++no}</td><td>{r.name}{!r.in_yield && <div className="tu-small">в выход не входит</div>}</td><td>{fx(r.brutto_g, 1)}</td><td>{fx(r.netto_g, 1)}</td><td>{fx(r.per_kg.brutto, 1)}</td><td>{fx(r.per_kg.netto, 1)}</td>
              {isDish && <><td>{fx(r.per_100?.brutto_kg ?? null, 3)}</td><td>{fx(r.per_100?.netto_kg ?? null, 3)}</td></>}
              <td className="tu-small">{r.losses.length ? r.losses.map((s) => `${s.method}: ${s.loss_pct < 0 ? 'привар' : s.kind === 'cold' ? 'отходы' : 'потери'} ${fx(Math.abs(s.loss_pct), 1)} % (${s.basis})`).join('; ') : '—'}</td></tr>))}</tbody>
        </table>
        <p><b>Выход готовой продукции: {fx(c.out_g, 0)} г{isDish ? ' (1 порция)' : ''}.</b></p>

        <h2>4. Описание технологического процесса</h2>
        <p><b>4.1. Подготовка сырья.</b> Сырьё подготавливают в соответствии с нормами отходов и потерь (раздел 3).</p>
        {c.prep.length > 0 && <ul>{c.prep.map((x) => <li key={x}>{x}</li>)}</ul>}
        <p><b>4.2. Приготовление.</b></p>
        <p style={{ whiteSpace: 'pre-line' }}>{c.technology || '—'}</p>
        {c.serving && <p><b>4.3. Оформление и подача.</b> {c.serving}</p>}
        {c.equipment && <p><b>Оборудование и инвентарь:</b> {c.equipment}</p>}

        <h2>5. Упаковка и маркировка</h2>
        <p style={{ whiteSpace: 'pre-line' }}>{c.packaging || <span className="tu-warn">не заполнено</span>}</p>

        <h2>6. Контроль производства</h2>
        <p><b>6.1. Входной контроль.</b> {c.control.receipt}</p>
        <p><b>6.2. Контроль в критических контрольных точках.</b></p>
        {c.control.ccp.length ? <table><thead><tr><th>Параметр</th><th>Предел</th><th>Основание</th></tr></thead>
          <tbody>{c.control.ccp.map((x, i) => <tr key={i}><td>{x.name}</td><td>{x.limits}</td><td>{x.basis}</td></tr>)}</tbody></table>
          : <p>Параметры контроля при выпуске для продукции не установлены.</p>}
        <p><b>6.3. Органолептическая оценка</b> готовой продукции — по показателям ТТК: внешний вид — {c.control.organoleptic.appearance || '—'}; цвет — {c.control.organoleptic.color || '—'};
          консистенция — {c.control.organoleptic.consistency || '—'}; вкус и запах — {c.control.organoleptic.taste || '—'}.</p>
        <p><b>6.4. Лабораторный контроль</b> — по программе производственного контроля:</p>
        {c.control.lab.length ? <table><thead><tr><th>Исследование</th><th>Объект</th><th>Периодичность</th><th>Основание</th></tr></thead>
          <tbody>{c.control.lab.map((x, i) => <tr key={i}><td>{x.test}</td><td>{x.target}</td><td>{x.period}</td><td>{x.basis}</td></tr>)}</tbody></table> : <p className="tu-warn">Программа лабораторного контроля не утверждена.</p>}
        <p>Микробиологические показатели{c.control.micro_index ? ` (${c.control.micro_index})` : ''}: {c.control.micro.map((m) => `${m.name} — ${m.norm || 'не заполнено'}`).join('; ')}.</p>
        <p><b>6.5. Суточная проба</b> отбирается от каждой партии: не менее {fx(c.control.samples.weight_g, 0)} г, хранится {fx(c.control.samples.hours, 0)} ч при {c.control.samples.t} ({c.control.samples.basis}).</p>

        <h2>7. Требования к хранению и транспортированию</h2>
        <p>Условия хранения: {c.storage.conditions || '—'}. Срок годности (реализации): {c.storage.shelf_life || '—'}.
          Транспортирование — в чистой маркированной таре, специализированным транспортом при условиях, обеспечивающих сохранность продукции и соблюдение условий хранения.</p>

        <h2>8. Санитарно-гигиенические требования</h2>
        <p>Производство осуществляется с соблюдением {c.sanitation.sanpin.length ? c.sanitation.sanpin.map((s) => `${s.code} «${s.title}»`).join(', ') : 'действующих санитарных правил'}. Персонал: {GATE[c.sanitation.medical_gate] || GATE.warn}; соблюдение правил личной гигиены, ежедневный осмотр перед сменой.</p>
        {c.sanitation.plans.length > 0 && <><p>Санитарная обработка помещений, оборудования и инвентаря:</p>
          <table><thead><tr><th>Объект</th><th>Работа</th><th>Вид</th><th>Периодичность</th></tr></thead>
            <tbody>{c.sanitation.plans.map((x, i) => <tr key={i}><td>{x.area}</td><td>{x.work}</td><td>{x.kind}</td><td>{x.period}</td></tr>)}</tbody></table></>}

        <h2>9. Требования безопасности и охраны окружающей среды</h2>
        <p style={{ whiteSpace: 'pre-line' }}>{c.safety || <span className="tu-warn">не заполнено</span>}</p>
        {c.environment && <p style={{ whiteSpace: 'pre-line' }}>{c.environment}</p>}

        <h2 style={{ pageBreakBefore: 'always' }}>Лист регистрации изменений</h2>
        <table><thead><tr><th>Изм.</th><th>Обозначение</th><th>Содержание изменения</th><th>Утвердил</th><th>Дата</th></tr></thead>
          <tbody>{vers.length ? vers.map((x) => <tr key={x.version}><td>{x.version}</td><td>{x.designation}</td><td>{x.change_note}</td><td>{x.approved_by_name}</td><td>{dt(x.approved_at, org.timezone, { day: '2-digit', month: '2-digit', year: 'numeric' })}</td></tr>)
            : <tr><td colSpan={5}>—</td></tr>}</tbody></table>
        {!appr && c.warnings.length > 0 && <div className="tu-warn noprint">{c.warnings.map((w) => <div key={w}>{w}</div>)}</div>}
      </article>
    </>
  );
}
