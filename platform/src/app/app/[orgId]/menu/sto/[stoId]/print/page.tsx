'use client';
import { Suspense, use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useOrg } from '@/lib/org';
import { api } from '@/lib/api';
import { dt } from '@/lib/fmt';
import { dmy, fx, orgTitle } from '@/lib/ttkdoc';
import type { StoCalc } from '@/lib/sto';

interface Ver { version: number; designation: string; change_note: string; approved_at: string; approved_by_name: string }

/** Стандарт организации: титульный лист и разделы по ГОСТ Р 1.4/1.5 для группы блюд. Без ?v — текущий расчёт («ПРОЕКТ»). */
export default function StoPrintPage({ params }: { params: Promise<{ stoId: string }> }) {
  return <Suspense fallback={<p className="muted">Загрузка…</p>}><Doc params={params} /></Suspense>;
}

function Doc({ params }: { params: Promise<{ stoId: string }> }) {
  const { stoId } = use(params);
  const v = useSearchParams().get('v');
  const { org } = useOrg();
  const [c, setC] = useState<StoCalc | null>(null);
  const [vers, setVers] = useState<Ver[]>([]);
  const [appr, setAppr] = useState<Ver | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (v) api<Ver & { snapshot: StoCalc; versions: Ver[] }>(`/orgs/${org.id}/sto/${stoId}/versions/${v}`).then((x) => { setC(x.snapshot); setVers(x.versions); setAppr(x); }).catch((e) => setErr(e.message));
    else api<{ calc: StoCalc; versions: Ver[] }>(`/orgs/${org.id}/sto/${stoId}`).then((x) => { setC(x.calc); setVers(x.versions); }).catch((e) => setErr(e.message));
  }, [org.id, stoId, v]);
  if (err) return <div className="err">{err}</div>;
  if (!c) return <p className="muted">Загрузка…</p>;
  const year = appr ? new Date(appr.approved_at).getFullYear() : c.year;
  const val = (x: { normed: boolean; missing?: string[] }, s: string) => (!x.normed ? 'не нормируется' : x.missing && x.missing.length ? 'не рассчитано' : s);
  return (
    <>
      <div className="noprint">
        <p className="small"><Link href={`/app/${org.id}/menu/sto/${stoId}`}>← СТО</Link></p>
        <button className="btn block" onClick={() => window.print()}>Печать / сохранить PDF</button>
        {!appr && <p className="small muted">Текущий расчёт; действует только утверждённая версия.</p>}
      </div>
      <article className="tu-doc">
        <p className="tu-center" style={{ textTransform: 'uppercase' }}>{orgTitle(c.org)}</p>
        <div className="tu-right" style={{ marginTop: 10 }}><b>УТВЕРЖДАЮ</b><br />Руководитель {orgTitle(c.org)}<br /><br />____________ / ____________<br />«___» __________ {year} г.</div>
        <h1 style={{ fontSize: '18pt', marginTop: 30 }}>СТАНДАРТ ОРГАНИЗАЦИИ</h1>
        <p className="tu-center" style={{ fontSize: '13pt' }}><b>{c.designation}</b>{!appr && <> <span className="tu-stamp">{c.status === 'ready' ? 'ГОТОВ К УТВЕРЖДЕНИЮ' : 'ПРОЕКТ'}</span></>}</p>
        <p className="tu-center" style={{ fontSize: '13pt' }}><b>{c.title.toUpperCase()}</b></p>
        <p className="tu-center">Технические условия изготовления и реализации</p>
        <p style={{ textAlign: 'right', marginTop: 20 }}>Дата введения: «___» __________ {year} г.<br />Срок действия не ограничен; актуализация — не реже одного раза в год.</p>

        <h2 style={{ pageBreakBefore: 'always' }}>1. Область применения</h2>
        <p style={{ whiteSpace: 'pre-line' }}>{c.scope || <span className="tu-warn">не заполнено</span>}</p>
        <p>Стандарт распространяется на следующие блюда:</p>
        <table><thead><tr><th>№</th><th>Наименование</th><th>ТТК</th><th>Выход</th></tr></thead>
          <tbody>{c.dishes.map((d, i) => <tr key={d.id}><td>{i + 1}</td><td>{d.name}</td><td>№ {d.card_no || '—'} от {dmy(d.card_date)} (версия {d.ttk_version})</td><td>{d.out_label}</td></tr>)}</tbody></table>

        <h2>2. Нормативные ссылки</h2>
        <ul>{c.normative.map((n) => <li key={n.code}>{n.code} {n.title}</li>)}</ul>

        <h2>3. Перечень сырья</h2>
        <table><thead><tr><th>№</th><th>Сырьё</th><th>Нормативный документ</th><th>Используется в</th></tr></thead>
          <tbody>{c.raw.map((r, i) => <tr key={r.product_id}><td>{i + 1}</td><td>{r.name}</td><td>{r.doc || <span className="tu-warn">не указан</span>}</td><td className="tu-small">{r.dishes.join(', ')}</td></tr>)}</tbody></table>

        <h2>4. Требования к качеству сырья</h2>
        <p>Сырьё должно соответствовать нормативным документам раздела 3, требованиям ТР ТС 021/2011 и сопровождаться документами, подтверждающими его безопасность и качество
          (декларация или сертификат соответствия, ветеринарные сопроводительные документы для подконтрольной продукции). Сырьё принимается по входному контролю: целостность упаковки, маркировка,
          документы, органолептика, температура, срок годности.</p>

        <h2>5. Нормы закладки</h2>
        {c.dishes.map((d) => (
          <div key={d.id} style={{ breakInside: 'avoid' }}>
            <p><b>{d.name}</b> — {d.out_label}</p>
            <table><thead><tr><th>Сырьё</th><th>Брутто, г</th><th>Нетто, г</th><th>Обработка</th></tr></thead>
              <tbody>{d.lines.map((l, i) => l.kind === 'heading' ? <tr key={i}><td colSpan={4}><i>{l.name}</i></td></tr>
                : <tr key={i}><td>{l.name}</td><td>{fx(l.brutto_g, 1)}</td><td>{fx(l.netto_g, 1)}</td><td className="tu-small">{l.processing}</td></tr>)}</tbody></table>
            <p className="tu-small">{d.semi_yield_g ? `Выход полуфабриката: ${fx(d.semi_yield_g, 0)} г. ` : ''}Выход готового блюда: {fx(d.out_g, 0)} г.</p>
          </div>))}

        <h2>6. Технологический процесс</h2>
        {c.dishes.map((d) => <div key={d.id}><p><b>{d.name}.</b></p><p style={{ whiteSpace: 'pre-line' }}>{d.technology || '—'}</p></div>)}

        <h2>7. Требования к оформлению, подаче, реализации и хранению</h2>
        <table><thead><tr><th>Блюдо</th><th>Оформление и подача</th><th>Условия хранения</th><th>Срок годности</th></tr></thead>
          <tbody>{c.dishes.map((d) => <tr key={d.id}><td>{d.name}</td><td>{d.serving || '—'}</td><td>{d.storage || '—'}</td><td>{d.shelf_life || '—'}</td></tr>)}</tbody></table>
        {c.transport && <p style={{ whiteSpace: 'pre-line' }}>Транспортирование: {c.transport}</p>}

        <h2>8. Упаковка и маркировка</h2>
        <p style={{ whiteSpace: 'pre-line' }}>{c.packaging || <span className="tu-warn">не заполнено</span>}</p>

        <h2>9. Показатели качества и безопасности</h2>
        <p><b>9.1. Органолептические показатели</b></p>
        <table><thead><tr><th>Блюдо</th><th>Внешний вид</th><th>Цвет</th><th>Консистенция</th><th>Вкус и запах</th></tr></thead>
          <tbody>{c.dishes.map((d) => <tr key={d.id}><td>{d.name}</td><td>{d.organoleptic.appearance || '—'}</td><td>{d.organoleptic.color || '—'}</td><td>{d.organoleptic.consistency || '—'}</td><td>{d.organoleptic.taste || '—'}</td></tr>)}</tbody></table>
        <p><b>9.2. Физико-химические показатели, массовая доля, %</b></p>
        <table><thead><tr><th>Блюдо</th><th>Сухие вещества</th><th>Жир</th><th>Сахар</th><th>Соль</th></tr></thead>
          <tbody>{c.dishes.map((d) => { const p = d.physico as any; return (
            <tr key={d.id}><td>{d.name}</td><td>{val(p.dry, `${fx(p.dry.min)}–${fx(p.dry.max)}`)}</td><td>{val(p.fat, `${fx(p.fat.min)}–${fx(p.fat.max)}`)}</td>
              <td>{val(p.sugar, fx(p.sugar.value))}</td><td>{val(p.salt, `не более ${fx(p.salt.value)}`)}</td></tr>); })}</tbody></table>
        <p><b>9.3. Микробиологические показатели</b></p>
        {c.dishes.map((d) => <p key={d.id} className="tu-small"><b>{d.name}</b>{d.micro_index ? ` (${d.micro_index})` : ''}: {d.micro.map((m) => `${m.name} — ${m.norm || 'не заполнено'}`).join('; ')}.</p>)}

        <h2>10. Методы контроля</h2>
        <ul>
          <li>Органолептическая оценка — по ГОСТ 31986-2012.</li>
          <li>Масса нетто, выход — взвешиванием; отходы и потери — по ГОСТ 31988-2012.</li>
          <li>Физико-химические показатели — по методикам аккредитованной лаборатории.</li>
          {c.micro_methods.map((m) => <li key={m.name}>{m.name} — {m.method}.</li>)}
        </ul>
        {c.control_methods && <p style={{ whiteSpace: 'pre-line' }}>{c.control_methods}</p>}

        <h2>11. Информационные данные о пищевой и энергетической ценности</h2>
        <table><thead><tr><th>Блюдо</th><th>Основа</th><th>Белки, г</th><th>Жиры, г</th><th>Углеводы, г</th><th>ккал (кДж)</th></tr></thead>
          <tbody>{c.dishes.flatMap((d) => d.nutrition ? [
            <tr key={`${d.id}-p`}><td rowSpan={2}>{d.name}</td><td>{d.kind === 'dish' ? `порция ${fx(d.out_g, 0)} г` : `${fx(d.out_g, 0)} г`}</td><td>{fx(d.nutrition.total.protein)}</td><td>{fx(d.nutrition.total.fat)}</td><td>{fx(d.nutrition.total.carbs)}</td><td>{fx(d.nutrition.total.kcal)} ({fx(d.nutrition.total.kj, 0)})</td></tr>,
            <tr key={`${d.id}-h`}><td>100 г</td><td>{fx(d.nutrition.per100.protein)}</td><td>{fx(d.nutrition.per100.fat)}</td><td>{fx(d.nutrition.per100.carbs)}</td><td>{fx(d.nutrition.per100.kcal)} ({fx(d.nutrition.per100.kj, 0)})</td></tr>]
            : [<tr key={d.id}><td>{d.name}</td><td colSpan={5}>не рассчитано</td></tr>])}</tbody></table>
        <p className="tu-small">Пищевая и энергетическая ценность — расчётные (ТР ТС 022/2011: белки и углеводы — 4, жиры — 9 ккал/г).</p>

        <h2 style={{ pageBreakBefore: 'always' }}>Лист регистрации изменений</h2>
        <table><thead><tr><th>Изм.</th><th>Обозначение</th><th>Содержание изменения</th><th>Утвердил</th><th>Дата</th></tr></thead>
          <tbody>{vers.length ? vers.map((x) => <tr key={x.version}><td>{x.version}</td><td>{x.designation}</td><td>{x.change_note}</td><td>{x.approved_by_name}</td><td>{dt(x.approved_at, org.timezone, { day: '2-digit', month: '2-digit', year: 'numeric' })}</td></tr>)
            : <tr><td colSpan={5}>—</td></tr>}</tbody></table>
        {!appr && c.warnings.length > 0 && <div className="tu-warn noprint">{c.warnings.map((w) => <div key={w}>{w}</div>)}</div>}
      </article>
    </>
  );
}
