'use client';
import { Suspense, use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useOrg } from '@/lib/org';
import { api } from '@/lib/api';
import { dmy, fx, orgTitle, type TtkDoc } from '@/lib/ttkdoc';

/** Технико-технологическая карта по ГОСТ 31987-2012: 7 разделов по п. 5.3.2, образец — приложение В. Проект — с отметкой «ПРОЕКТ». */
export default function TtkPrintPage({ params }: { params: Promise<{ dishId: string }> }) {
  return <Suspense fallback={<p className="muted">Загрузка…</p>}><Doc params={params} /></Suspense>;
}

function Doc({ params }: { params: Promise<{ dishId: string }> }) {
  const { dishId } = use(params);
  const v = useSearchParams().get('v');
  const { org } = useOrg();
  const [d, setD] = useState<TtkDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<TtkDoc>(`/orgs/${org.id}/dishes/${dishId}/ttk-doc${v ? `?versionId=${v}` : ''}`).then(setD).catch((e) => setErr(e.message)); }, [org.id, dishId, v]);
  if (err) return <div className="err">{err}</div>;
  if (!d) return <p className="muted">Загрузка…</p>;
  const ver = d.version, o = ver.organoleptic, ph = d.physico, isDish = d.dish.kind === 'dish';
  const project = ver.status !== 'approved' && ver.status !== 'archived';
  let no = 0;
  const outLabel = isDish ? 'на 1 порцию' : `на выход ${fx(d.out_g, 0)} г`;
  const total = d.lines.filter((l) => l.kind === 'item' && l.in_yield).reduce((s, l) => s + (l.ready_g ?? 0), 0);
  // выход по разделам: «120/110/95»
  const parts: number[] = [];
  if (d.sections) {
    let cur: number | null = null;
    for (const l of d.lines) {
      if (l.kind === 'heading') { if (cur !== null) parts.push(cur); cur = 0; continue; }
      cur = (cur ?? 0) + (l.in_yield ? l.ready_g ?? 0 : 0);
    }
    if (cur !== null) parts.push(cur);
  }
  const yieldText = d.sections ? parts.map((x) => fx(x, 0)).join('/') : fx(d.out_g, 0);
  const val = (x: { normed: boolean; missing?: string[] }, s: string) => (!x.normed ? '-' : x.missing && x.missing.length ? 'не рассчитано' : s);
  return (
    <>
      <div className="noprint">
        <p className="small"><Link href={`/app/${org.id}/menu/${dishId}/ttk-docs?v=${ver.id}`}>← Документы ТТК</Link></p>
        <button className="btn block" onClick={() => window.print()}>Печать / сохранить PDF</button>
        {project && <p className="small muted">Версия ТТК не утверждена — документ с отметкой «ПРОЕКТ».</p>}
      </div>
      <article className="tu-doc">
        <table style={{ border: 0 }}><tbody><tr>
          <td style={{ border: 0, width: '55%' }}><div style={{ borderBottom: '1px solid #111' }}>{orgTitle(d.org)}</div>{d.sites[0] && <div style={{ borderBottom: '1px solid #111' }}>{d.sites.join(', ')}</div>}</td>
          <td style={{ border: 0, textAlign: 'right' }}>Утверждаю<br />Руководитель<br /><br />____________ / ____________</td>
        </tr></tbody></table>
        <h1>Технико-технологическая карта № {d.dish.card_no || '—'} от {dmy(ver.card_date)}</h1>
        <h1 style={{ marginTop: 0 }}>{d.dish.name}{project && <> <span className="tu-stamp">ПРОЕКТ</span></>}</h1>

        <h2 className="tu-center" style={{ border: 0 }}>1. Область применения</h2>
        <p>Настоящая технико-технологическая карта распространяется на {isDish ? 'блюдо (изделие)' : 'полуфабрикат'} «{d.dish.name}», вырабатываемое {orgTitle(d.org)}{d.sites.length ? ` и реализуемое в: ${d.sites.join(', ')}` : ''}.</p>

        <h2 className="tu-center" style={{ border: 0 }}>2. Требования к сырью</h2>
        <p>Продовольственное сырьё, пищевые продукты и полуфабрикаты, используемые для приготовления {isDish ? 'данного блюда (изделия)' : 'данного полуфабриката'}, должны соответствовать требованиям действующих нормативных и технических документов, иметь сопроводительные документы, подтверждающие их безопасность и качество.</p>

        <h2 className="tu-center" style={{ border: 0 }}>3. Рецептура</h2>
        <table>
          <thead><tr><th rowSpan={2}>№</th><th rowSpan={2}>Наименование сырья и полуфабрикатов</th><th colSpan={2} className="tu-center">Расход сырья и п/ф {outLabel}, г</th></tr>
            <tr><th>Брутто, г</th><th>Нетто, г</th></tr></thead>
          <tbody>{d.lines.map((l, i) => l.kind === 'heading'
            ? <tr key={i}><td colSpan={4}><i>{l.name}</i></td></tr>
            : <tr key={i}><td>{++no}</td><td>{l.name}</td><td style={{ textAlign: 'right' }}>{fx(l.brutto_g, 1)}</td><td style={{ textAlign: 'right' }}>{fx(l.netto_g, 1)}</td></tr>)}</tbody>
        </table>
        <p style={{ textAlign: 'right' }}><b>Выход готового изделия, г: {yieldText}</b></p>
        {Math.abs(total - d.out_g) > d.out_g * 0.03 && total > 0 && <p className="tu-warn noprint">Сумма выходов ингредиентов ({fx(total, 0)} г) расходится с выходом ({fx(d.out_g, 0)} г) — проверьте рецептуру.</p>}

        <h2 className="tu-center" style={{ border: 0 }}>4. Технологический процесс</h2>
        <p style={{ whiteSpace: 'pre-line' }}>{ver.technology || '—'}</p>

        <h2 className="tu-center" style={{ border: 0 }}>5. Требования к оформлению, подаче, реализации и хранению</h2>
        {ver.serving && <p style={{ whiteSpace: 'pre-line' }}>{ver.serving}</p>}
        <p>Условия хранения: {ver.storage_conditions || '—'}. Срок годности (реализации): {ver.shelf_life || '—'}.</p>

        <h2 className="tu-center" style={{ border: 0 }}>6. Показатели качества и безопасности</h2>
        <h3 className="tu-center">6.1. Органолептические показатели</h3>
        <table><thead><tr><th>Внешний вид</th><th>Цвет</th><th>Консистенция</th><th>Вкус и запах</th></tr></thead>
          <tbody><tr><td>{o.appearance || '—'}</td><td>{o.color || '—'}</td><td>{o.consistency || '—'}</td><td>{o.taste || '—'}</td></tr></tbody></table>
        <h3 className="tu-center">6.2. Нормируемые физико-химические показатели</h3>
        <table>
          <thead><tr><th colSpan={6} className="tu-center">Массовая доля, %</th></tr>
            <tr><th colSpan={2} className="tu-center">Сухих веществ</th><th colSpan={2} className="tu-center">Жира</th><th rowSpan={2} className="tu-center">Сахара</th><th rowSpan={2} className="tu-center">Поваренной соли</th></tr>
            <tr><th>Мин.</th><th>Макс.</th><th>Мин.</th><th>Макс.</th></tr></thead>
          <tbody><tr className="tu-center">
            <td>{val(ph.dry, fx((ph.dry as { min: number }).min))}</td><td>{val(ph.dry, fx((ph.dry as { max: number }).max))}</td>
            <td>{val(ph.fat, fx((ph.fat as { min: number }).min))}</td><td>{val(ph.fat, fx((ph.fat as { max: number }).max))}</td>
            <td>{val(ph.sugar, fx((ph.sugar as { value: number }).value))}</td><td>{val(ph.salt, fx((ph.salt as { value: number }).value))}</td></tr></tbody>
        </table>
        {ph.fat.normed && <p className="tu-small">Для определения минимального содержания жира использован метод Гербера.{ph.basis ? ` Основание: ${ph.basis}.` : ''}</p>}
        <h3 className="tu-center">6.3. Микробиологические показатели{d.micro_index ? ` (${d.micro_index})` : ''}</h3>
        <p>Микробиологические показатели {isDish ? 'блюда (изделия)' : 'полуфабриката'} должны соответствовать требованиям ТР ТС 021/2011 «О безопасности пищевой продукции» или гигиеническим нормативам, установленным в соответствии с нормативными правовыми актами или нормативными документами, действующими на территории государства, принявшего стандарт.</p>
        {d.micro.some((m) => m.norm) && <table><thead><tr><th>Показатель</th><th>Норматив</th></tr></thead>
          <tbody>{d.micro.filter((m) => m.norm).map((m) => <tr key={m.code}><td>{m.name}</td><td>{m.norm}</td></tr>)}</tbody></table>}
        {d.micro_note && <p>{d.micro_note}</p>}

        <h2 className="tu-center" style={{ border: 0 }}>7. Пищевая и энергетическая ценность</h2>
        {d.nutrition ? (
          <table className="tu-center">
            <thead><tr><th>Белки, г</th><th>Жиры, г</th><th>Углеводы, г</th><th>Калорийность, ккал (кДж)</th></tr></thead>
            <tbody>
              <tr><td colSpan={4}><b>{isDish ? `1 порция (${fx(d.out_g, 0)} грамм) содержит` : `${fx(d.out_g, 0)} г выхода содержат`}</b></td></tr>
              <tr><td>{fx(d.nutrition.total.protein)}</td><td>{fx(d.nutrition.total.fat)}</td><td>{fx(d.nutrition.total.carbs)}</td><td>{fx(d.nutrition.total.kcal)} ({fx(d.nutrition.total.kj, 0)})</td></tr>
              <tr><td colSpan={4}><b>100 грамм блюда (изделия) содержит</b></td></tr>
              <tr><td>{fx(d.nutrition.per100.protein)}</td><td>{fx(d.nutrition.per100.fat)}</td><td>{fx(d.nutrition.per100.carbs)}</td><td>{fx(d.nutrition.per100.kcal)} ({fx(d.nutrition.per100.kj, 0)})</td></tr>
            </tbody>
          </table>
        ) : <p>Не рассчитана — нет данных о пищевой ценности сырья.</p>}
        {d.missing.nutrition.length > 0 && <p className="tu-warn">Расчёт неполный: {d.missing.nutrition.join('; ')}.</p>}

        <table style={{ border: 0, marginTop: 20 }}><tbody>
          <tr><td style={{ border: 0 }}>Ответственный за оформление ТТК</td><td style={{ border: 0, borderBottom: '1px solid #111', width: '30%' }} /></tr>
          <tr><td style={{ border: 0, paddingTop: 14 }}>Заведующий производством (шеф-повар)</td><td style={{ border: 0, borderBottom: '1px solid #111' }} /></tr>
        </tbody></table>
      </article>
    </>
  );
}
