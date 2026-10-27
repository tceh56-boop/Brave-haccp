'use client';
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { dt, n } from '@/lib/fmt';
import { Ingredients, type Prod } from '@/components/IngredientData';
import { MicroPicker } from '@/components/MicroPicker';

/**
 * Технические условия блюда/п/ф: расчёт из утверждённой ТТК (КБЖУ с потерями, физико-химия, рецептура на 100 кг,
 * аллергены), данные сырья по документу, параметры (микробиология, обозначение), утверждение с протоколом испытаний.
 */

type Per = { protein: number; fat: number; carbs: number; kcal: number; kj: number };
export interface TuCalc {
  object: { name: string; kind: string; ttk_version: number; yield_g: number; portion_g: number | null; input_mass_g: number; production_loss_pct: number };
  processing: { mode: string; auto: string; reason: string; by_norms_pct?: number; fallback?: string[] };
  nutrition: { per100: Per | null; per_portion: Per | null; coverage_pct: number; verified_pct: number };
  physico: { indicator: string; calc: number; norm: number | string; method: string }[]; tolerance: number;
  recipe: { name: string; kind: string; netto_g: number | null; per_1kg_g: number | null; per_100kg_kg: number | null }[];
  allergens: { contains: { code: string; label: string; sources: string[] }[]; suggest: { code: string; label: string; sources: string[] }[]; no_profile: string[]; complete: boolean };
  storage: { conditions: string | null; shelf_life: string | null };
  micro: { mode?: string; code: string | null; group: string | null; confirmed: boolean; index: string | null; note: string | null; suggested: { code: string; name: string } | null;
    indicators: { code: string; name: string; method: string; norm: string | null; basis: string | null }[] };
  organoleptic: string; channel: string;
  normative: { code: string; title: string; use: string; state: string }[];
  designation: string; status: string; errors?: string[]; warnings: string[]; generated_at: string;
}
interface Data { params: Record<string, unknown> & { micro?: Record<string, string> }; calc: TuCalc; products: Prod[];
  versions: { version: number; designation: string; lab_protocol: string; approved_at: string; approved_by_name: string; ttk_version: number }[];
  allergen_list: { code: string; label: string }[] }

