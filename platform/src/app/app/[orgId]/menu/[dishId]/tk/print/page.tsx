'use client';
import { Suspense, use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useOrg } from '@/lib/org';
import { api } from '@/lib/api';
import { fx, orgTitle, type TtkDoc } from '@/lib/ttkdoc';

/**
 * Технологическая карта (ТК) по ГОСТ 31987-2012, п. 5.1 и приложение А: рецептура брутто/нетто/масса готового продукта
 * на 1 порцию и на N порций, выход на 1 порцию и на 1 кг, технологический процесс, оформление и подача, условия и сроки
 * реализации, пищевая ценность, подписи. Оформляется на продукцию по сборникам рецептур; ТТК (п. 5.3) — на новую продукцию.
 */
export default function TkPrintPage({ params }: { params: Promise<{ dishId: string }> }) {
  return <Suspense fallback={<p className="muted">Загрузка…</p>}><Doc params={params} /></Suspense>;
}

function Doc({ params }: { params: Promise<{ dishId: string }> }) {
  const { dishId } = use(params);
  const sp = useSearchParams();
  const v = sp.get('v');
  const [n, setN] = useState(Number(sp.get('n')) || 10);
  const { org } = useOrg();
  const [d, setD] = useState<TtkDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<TtkDoc>(`/orgs/${org.id}/dishes/${dishId}/ttk-doc${v ? `?versionId=${v}` : ''}`).then(setD).catch((e) => setErr(e.message)); }, [org.id, dishId, v]);
  if (err) return <div className="err">{err}</div>;
  if (!d) return <p className="muted">Загрузка…</p>;
  const ver = d.version, isDish = d.dish.kind === 'dish';
  const project = ver.status !== 'approved' && ver.status !== 'archived';
  const items = d.lines.filter((l) => l.kind === 'item');
  const kg = d.out_g > 0 ? 1000 / d.out_g : null;   // множитель «на 1 кг выхода»
  const tech = [ver.technology, ver.serving && `Оформление и подача: ${ver.serving}`, `Условия хранения: ${ver.storage_conditions || '—'}. Срок годности (реализации): ${ver.shelf_life || '—'}.`].filter(Boolean).join('\n\n');
  return (
    <>
      <div className="noprint">
        <p className="small"><Link href={`/app/${org.id}/menu/${dishId}/ttk-docs${v ? `?v=${v}` : ''}`}>← Документы ТТК</Link></p>
        <label htmlFor="tn">Масса на … порций</label>
        <input id="tn" inputMode="numeric" value={n} onChange={(e) => setN(Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1))} style={{ maxWidth: 120 }} />
        <button className="btn block" onClick={() => window.print()}>Печать / сохранить PDF</button>
        <p className="small muted">Технологическая карта оформляется на продукцию по сборникам рецептур (ГОСТ 31987-2012, п. 5.1); на новую продукцию — технико-технологическая карта (п. 5.3).</p>
        {project && <p className="small muted">Версия рецептуры не утверждена — документ с отметкой «ПРОЕКТ».</p>}
      </div>
      <article className="tu-doc">
        <div style={{ borderBottom: '1px solid #111' }}>{orgTitle(d.org)}{d.sites.length ? `, ${d.sites.join(', ')}` : ''}</div>
        <div className="tu-small">наименование организации и предприятия</div>
        <p>Источник рецептуры: {ver.source || '—'}</p>
        <h1>Технологическая карта № {d.dish.card_no || '___'}{project && <> <span className="tu-stamp">ПРОЕКТ</span></>}</h1>
        <p className="tu-center">Наименование блюда (изделия): <b>{d.dish.name}</b></p>
        <table>
          <thead><tr><th>Наименование сырья, пищевых продуктов</th><th>Масса брутто, г</th><th>Масса нетто или полуфабриката, г</th><th>Масса готового продукта, г</th>
            <th>Масса брутто на {n} порций, кг</th><th style={{ width: '32%' }}>Технологический процесс изготовления, оформления и подачи блюда (изделия), условия и сроки реализации</th></tr></thead>
          <tbody>
            {items.map((l, i) => (
              <tr key={i}><td>{l.name}{!l.in_yield && <div className="tu-small">в выход не входит</div>}</td><td style={{ textAlign: 'right' }}>{fx(l.brutto_g, 1)}</td><td style={{ textAlign: 'right' }}>{fx(l.netto_g, 1)}</td>
                <td style={{ textAlign: 'right' }}>{l.in_yield ? fx(l.ready_g, 1) : '—'}</td><td style={{ textAlign: 'right' }}>{fx(l.brutto_g === null ? null : l.brutto_g * n / 1000, 3)}</td>
                {i === 0 && <td rowSpan={items.length + 2} style={{ whiteSpace: 'pre-line', verticalAlign: 'top' }}>{tech}</td>}</tr>))}
            <tr><td><b>ВЫХОД на 1 порцию</b></td><td colSpan={2} /><td style={{ textAlign: 'right' }}><b>{isDish ? fx(d.out_g, 0) : '—'}</b></td><td style={{ textAlign: 'right' }}>{isDish ? fx(d.out_g * n / 1000, 3) : '—'}</td></tr>
            <tr><td><b>ВЫХОД на 1 кг</b></td><td colSpan={2} /><td style={{ textAlign: 'right' }}><b>1000</b></td><td className="tu-small">{kg && isDish ? `≈ ${fx(kg, 1)} порц.` : ''}</td></tr>
          </tbody>
        </table>
        <p>Информация о пищевой ценности{isDish ? ' (1 порция)' : ` (на ${fx(d.out_g, 0)} г)`}: {d.nutrition
          ? <>белки — {fx(d.nutrition.total.protein)} г, жиры — {fx(d.nutrition.total.fat)} г, углеводы — {fx(d.nutrition.total.carbs)} г, калорийность — {fx(d.nutrition.total.kcal)} ккал</>
          : 'не рассчитана — нет данных о пищевой ценности сырья'}.{d.missing.nutrition.length > 0 && <span className="tu-warn noprint"> Расчёт неполный: {d.missing.nutrition.join('; ')}.</span>}</p>
        <table style={{ border: 0, marginTop: 16 }}><tbody>
          <tr><td style={{ border: 0 }}>Зав. производством (шеф-повар, старший повар)</td><td style={{ border: 0, borderBottom: '1px solid #111', width: '35%' }} /></tr>
          <tr><td style={{ border: 0, paddingTop: 14 }}>Калькулятор, технолог</td><td style={{ border: 0, borderBottom: '1px solid #111' }} /></tr>
        </tbody></table>
      </article>
    </>
  );
}
