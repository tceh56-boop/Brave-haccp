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
  title?: { holder: string; okpd2: string | null; oks: string | null; replaces: string | null; intro_date: string | null; developer: string | null; location: string | null; purpose: string };
  raw?: { name: string; doc: string | null }[]; ppk?: { version: number; d: string } | null; organoleptic_table?: Record<string, string | null>; packaging?: string | null;
  designation: string; status: string; errors?: string[]; warnings: string[]; generated_at: string;
}
interface Data { params: Record<string, unknown> & { micro?: Record<string, string> }; calc: TuCalc; products: Prod[];
  versions: { version: number; designation: string; lab_protocol: string; approved_at: string; approved_by_name: string; ttk_version: number; outdated: boolean; change_note: string | null; ppk_version: number | null; haccp_version: number | null }[];
  protocols: Protocol[];
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
        <p className="small muted">{c.processing.by_norms_pct ? `Потери нутриентов — по нормам обработки сырья (${c.processing.by_norms_pct} % массы с данными).` : <>Обработка: {c.processing.mode === 'thermal' ? 'тепловая — потери пищевых веществ не учтены: нет норм обработки с основанием' : 'без тепловой обработки'} ({c.processing.mode === c.processing.auto ? c.processing.reason : 'задано вручную'}).</>}
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
        {data.versions[0]?.outdated && <div className="err">Действующая версия ТУ построена на ТТК v{data.versions[0].ttk_version}, которая больше не действует, — ТУ устарели, нужен пересмотр.</div>}
        {data.versions.length === 0 ? <p className="small muted">Ещё не утверждались.</p> : <>
          <h3>Лист регистрации изменений</h3>
          <div className="scroll"><table className="tbl small"><thead><tr><th>Версия</th><th>Изменение</th><th>ТТК</th><th>Протоколы</th><th>ППК / ХАССП</th><th>Утвердил</th><th /></tr></thead>
            <tbody>{data.versions.map((v) => (
              <tr key={v.version}><td>{v.version}{v.outdated && <span className="badge crit" style={{ marginLeft: 4 }}>устарела</span>}<div className="muted">{v.designation}</div></td><td>{v.change_note || '—'}</td><td>v{v.ttk_version}</td><td>{v.lab_protocol}</td>
                <td>{v.ppk_version ? `ППК v${v.ppk_version}` : 'ППК не утверждена'} / {v.haccp_version ? `ХАССП v${v.haccp_version}` : 'план ХАССП не утверждён'}</td>
                <td>{v.approved_by_name}<div className="muted">{dt(v.approved_at, org.timezone)}</div></td><td><Link href={`/app/${org.id}/menu/${dishId}/tu/print?v=${v.version}`}>документ</Link></td></tr>))}</tbody></table></div></>}
        {can('ttk.approve') && <Approve ready={c.status === 'ready'} busy={busy} protocols={data.protocols} first={data.versions.length === 0}
          onApprove={(labResultIds, changeNote) => run(async () => { await api(`/orgs/${org.id}/dishes/${dishId}/tu/approve`, { body: { labResultIds, changeNote: changeNote || null } }); await load(); })} />}
      </div>
    </>
  );
}

interface Protocol { id: string; protocol_no: string; result_on: string; result: string; lab: string | null; accreditation_no: string | null; lab_status: string | null; lot_no: string | null; sample_ref: string | null;
  test_type: string; params: { name: string; norm: string; fact: string; unit?: string | null; pass: boolean }[] }
function Approve({ ready, busy, protocols, first, onApprove }: { ready: boolean; busy: boolean; protocols: Protocol[]; first: boolean; onApprove: (ids: string[], note: string) => void }) {
  const { org } = useOrg();
  const [ids, setIds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  if (!ready) return <p className="small muted">Утвердить можно, когда расчёт полный и подтверждён документами (статус «Готов к испытаниям»), и есть протоколы испытаний аккредитованной лаборатории.</p>;
  return (
    <form onSubmit={(e) => { e.preventDefault(); onApprove(ids, note); }}>
      <h3>Протоколы испытаний</h3>
      {protocols.length === 0 && <p className="small muted">Протоколов с образцом этого блюда или его партии нет. Внесите их в разделе <Link href={`/app/${org.id}/lab?tab=lab`}>«Лаборатория»</Link>: лаборатория из реестра, образец — блюдо или партия, показатели с фактическими значениями, скан протокола.</p>}
      {protocols.map((p) => (
        <label key={p.id} className="check" style={{ alignItems: 'flex-start' }}>
          <input type="checkbox" checked={ids.includes(p.id)} onChange={(e) => setIds(e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id))} />
          <span><b>№ {p.protocol_no}</b> от {p.result_on.split('-').reverse().join('.')} · {p.lab ? `${p.lab}, аттестат ${p.accreditation_no}` : <span style={{ color: 'var(--crit)' }}>лаборатория не из реестра</span>}
            {p.lot_no ? ` · партия ${p.lot_no}` : ''}{p.sample_ref ? ` · образец ${p.sample_ref}` : ''} · {p.result === 'pass' ? 'соответствует' : 'не соответствует'}
            <span className="small muted" style={{ display: 'block' }}>{p.params.map((x) => `${x.name}: ${x.fact}${x.unit ? ` ${x.unit}` : ''} (норма ${x.norm})`).join('; ') || 'нет показателей'}</span></span>
        </label>))}
      {!first && <><label htmlFor="cn">Содержание изменения (лист регистрации изменений)</label><input id="cn" value={note} onChange={(e) => setNote(e.target.value)} placeholder="что изменено и почему" /></>}
      <button className="btn block" disabled={busy || !ids.length}>Утвердить ТУ</button>
      <p className="small muted">Проверяется: лаборатория из реестра и действует, файл протокола приложен, образец — это блюдо или его партия, каждый нормируемый показатель ТУ исследован. В версии фиксируются версии ППК и плана ХАССП на дату утверждения.</p>
    </form>
  );
}