export default function TuPage({ params }: { params: Promise<{ dishId: string }> }) {
  const { dishId } = use(params);
  const { org, can } = useOrg();
  const [data, setData] = useState<Data | null>(null);
  const { busy, error, run, setError } = useSubmit();
  const load = useCallback(() => api<Data>(`/orgs/${org.id}/dishes/${dishId}/tu`).then(setData).catch((e) => setError(e.message)), [org.id, dishId, setError]);
  useEffect(() => { load(); }, [load]);
  if (!data) return error ? <><p className="small"><Link href={`/app/${org.id}/menu/${dishId}`}>← Карточка</Link></p><div className="err">{error}</div></> : <p className="muted">Загрузка…</p>;
  const c = data.calc, p = c.nutrition.per100, manage = can('ttk.manage');
  const label = (code: string) => data.allergen_list.find((a) => a.code === code)?.label || code;
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/menu/${dishId}`}>← {c.object.name}</Link></p>
      <h1 style={{ marginBottom: 4 }}>Технические условия</h1>
      <p className="row" style={{ marginTop: 0 }}><span className={`badge ${c.status === 'ready' ? 'ok' : c.status === 'error' ? 'crit' : 'warn'}`}>{c.status === 'ready' ? 'Готов к испытаниям' : c.status === 'error' ? 'Ошибка в данных' : 'Проект'}</span><span className="small muted">{c.designation} · по ТТК v{c.object.ttk_version}</span></p>
      <Link className="btn block secondary" href={`/app/${org.id}/menu/${dishId}/tu/print`}>Документ ТУ (печать, PDF)</Link>
      {error && <div className="err" role="alert">{error}</div>}
      {(c.errors || []).length > 0 && <div className="err"><b>Ошибки в данных — ТУ с ними выпускать нельзя:</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{(c.errors || []).map((w) => <li key={w} className="small">{w}</li>)}</ul></div>}
      {c.warnings.length > 0 && <div className="note"><b>Чтобы ТУ стали «готовы к испытаниям»:</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{c.warnings.map((w) => <li key={w} className="small">{w}</li>)}</ul></div>}

      <div className="card">
        <h2>Пищевая и энергетическая ценность</h2>
        {!p ? <p className="muted">Не рассчитано — нет данных пищевой ценности ни по одному сырью.</p> : <div className="scroll"><table className="tbl"><thead><tr><th /><th>Белки, г</th><th>Жиры, г</th><th>Углеводы, г</th><th>ккал / кДж</th></tr></thead>
          <tbody><tr><td>на 100 г</td><td>{n(p.protein)}</td><td>{n(p.fat)}</td><td>{n(p.carbs)}</td><td><b>{p.kcal}</b> / {p.kj}</td></tr>
            {c.nutrition.per_portion && <tr><td>порция {c.object.portion_g} г</td><td>{n(c.nutrition.per_portion.protein)}</td><td>{n(c.nutrition.per_portion.fat)}</td><td>{n(c.nutrition.per_portion.carbs)}</td><td>{c.nutrition.per_portion.kcal} / {c.nutrition.per_portion.kj}</td></tr>}</tbody></table></div>}
        <p className="small muted">{c.processing.by_norms_pct ? `Потери нутриентов — по нормам обработки сырья (${c.processing.by_norms_pct} % массы с данными).` : <>Обработка: {c.processing.mode === 'thermal' ? 'тепловая — типовые потери Б/Ж/У 6/12/9 %' : 'без тепловой обработки'} ({c.processing.mode === c.processing.auto ? c.processing.reason : 'задано вручную'}).</>}
          Данными покрыто {c.nutrition.coverage_pct} % массы сырья, подтверждено документами {c.nutrition.verified_pct} %. Коэффициенты энергии — ТР ТС 022/2011, прил. 4.</p>
      </div>

      <div className="card">
        <h2>Физико-химические показатели</h2>
        {c.physico.length === 0 && <p className="muted">Не рассчитаны — нет данных пищевой ценности.</p>}
        <div className="scroll"><table className="tbl"><thead><tr><th>Показатель</th><th>Норма</th><th>Расчёт</th></tr></thead>
          <tbody>{c.physico.map((x) => <tr key={x.indicator}><td>{x.indicator}</td><td>{typeof x.norm === 'number' ? n(x.norm) : x.norm}</td><td>{n(x.calc)}</td></tr>)}</tbody></table></div>
        <p className="small muted">Допуск {Math.round(c.tolerance * 100)} % от расчётного значения. Значения подтверждаются испытаниями.</p>
      </div>

      <div className="card">
        <h2>Рецептура</h2>
        <p className="small muted">Выход {n(c.object.yield_g)} г, закладка нетто {n(c.object.input_mass_g)} г, потери при производстве {n(c.object.production_loss_pct)} % (ГОСТ 31988-2012).</p>
        <div className="scroll"><table className="tbl"><thead><tr><th>Сырьё</th><th>Нетто, г</th><th>На 1 кг, г</th><th>На 100 кг, кг</th></tr></thead>
          <tbody>{c.recipe.map((r, i) => <tr key={i}><td>{r.name}{r.kind === 'п/ф' && <span className="badge" style={{ marginLeft: 6 }}>п/ф</span>}</td><td>{n(r.netto_g)}</td><td>{n(r.per_1kg_g)}</td><td>{n(r.per_100kg_kg)}</td></tr>)}</tbody></table></div>
      </div>

      <div className="card">
        <h2>Аллергены (ТР ТС 022/2011)</h2>
        {c.allergens.contains.length ? <ul className="list">{c.allergens.contains.map((a) => <li key={a.code}><b>{a.label}</b><div className="small muted">{a.sources.join(', ')}</div></li>)}</ul>
          : <p className="small">{c.allergens.complete ? 'Не содержит — по профилям всех ингредиентов.' : 'Не выявлены, но профиль неполный.'}</p>}
        {!c.allergens.complete && <div className="note small">Нет профиля аллергенов: {c.allergens.no_profile.join(', ')}.{c.allergens.suggest.length > 0 && <> По названию проверьте: {c.allergens.suggest.map((a) => `${a.label} (${a.sources.join(', ')})`).join('; ')}.</>}</div>}
      </div>

      <Ingredients products={data.products} allergenList={data.allergen_list} label={label} manage={manage} onDone={load} />
      {manage && <Params data={data} dishId={dishId} onDone={load} />}

      <div className="card">
        <h2>Утверждённые версии ТУ</h2>
        {data.versions.length === 0 ? <p className="small muted">Ещё не утверждались.</p> : <ul className="list">{data.versions.map((v) => (
          <li key={v.version} className="between"><div><b>Версия {v.version}</b> · {v.designation}<div className="small muted">{v.approved_by_name}, {dt(v.approved_at, org.timezone)} · по ТТК v{v.ttk_version} · {v.lab_protocol}</div></div>
            <Link className="small" href={`/app/${org.id}/menu/${dishId}/tu/print?v=${v.version}`}>документ</Link></li>))}</ul>}
        {can('ttk.approve') && <Approve ready={c.status === 'ready'} busy={busy} onApprove={(labProtocol) => run(async () => { await api(`/orgs/${org.id}/dishes/${dishId}/tu/approve`, { body: { labProtocol } }); await load(); })} />}
      </div>
    </>
  );
}

function Approve({ ready, busy, onApprove }: { ready: boolean; busy: boolean; onApprove: (p: string) => void }) {
  const [p, setP] = useState('');
  if (!ready) return <p className="small muted">Утвердить можно, когда расчёт полный и подтверждён документами (статус «Готов к испытаниям»), и есть протокол испытаний аккредитованной лаборатории.</p>;
  return (
    <form onSubmit={(e) => { e.preventDefault(); onApprove(p); }}>
      <label htmlFor="lp">Протокол испытаний аккредитованной лаборатории</label>
      <input id="lp" required value={p} onChange={(e) => setP(e.target.value)} placeholder="Протокол № 15 от 20.10.2026, ИЛЦ «…»" />
      <button className="btn block" disabled={busy}>Утвердить ТУ</button>
    </form>
  );
}

function Params({ data, dishId, onDone }: { data: Data; dishId: string; onDone: () => void }) {
  const { org } = useOrg();
  const p = data.params;
  const s = (k: string) => (p[k] === null || p[k] === undefined ? '' : String(p[k]));
  const [f, setF] = useState({ processing: s('processing'), tolerance: p.tolerance != null ? String(Math.round(Number(p.tolerance) * 100)) : '10', organoleptic: s('organoleptic'),
    channel: s('channel'), okpd2: s('okpd2'), seq: s('seq'), okpo: s('okpo'), micro: { ...(p.micro || {}) } as Record<string, string> });
  const [mv, setMv] = useState({ microGroupCode: s('microGroupCode'), micro: { ...(p.micro || {}) } as Record<string, string>, microIndex: s('microIndex') });
  const { busy, error, run } = useSubmit();
  const [saved, setSaved] = useState(false);
  return (
    <div className="card">
      <h2>Параметры ТУ</h2>
      <form onSubmit={(e) => { e.preventDefault(); run(async () => {
        await api(`/orgs/${org.id}/dishes/${dishId}/tu`, { method: 'PUT', body: { ...f, processing: f.processing || null, tolerance: Number(f.tolerance.replace(',', '.')) / 100,
          microGroupCode: mv.microGroupCode || null, micro: mv.microGroupCode === 'custom' ? mv.micro : {}, microIndex: mv.microGroupCode === 'custom' ? mv.microIndex || null : null,
          organoleptic: f.organoleptic || null, channel: f.channel || null } }); setSaved(true); onDone();
      }); }}>
        <div className="grid2">
          <div><label htmlFor="tp">Обработка</label><select id="tp" value={f.processing} onChange={(e) => setF({ ...f, processing: e.target.value })}>
            <option value="">по технологии ТТК (сейчас: {data.calc.processing.auto === 'thermal' ? 'тепловая' : 'без нагрева'})</option><option value="thermal">тепловая</option><option value="raw">без тепловой обработки</option></select></div>
          <div><label htmlFor="tt">Допуск физико-химии, %</label><input id="tt" inputMode="decimal" value={f.tolerance} onChange={(e) => setF({ ...f, tolerance: e.target.value })} /></div>
          <div><label htmlFor="to">ОКПД2 продукции</label><input id="to" value={f.okpd2} onChange={(e) => setF({ ...f, okpd2: e.target.value })} placeholder="10.85.19" /></div>
          <div><label htmlFor="tk">ОКПО предприятия</label><input id="tk" inputMode="numeric" value={f.okpo} onChange={(e) => setF({ ...f, okpo: e.target.value })} /></div>
          <div><label htmlFor="ts">Порядковый номер ТУ</label><input id="ts" inputMode="numeric" value={f.seq} onChange={(e) => setF({ ...f, seq: e.target.value })} placeholder="001" /></div>
        </div>
        <label htmlFor="tc">Реализация</label><input id="tc" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })} placeholder={data.calc.channel} />
        <label htmlFor="tl">Органолептические показатели</label><textarea id="tl" rows={2} value={f.organoleptic} onChange={(e) => setF({ ...f, organoleptic: e.target.value })} placeholder={data.calc.organoleptic} />
        <h3 style={{ marginTop: 12 }}>Микробиологические нормативы (ТР ТС 021/2011)</h3>
        <MicroPicker value={mv} onChange={setMv} dishName={data.calc.object.name} />
        {error && <div className="err">{error}</div>}
        {saved && !error && <div className="okbox">Сохранено, расчёт обновлён.</div>}
        <button className="btn block secondary" disabled={busy}>Сохранить параметры</button>
      </form>
    </div>
  );
}
