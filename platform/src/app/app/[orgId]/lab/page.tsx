'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useOrg } from '@/lib/org';
import { SitePicker } from '@/components/OrgNav';
import { InstrumentPicker } from '@/components/InstrumentPicker';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { dt, n } from '@/lib/fmt';
import { WATER_MICRO, WORK_CATEGORIES, microclimate } from '@/lib/hygieneNorms';

/** Суточные пробы (отбор, хранение, уничтожение по сроку) и лабораторный контроль (программа, результаты по протоколам). */

interface Settings { min_weight_g: number; retention_hours: number; t_min: number; t_max: number; basis: string; confirmed: boolean; updated_by?: string }
interface Missing { event_id: string; number: number; title: string; event_date: string; dish_id: string; dish: string }
interface Sample { id: string; source_label: string; title: string; weight_g: number | null; whole_portion: boolean; container: string; storage_place: string; temperature: number;
  taken_at: string; keep_until: string; taken_by: string; status: string; destroyed_at: string | null; destroyed_by: string | null }
interface Samples { settings: Settings; missing: Missing[]; stored: Sample[]; destroyed: Sample[] }
interface Program { id: string; test_type: string; target: string; period_days: number; retest_days: number | null; next_due: string; basis: string; overdue: boolean;
  last: { result: string; result_on: string; protocol_no: string } | null }
interface Result { id: string; test_type: string; target: string; lab_name: string; protocol_no: string; sampled_on: string; result_on: string; result: string; incident_id: string | null; files: number; params: number }
interface Obj { id: string; name: string }
interface Dish { id: string; name: string; kind: string }
interface Lot { id: string; lot_no: string | null; product: string; status: string }
const ddmm = (s: string) => s.slice(0, 10).split('-').reverse().join('.');
const num = (s: string) => s.trim().replace(',', '.');
const today = () => new Date().toLocaleDateString('sv-SE');