function Params({ data, dishId, onDone }: { data: Data; dishId: string; onDone: () => void }) {
  const { org } = useOrg();
  const p = data.params;
  const s = (k: string) => (p[k] === null || p[k] === undefined ? '' : String(p[k]));
  const [f, setF] = useState({ processing: s('processing'), tolerance: p.tolerance != null ? String(Math.round(Number(p.tolerance) * 100)) : '10', organoleptic: s('organoleptic'),
    channel: s('channel'), okpd2: s('okpd2'), seq: s('seq'), okpo: s('okpo'),
    tuPurpose: s('tuPurpose'), tuOks: s('tuOks'), tuReplaces: s('tuReplaces'), tuIntroDate: s('tuIntroDate'), tuDeveloper: s('tuDeveloper'), tuLocation: s('tuLocation'), micro: { ...(p.micro || {}) } as Record<string, string> });
  const [mv, setMv] = useState({ microGroupCode: s('microGroupCode'), micro: { ...(p.micro || {}) } as Record<string, string>, microIndex: s('microIndex') });
  const { busy, error, run } = useSubmit();
  const [saved, setSaved] = useState(false);
  return (
    <div className="card">
      <h2>Параметры ТУ</h2>
      <form onSubmit={(e) => { e.preventDefault(); run(async () => {
        await api(`/orgs/${org.id}/dishes/${dishId}/tu`, { method: 'PUT', body: { ...f, processing: f.processing || null, tolerance: Number(f.tolerance.replace(',', '.')) / 100,
          microGroupCode: mv.microGroupCode || null, micro: mv.microGroupCode === 'custom' ? mv.micro : {}, microIndex: mv.microGroupCode === 'custom' ? mv.microIndex || null : null,
          organoleptic: f.organoleptic || null, channel: f.channel || null, tuPurpose: f.tuPurpose || null, tuOks: f.tuOks || null, tuReplaces: f.tuReplaces || null,
          tuIntroDate: f.tuIntroDate || null, tuDeveloper: f.tuDeveloper || null, tuLocation: f.tuLocation || null } }); setSaved(true); onDone();
      }); }}>
        <div className="grid2">
          <div><label htmlFor="tp">Обработка</label><select id="tp" value={f.processing} onChange={(e) => setF({ ...f, processing: e.target.value })}>
            <option value="">по технологии ТТК (сейчас: {data.calc.processing.auto === 'thermal' ? 'тепловая' : 'без нагрева'})</option><option value="thermal">тепловая</option><option value="raw">без тепловой обработки</option></select></div>
          <div><label htmlFor="tt">Допуск физико-химии, %</label><input id="tt" inputMode="decimal" value={f.tolerance} onChange={(e) => setF({ ...f, tolerance: e.target.value })} /></div>
          <div><label htmlFor="to">ОКПД2 продукции</label><input id="to" value={f.okpd2} onChange={(e) => setF({ ...f, okpd2: e.target.value })} placeholder="10.85.19.110 (9 знаков, ГОСТ Р 51740, 4.2.8)" /></div>
          <div><label htmlFor="tk">ОКПО предприятия</label><input id="tk" inputMode="numeric" value={f.okpo} onChange={(e) => setF({ ...f, okpo: e.target.value })} /></div>
          <div><label htmlFor="ts">Порядковый номер ТУ</label><input id="ts" inputMode="numeric" value={f.seq} onChange={(e) => setF({ ...f, seq: e.target.value })} placeholder="001" /></div>
        </div>
        <h3 style={{ marginTop: 12 }}>Титульный лист (ГОСТ Р 51740-2016, приложение А)</h3>
        <div className="grid2">
          <div><label htmlFor="tx">ОКС (и КГС в скобках)</label><input id="tx" value={f.tuOks} onChange={(e) => setF({ ...f, tuOks: e.target.value })} placeholder="67.020 (Н90)" /></div>
          <div><label htmlFor="tr">Взамен ТУ (если заменяют)</label><input id="tr" value={f.tuReplaces} onChange={(e) => setF({ ...f, tuReplaces: e.target.value })} placeholder="пусто — «утверждены впервые»" /></div>
          <div><label htmlFor="td">Дата введения в действие</label><input id="td" type="date" value={f.tuIntroDate} onChange={(e) => setF({ ...f, tuIntroDate: e.target.value })} /></div>
          <div><label htmlFor="tw">Местонахождение держателя подлинника</label><input id="tw" value={f.tuLocation} onChange={(e) => setF({ ...f, tuLocation: e.target.value })} placeholder={data.calc.title?.location || 'Тульская обл., г. Тула'} /></div>
        </div>
        <label htmlFor="tv">Разработчик (по решению держателя)</label><input id="tv" value={f.tuDeveloper} onChange={(e) => setF({ ...f, tuDeveloper: e.target.value })} />
        <label htmlFor="tpu">Назначение продукта (ГОСТ Р 51740, 5.1.2)</label><input id="tpu" value={f.tuPurpose} onChange={(e) => setF({ ...f, tuPurpose: e.target.value })} placeholder={data.calc.title?.purpose} />
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
