'use client';
import { Suspense, use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { Ingredients, type Prod } from '@/components/IngredientData';
import { fx, type TtkDoc } from '@/lib/ttkdoc';

type Data = TtkDoc & { products: Prod[]; allergen_list: { code: string; label: string }[] };

/**
 * Документы ТТК (ГОСТ 31987-2012): технико-технологическая карта и обоснование расчётов. Здесь — что нормируется
 * для блюда и чем (коэффициенты из Методических указаний по лабораторному контролю, 1997 — вводит технолог),
 * микробиология, данные сырья по документу. Без данных показатель «не рассчитан», а не ноль.
 */
export default function TtkDocsPage({ params }: { params: Promise<{ dishId: string }> }) {
  return <Suspense fallback={<p className="muted">Загрузка…</p>}><View params={params} /></Suspense>;
}

function View({ params }: { params: Promise<{ dishId: string }> }) {
  const { dishId } = use(params);
  const v = useSearchParams().get('v');
  const { org, can } = useOrg();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api<Data>(`/orgs/${org.id}/dishes/${dishId}/ttk-doc${v ? `?versionId=${v}` : ''}`).then(setD).catch((e) => setErr(e.message)), [org.id, dishId, v]);
  useEffect(() => { load(); }, [load]);
  if (err) return <div className="err">{err}</div>;
  if (!d) return <p className="muted">Загрузка…</p>;
  const q = `?v=${d.version.id}`;
  const ph = d.physico;
  const show = (name: string, x: { normed: boolean; missing?: string[] }, value: string) => (
    <li>{name}: {!x.normed ? <span className="muted">не определяется для блюда</span> : x.missing && x.missing.length ? <span className="badge warn">не рассчитано: {x.missing.join('; ')}</span> : <b>{value}</b>}</li>);
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/menu/${dishId}`}>← {d.dish.name}</Link></p>
      <h1>Документы ТТК</h1>
      <p className="small muted">Рецептура № {d.dish.card_no || '—'}, версия {d.version.version} ({d.version.status === 'approved' ? 'утверждена' : d.version.status === 'archived' ? 'архив' : 'проект'}). Расчёт {d.out_label}.</p>
      <div className="tiles">
        <Link className="tile" href={`/app/${org.id}/menu/${dishId}/ttk-docs/print${q}`}>Технико-технологическая карта<span className="sub">ГОСТ 31987-2012</span></Link>
        <Link className="tile" href={`/app/${org.id}/menu/${dishId}/ttk-docs/basis${q}`}>Обоснование расчётов<span className="sub">пищевая ценность и физхимия</span></Link>
      </div>
      <div className="card">
        <h2>Расчёт</h2>
        {d.nutrition ? <p>На 100 г: Б {fx(d.nutrition.per100.protein)} · Ж {fx(d.nutrition.per100.fat)} · У {fx(d.nutrition.per100.carbs)} · <b>{fx(d.nutrition.per100.kcal)} ккал</b></p> : <p className="muted">Пищевая ценность не рассчитана — нет данных ни по одному ингредиенту.</p>}
        {d.missing.nutrition.length > 0 && <div className="note small">Неполные данные: {d.missing.nutrition.join('; ')}.</div>}
        <ul className="small" style={{ paddingLeft: 18 }}>
          {show('Сухие вещества', ph.dry, ph.dry.normed ? `${fx((ph.dry as { min: number }).min)}–${fx((ph.dry as { max: number }).max)} %` : '')}
          {show('Жир', ph.fat, ph.fat.normed ? `${fx((ph.fat as { min: number }).min)}–${fx((ph.fat as { max: number }).max)} %` : '')}
          {show('Сахар', ph.sugar, ph.sugar.normed ? `${fx((ph.sugar as { value: number }).value)} %` : '')}
          {show('Соль', ph.salt, ph.salt.normed ? `не более ${fx((ph.salt as { value: number }).value)} %` : '')}
        </ul>
      </div>
      {can('ttk.manage') && <QualityParams d={d} dishId={dishId} onDone={load} />}
      <Ingredients products={d.products} allergenList={d.allergen_list} label={(c) => d.allergen_list.find((a) => a.code === c)?.label || c} manage={can('ttk.manage')} onDone={load} />
    </>
  );
}

function QualityParams({ d, dishId, onDone }: { d: Data; dishId: string; onDone: () => void }) {
  const { org } = useOrg();
  // в форме — только своё значение блюда; унаследованное от папки — серой подсказкой
  const own = (d.own_params || {}) as typeof d.params, inh = d.inherited || {};
  const p = { ...own, physNormed: own.physNormed || {}, micro: own.micro || {} };
  const s = (v: number | string | null | undefined) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
  const ph = (k: string, v: unknown, dflt = '') => (inh[k] && v !== null && v !== undefined ? `из папки «${inh[k]}»: ${s(v as string)}` : dflt);
  const [f, setF] = useState({ dry: !!p.physNormed.dry, fat: !!p.physNormed.fat, sugar: !!p.physNormed.sugar, salt: !!p.physNormed.salt,
    gerberPct: s(p.gerberPct), saltMaxPct: s(p.saltMaxPct), dryCoef: s(p.dryCoef), sugarCoef: s(p.sugarCoef), physBasis: p.physBasis || '', microIndex: p.microIndex || '', microNote: p.microNote || '',
    micro: { ...p.micro } as Record<string, string> });
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useSubmit();
  const num = (x: string) => (x.trim() ? Number(x.replace(',', '.')) : null);
  const box = (k: 'dry' | 'fat' | 'sugar' | 'salt', label: string) => (
    <label className="row" style={{ fontWeight: 400 }}><input type="checkbox" style={{ width: 22, minHeight: 22 }} checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} /> <span style={{ flex: 1 }}>{label}</span></label>);
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => {
      await api(`/orgs/${org.id}/dishes/${dishId}/tu`, { method: 'PUT', body: { physNormed: f.dry || f.fat || f.sugar || f.salt || own.physNormed ? { dry: f.dry, fat: f.fat, sugar: f.sugar, salt: f.salt } : null, gerberPct: num(f.gerberPct), saltMaxPct: num(f.saltMaxPct),
        dryCoef: num(f.dryCoef), sugarCoef: num(f.sugarCoef), physBasis: f.physBasis || null, microIndex: f.microIndex || null, microNote: f.microNote || null, micro: f.micro } });
      setSaved(true); onDone();
    }); }}>
      <h2>Показатели качества и безопасности</h2>
      <p className="small muted">Что нормируется для этой группы блюд — по приложению 2 Методических указаний по лабораторному контролю качества продукции общественного питания (1997);
        коэффициенты и предельные значения вводит технолог по этому документу. Система их не подставляет.</p>
      <h3>Нормируемые физико-химические показатели</h3>
      {inh.physNormed && !own.physNormed && <p className="small muted">Сейчас — по правилам папки «{inh.physNormed}». Отметки ниже заменят их для этого блюда.</p>}
      {box('dry', 'Массовая доля сухих веществ')}{box('fat', 'Массовая доля жира')}{box('sugar', 'Массовая доля сахара')}{box('salt', 'Массовая доля поваренной соли')}
      <div className="grid2">
        <div><label htmlFor="qg">Жир по Герберу, % (табл. 8 МУ)</label><input id="qg" inputMode="decimal" value={f.gerberPct} onChange={(e) => setF({ ...f, gerberPct: e.target.value })} placeholder={ph('gerberPct', d.params.gerberPct)} /></div>
        <div><label htmlFor="qs">Соль, макс. содержание в блюде, %</label><input id="qs" inputMode="decimal" value={f.saltMaxPct} onChange={(e) => setF({ ...f, saltMaxPct: e.target.value })} placeholder={ph('saltMaxPct', d.params.saltMaxPct)} /></div>
        <div><label htmlFor="qd">Коэффициент сухих веществ</label><input id="qd" inputMode="decimal" value={f.dryCoef} onChange={(e) => setF({ ...f, dryCoef: e.target.value })} placeholder={ph('dryCoef', d.params.dryCoef, 'первые блюда и соусы 0,85; остальные 0,9')} /></div>
        <div><label htmlFor="qu">Коэффициент потерь сахарозы</label><input id="qu" inputMode="decimal" value={f.sugarCoef} onChange={(e) => setF({ ...f, sugarCoef: e.target.value })} placeholder={ph('sugarCoef', d.params.sugarCoef)} /></div>
      </div>
      <label htmlFor="qb">Основание</label><input id="qb" value={f.physBasis} onChange={(e) => setF({ ...f, physBasis: e.target.value })} placeholder={ph('physBasis', d.params.physBasis, 'МУ по лабораторному контролю, 1997 (письмо № 1-40/3805), прил. 2, табл. 8')} />
      <h3 style={{ marginTop: 12 }}>Микробиологические показатели</h3>
      <label htmlFor="qmi">Документ и группа (индекс)</label><input id="qmi" value={f.microIndex} onChange={(e) => setF({ ...f, microIndex: e.target.value })} placeholder={ph('microIndex', d.params.microIndex, 'ТР ТС 021/2011, прил. 1, п. …')} />
      {d.micro.map((m) => (
        <div key={m.code}><label htmlFor={`qm-${m.code}`}>{m.name}</label>
          <input id={`qm-${m.code}`} value={f.micro[m.code] || ''} onChange={(e) => setF({ ...f, micro: { ...f.micro, [m.code]: e.target.value } })} placeholder={ph(`micro.${m.code}`, d.params.micro[m.code], 'значение из регламента или «не нормируется»')} /></div>))}
      <label htmlFor="qmn">Примечание</label><input id="qmn" value={f.microNote} onChange={(e) => setF({ ...f, microNote: e.target.value })} placeholder="например, плесени — не более 50 КОЕ/г" />
      {error && <div className="err">{error}</div>}
      {saved && !error && <div className="okbox">Сохранено. Микробиология общая с ТУ.</div>}
      <button className="btn block secondary" disabled={busy}>Сохранить показатели</button>
    </form>
  );
}