function SamplesTab() {
  const { org, siteId, can } = useOrg();
  const pre = useSearchParams().get('event');
  const [x, setX] = useState<Samples | null>(null);
  const [objects, setObjects] = useState<Obj[]>([]);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [f, setF] = useState({ source: 'event', key: '', dishId: '', lotId: '', weight: '', whole: false, container: 'стерильная ёмкость с крышкой, маркировка', objectId: '', place: '', temp: '', instrumentId: '' });
  const [cfg, setCfg] = useState<{ minWeightG: string; retentionHours: string; tMin: string; tMax: string; basis: string } | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const { busy, error, run, setError } = useSubmit();
  const load = useCallback(() => { if (siteId) api<Samples>(`/orgs/${org.id}/samples?siteId=${siteId}`).then(setX).catch((e) => setError(e.message)); }, [org.id, siteId, setError]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!siteId) return;
    api<Obj[]>(`/orgs/${org.id}/sites/${siteId}/objects`).then(setObjects).catch(() => setObjects([]));
    api<Dish[]>(`/orgs/${org.id}/dishes`).then((l) => setDishes(l.filter((d) => d.kind === 'dish'))).catch(() => setDishes([]));
    api<Lot[]>(`/orgs/${org.id}/sites/${siteId}/lots`).then((l) => setLots(l.filter((t) => t.lot_no?.startsWith('ПФ-') && t.status !== 'blocked'))).catch(() => setLots([]));
  }, [org.id, siteId]);
  useEffect(() => { if (pre && x) { const m = x.missing.find((y) => y.event_id === pre); if (m) setF((v) => (v.key ? v : { ...v, source: 'event', key: `${m.event_id}:${m.dish_id}` })); } }, [pre, x]);
  if (!x) return error ? <div className="err">{error}</div> : <p className="muted">Загрузка…</p>;
  const s = x.settings;
  const take = () => run(async () => {
    const [eventId, dishId] = f.key.split(':');
    const body = { siteId, source: f.source, eventId: f.source === 'event' ? eventId : null, dishId: f.source === 'event' ? dishId : f.source === 'dish' ? f.dishId : null, lotId: f.source === 'lot' ? f.lotId : null,
      weightG: f.whole ? null : num(f.weight), wholePortion: f.whole, container: f.container, storageObjectId: f.objectId || null, storagePlace: f.place || null, temperature: num(f.temp), instrumentId: f.instrumentId || null };
    const r = await api<{ title: string; keep_until: string }>(`/orgs/${org.id}/samples`, { body });
    setOk(`Проба отобрана: ${r.title}. Хранить до ${dt(r.keep_until, org.timezone)}.`);
    setF({ ...f, key: '', dishId: '', lotId: '', weight: '' }); load();
  });
  return (
    <>
      <div className="card">
        <h2>Параметры проб</h2>
        <p className="small">не менее {n(s.min_weight_g)} г · хранение {n(s.retention_hours)} ч · {n(s.t_min)}…{n(s.t_max)} °C</p>
        <p className="small muted">Основание: {s.basis}{s.updated_by ? ` · утвердил(а) ${s.updated_by}` : ''}</p>
        {!s.confirmed && <p className="small"><span className="badge warn">не утверждено</span> Значения по умолчанию — ответственный ХАССП проверяет по нормативному реестру и утверждает.</p>}
        {can('lab.manage') && !cfg && <button className="btn secondary small" onClick={() => setCfg({ minWeightG: String(s.min_weight_g), retentionHours: String(s.retention_hours), tMin: String(s.t_min), tMax: String(s.t_max), basis: s.confirmed ? s.basis : '' })}>Изменить / утвердить</button>}
        {cfg && (
          <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/orgs/${org.id}/samples/settings`, { body: { minWeightG: num(cfg.minWeightG), retentionHours: num(cfg.retentionHours), tMin: num(cfg.tMin), tMax: num(cfg.tMax), basis: cfg.basis } }); setCfg(null); load(); }); }}>
            <div className="grid2">
              <div><label htmlFor="cw">Масса, г, не менее</label><input id="cw" inputMode="decimal" value={cfg.minWeightG} onChange={(e) => setCfg({ ...cfg, minWeightG: e.target.value })} /></div>
              <div><label htmlFor="ch">Хранить, ч</label><input id="ch" inputMode="decimal" value={cfg.retentionHours} onChange={(e) => setCfg({ ...cfg, retentionHours: e.target.value })} /></div>
              <div><label htmlFor="c1">t от, °C</label><input id="c1" inputMode="decimal" value={cfg.tMin} onChange={(e) => setCfg({ ...cfg, tMin: e.target.value })} /></div>
              <div><label htmlFor="c2">t до, °C</label><input id="c2" inputMode="decimal" value={cfg.tMax} onChange={(e) => setCfg({ ...cfg, tMax: e.target.value })} /></div>
            </div>
            <label htmlFor="cb">Основание (документ, пункт)</label><input id="cb" value={cfg.basis} onChange={(e) => setCfg({ ...cfg, basis: e.target.value })} placeholder="СанПиН 2.3/2.4.4282-26, п. 56 пп. 4; программа ПК, п. …" />
            <div className="row" style={{ marginTop: 8 }}><button className="btn small" disabled={busy}>Утвердить</button><button type="button" className="btn small secondary" onClick={() => setCfg(null)}>Отмена</button></div>
          </form>
        )}
      </div>

      {x.missing.length > 0 && (
        <div className="card">
          <h2>Нужно отобрать · {x.missing.length}</h2>
          {x.missing.map((m) => (
            <div key={`${m.event_id}:${m.dish_id}`} className="objrow">
              <div><b>{m.dish}</b><div className="small muted">мероприятие № {m.number} «{m.title}», {ddmm(m.event_date)}</div></div>
              <button className="btn secondary small" onClick={() => setF({ ...f, source: 'event', key: `${m.event_id}:${m.dish_id}` })}>Отобрать</button>
            </div>))}
        </div>
      )}

      <div className="card">
        <h2>Отбор пробы</h2>
        <div className="chips">
          {[['event', 'Мероприятие'], ['dish', 'Блюдо смены'], ['lot', 'Партия п/ф']].map(([k, l]) => <button key={k} type="button" aria-pressed={f.source === k} onClick={() => setF({ ...f, source: k })}>{l}</button>)}
        </div>
        {f.source === 'event' && (x.missing.length
          ? <select aria-label="Блюдо мероприятия" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })}><option value="">— блюдо мероприятия —</option>
            {x.missing.map((m) => <option key={`${m.event_id}:${m.dish_id}`} value={`${m.event_id}:${m.dish_id}`}>{m.dish} — № {m.number} «{m.title}»</option>)}</select>
          : <p className="small muted">Все пробы по мероприятиям вчера, сегодня и завтра отобраны.</p>)}
        {f.source === 'dish' && <select aria-label="Блюдо" value={f.dishId} onChange={(e) => setF({ ...f, dishId: e.target.value })}><option value="">— блюдо —</option>{dishes.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}
        {f.source === 'lot' && <select aria-label="Партия" value={f.lotId} onChange={(e) => setF({ ...f, lotId: e.target.value })}><option value="">— партия п/ф —</option>{lots.map((l) => <option key={l.id} value={l.id}>{l.product}, {l.lot_no}</option>)}</select>}
        <div className="grid2">
          <div><label htmlFor="sw">Масса, г</label><input id="sw" inputMode="decimal" disabled={f.whole} value={f.weight} onChange={(e) => setF({ ...f, weight: e.target.value })} placeholder={`не менее ${n(s.min_weight_g)}`} /></div>
          <div><label htmlFor="st">t в холодильнике, °C</label><input id="st" inputMode="decimal" value={f.temp} onChange={(e) => setF({ ...f, temp: e.target.value })} placeholder={`${n(s.t_min)}…${n(s.t_max)}`} /></div>
        </div>
        <InstrumentPicker id="si" siteId={siteId} value={f.instrumentId} onChange={(v) => setF((x) => ({ ...x, instrumentId: v }))} />
        <label className="row" style={{ fontWeight: 400, marginTop: 8 }}><input type="checkbox" style={{ width: 22, minHeight: 22 }} checked={f.whole} onChange={(e) => setF({ ...f, whole: e.target.checked })} /> Порция целиком (штучное блюдо)</label>
        <label htmlFor="sc">Тара</label><input id="sc" value={f.container} onChange={(e) => setF({ ...f, container: e.target.value })} />
        <label htmlFor="so">Где хранится</label>
        <select id="so" value={f.objectId} onChange={(e) => setF({ ...f, objectId: e.target.value })}><option value="">— другое место —</option>{objects.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
        {!f.objectId && <input aria-label="Место хранения" value={f.place} onChange={(e) => setF({ ...f, place: e.target.value })} placeholder="холодильник для проб" style={{ marginTop: 6 }} />}
        {error && <div className="err" role="alert">{error}</div>}
        {ok && <div className="okbox" role="status">{ok}</div>}
        <button className="btn block" disabled={busy || !siteId || !f.temp || (f.source === 'event' ? !f.key : f.source === 'dish' ? !f.dishId : !f.lotId)} onClick={take}>Отобрать пробу</button>
      </div>

      <div className="card">
        <h2>На хранении · {x.stored.length}</h2>
        {x.stored.length === 0 && <p className="small muted">Проб на хранении нет.</p>}
        <ul className="list">{x.stored.map((p) => (
          <li key={p.id}>
            <div className="between">
              <div><b>{p.title}</b>
                <div className="small muted">{p.whole_portion ? 'порция' : `${n(p.weight_g)} г`} · {p.storage_place}, {n(p.temperature)} °C · {dt(p.taken_at, org.timezone)}, {p.taken_by}</div>
                <div className="small">хранить до {dt(p.keep_until, org.timezone)}</div></div>
              {p.status === 'due' ? <button className="btn secondary small" disabled={busy} onClick={() => run(async () => { await api(`/orgs/${org.id}/samples/${p.id}/destroy`, { body: {} }); load(); })}>Уничтожена</button>
                : <span className="badge">хранится</span>}
            </div>
          </li>))}</ul>
      </div>
      {x.destroyed.length > 0 && (
        <div className="card">
          <h2>Уничтожены (30 дней) · {x.destroyed.length}</h2>
          <ul className="list">{x.destroyed.map((p) => <li key={p.id} className="small">{p.title} · отобрана {dt(p.taken_at, org.timezone)} · уничтожена {dt(p.destroyed_at, org.timezone)}, {p.destroyed_by}</li>)}</ul>
        </div>
      )}
    </>
  );
}

interface Param { name: string; norm: string; fact: string; unit: string; pass: boolean }

function LabTab() {
  const { org, siteId, can } = useOrg();
  const [x, setX] = useState<{ programs: Program[]; results: Result[] } | null>(null);
  const [pg, setPg] = useState({ testType: '', target: '', periodDays: '90', retestDays: '7', nextDue: today(), basis: '' });
  const [r, setR] = useState({ programId: '', testType: '', target: '', labName: '', protocolNo: '', sampledOn: today(), resultOn: today(), result: '', conclusion: '' });
  const [params, setParams] = useState<Param[]>([]);
  const [mc, setMc] = useState({ season: 'cold' as 'cold' | 'warm', category: 'IIа' });
  const [done, setDone] = useState<string | null>(null);
  const { busy, error, run, setError } = useSubmit();
  const manage = can('lab.manage');
  const load = useCallback(() => { if (siteId) api<{ programs: Program[]; results: Result[] }>(`/orgs/${org.id}/lab?siteId=${siteId}`).then(setX).catch((e) => setError(e.message)); }, [org.id, siteId, setError]);
  useEffect(() => { load(); }, [load]);
  if (!x) return error ? <div className="err">{error}</div> : <p className="muted">Загрузка…</p>;
  const computed = params.length ? (params.some((p) => !p.pass) ? 'fail' : 'pass') : r.result;
  return (
    <>
      <div className="card">
        <h2>Программа контроля · {x.programs.length}</h2>
        {x.programs.length === 0 && <p className="small muted">Исследований в программе нет. Внесите их из программы производственного контроля.</p>}
        {x.programs.map((p) => (
          <div key={p.id} className="objrow">
            <div><b>{p.test_type}</b><div className="small muted">{p.target} · раз в {p.period_days} дн. · {p.basis}</div>
              {p.last && <div className="small">последний: {p.last.result === 'pass' ? 'соответствует' : 'не соответствует'}, протокол {p.last.protocol_no} от {ddmm(p.last.result_on)}</div>}</div>
            <span className={`badge ${p.overdue ? 'crit' : ''}`}>{p.overdue ? 'просрочено' : 'до'} {ddmm(p.next_due)}</span>
          </div>))}
        {manage && (
          <form style={{ marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); run(async () => {
            await api(`/orgs/${org.id}/lab/programs`, { body: { siteId, ...pg, retestDays: pg.retestDays || null } });
            setPg({ ...pg, testType: '', target: '' }); load();
          }); }}>
            <h3>Добавить исследование</h3>
            <div className="grid2">
              <div><label htmlFor="pt">Вид исследования</label><input id="pt" value={pg.testType} onChange={(e) => setPg({ ...pg, testType: e.target.value })} placeholder="микробиология готовых блюд" /></div>
              <div><label htmlFor="po">Объект</label><input id="po" value={pg.target} onChange={(e) => setPg({ ...pg, target: e.target.value })} placeholder="салаты, смывы, вода" /></div>
              <div><label htmlFor="pp">Раз в, дней</label><input id="pp" inputMode="numeric" value={pg.periodDays} onChange={(e) => setPg({ ...pg, periodDays: e.target.value })} /></div>
              <div><label htmlFor="pr">Повтор при несоответствии, дней</label><input id="pr" inputMode="numeric" value={pg.retestDays} onChange={(e) => setPg({ ...pg, retestDays: e.target.value })} /></div>
              <div><label htmlFor="pn">Ближайший отбор</label><input id="pn" type="date" value={pg.nextDue} onChange={(e) => setPg({ ...pg, nextDue: e.target.value })} /></div>
              <div><label htmlFor="pb">Основание</label><input id="pb" value={pg.basis} onChange={(e) => setPg({ ...pg, basis: e.target.value })} placeholder="программа ПК, п. …" /></div>
            </div>
            <button className="btn secondary block" disabled={busy || !siteId}>Добавить в программу</button>
          </form>
        )}
      </div>

      {manage && (
        <div className="card">
          <h2>Внести результат</h2>
          <label htmlFor="rp">Исследование</label>
          <select id="rp" value={r.programId} onChange={(e) => setR({ ...r, programId: e.target.value })}>
            <option value="">— вне программы —</option>{x.programs.map((p) => <option key={p.id} value={p.id}>{p.test_type} — {p.target}</option>)}
          </select>
          {!r.programId && <div className="grid2">
            <div><label htmlFor="rt">Вид исследования</label><input id="rt" value={r.testType} onChange={(e) => setR({ ...r, testType: e.target.value })} /></div>
            <div><label htmlFor="ro">Объект</label><input id="ro" value={r.target} onChange={(e) => setR({ ...r, target: e.target.value })} /></div>
          </div>}
          <div className="grid2">
            <div><label htmlFor="rl">Лаборатория</label><input id="rl" value={r.labName} onChange={(e) => setR({ ...r, labName: e.target.value })} /></div>
            <div><label htmlFor="rn">Протокол №</label><input id="rn" value={r.protocolNo} onChange={(e) => setR({ ...r, protocolNo: e.target.value })} /></div>
            <div><label htmlFor="rs">Отбор</label><input id="rs" type="date" value={r.sampledOn} onChange={(e) => setR({ ...r, sampledOn: e.target.value })} /></div>
            <div><label htmlFor="rd">Результат от</label><input id="rd" type="date" value={r.resultOn} onChange={(e) => setR({ ...r, resultOn: e.target.value })} /></div>
          </div>
          <h3 style={{ marginTop: 12 }}>Показатели из протокола</h3>
          {params.length === 0 && (
            <div className="card" style={{ padding: 10, marginBottom: 8 }}>
              <p className="small" style={{ marginTop: 0 }}>Подставить нормы из СанПиН 1.2.3685-21 — останется внести факт по протоколу:</p>
              <button type="button" className="btn secondary small" onClick={() => setParams(WATER_MICRO.map((w) => ({ name: w.name, norm: `${w.norm} (${w.source})`, fact: '', unit: w.unit, pass: true })))}>Вода питьевая — табл. 3.5</button>
              <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <select aria-label="Период года" value={mc.season} onChange={(e) => setMc({ ...mc, season: e.target.value as 'cold' | 'warm' })} style={{ width: 'auto' }}><option value="cold">холодный период</option><option value="warm">тёплый период</option></select>
                <select aria-label="Категория работ" value={mc.category} onChange={(e) => setMc({ ...mc, category: e.target.value })} style={{ width: 'auto' }}>{WORK_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                <button type="button" className="btn secondary small" onClick={() => setParams(microclimate(mc.season, mc.category).map((w) => ({ name: w.name, norm: `${w.norm} (${w.source})`, fact: '', unit: w.unit, pass: true })))}>Микроклимат — табл. 5.2</button>
              </div>
              <p className="small muted">Категорию работ берут из специальной оценки условий труда (табл. 5.1).</p>
            </div>)}
          {params.map((p, i) => (
            <div key={i} className="card" style={{ padding: 10, marginBottom: 8 }}>
              <div className="grid2">
                <input aria-label={`Показатель ${i + 1}`} placeholder="показатель (БГКП, КМАФАнМ)" value={p.name} onChange={(e) => setParams(params.map((q, k) => (k === i ? { ...q, name: e.target.value } : q)))} />
                <input aria-label={`Норма ${i + 1}`} placeholder="норма" value={p.norm} onChange={(e) => setParams(params.map((q, k) => (k === i ? { ...q, norm: e.target.value } : q)))} />
                <input aria-label={`Факт ${i + 1}`} placeholder="факт" value={p.fact} onChange={(e) => setParams(params.map((q, k) => (k === i ? { ...q, fact: e.target.value } : q)))} />
                <input aria-label={`Ед. ${i + 1}`} placeholder="ед." value={p.unit} onChange={(e) => setParams(params.map((q, k) => (k === i ? { ...q, unit: e.target.value } : q)))} />
              </div>
              <div className="seg" style={{ marginTop: 6 }}>
                <button type="button" className="yes" aria-pressed={p.pass} onClick={() => setParams(params.map((q, k) => (k === i ? { ...q, pass: true } : q)))}>В норме</button>
                <button type="button" className="no" aria-pressed={!p.pass} onClick={() => setParams(params.map((q, k) => (k === i ? { ...q, pass: false } : q)))}>Вне нормы</button>
              </div>
              <button type="button" className="linkbtn small" onClick={() => setParams(params.filter((_, k) => k !== i))}>убрать</button>
            </div>))}
          <button type="button" className="btn secondary small" onClick={() => setParams([...params, { name: '', norm: '', fact: '', unit: '', pass: true }])}>+ Показатель</button>
          {params.length === 0 && (
            <div className="seg" style={{ marginTop: 10 }}>
              <button type="button" className="yes" aria-pressed={r.result === 'pass'} onClick={() => setR({ ...r, result: 'pass' })}>Соответствует</button>
              <button type="button" className="no" aria-pressed={r.result === 'fail'} onClick={() => setR({ ...r, result: 'fail' })}>Не соответствует</button>
            </div>)}
          {computed === 'fail' && <><label htmlFor="rc">Заключение лаборатории</label><input id="rc" value={r.conclusion} onChange={(e) => setR({ ...r, conclusion: e.target.value })} /></>}
          {params.length > 0 && <p className="small">Итог по показателям: <b>{computed === 'fail' ? 'не соответствует' : 'соответствует'}</b></p>}
          {error && <div className="err" role="alert">{error}</div>}
          {done && <div className="okbox" role="status">{done}</div>}
          <button className="btn block" disabled={busy || !siteId || !computed} onClick={() => run(async () => {
            const res = await api<{ result: string; next_due: string | null; incident_id: string | null }>(`/orgs/${org.id}/lab/results`, { body: { siteId, programId: r.programId || null, testType: r.testType || null, target: r.target || null,
              labName: r.labName, protocolNo: r.protocolNo, sampledOn: r.sampledOn, resultOn: r.resultOn, params: params.map((p) => ({ ...p, unit: p.unit || null })), result: params.length ? null : r.result || null, conclusion: r.conclusion || null } });
            setDone(`${res.result === 'pass' ? 'Соответствует' : 'Не соответствует — создано отклонение и задача на повторный отбор'}.${res.next_due ? ` Следующий отбор — ${ddmm(res.next_due)}.` : ''}`);
            setParams([]); setR({ ...r, protocolNo: '', result: '', conclusion: '' }); load();
          })}>Сохранить результат</button>
          <p className="small muted">Скан протокола прикрепите в карточке результата. Запись не меняется: ошибку исправляют новой записью.</p>
        </div>
      )}

      <div className="card">
        <h2>Результаты · {x.results.length}</h2>
        {x.results.length === 0 && <p className="small muted">Результатов пока нет.</p>}
        {x.results.map((t) => (
          <Link key={t.id} href={`/app/${org.id}/lab/results/${t.id}`} className="objrow">
            <div><b>{t.test_type}</b><div className="small muted">{t.target} · протокол {t.protocol_no} от {ddmm(t.result_on)} · {t.lab_name}{t.files ? ` · файлов: ${t.files}` : ' · скан не приложен'}</div></div>
            <span className={`badge ${t.result === 'pass' ? 'ok' : 'crit'}`}>{t.result === 'pass' ? 'соответствует' : 'не соответствует'}</span>
          </Link>))}
      </div>
    </>
  );
}

function Lab() {
  const { can } = useOrg();
  const sp = useSearchParams();
  const tabs: [string, string][] = [...(can('sample.record') ? [['samples', 'Суточные пробы'] as [string, string]] : []), ...(can('lab.read') ? [['lab', 'Лаборатория'] as [string, string]] : [])];
  const [tab, setTab] = useState(sp.get('tab') || tabs[0]?.[0] || 'samples');
  return (
    <>
      <h1>Лаборатория и пробы</h1>
      <SitePicker />
      <div className="tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'lab' ? <LabTab /> : <SamplesTab />}
    </>
  );
}

export default function Page() { return <Suspense><Lab /></Suspense>; }
