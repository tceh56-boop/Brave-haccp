'use client';
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { useOperationId } from '@/lib/op';
import { api } from '@/lib/api';
import { d as day, dt, n } from '@/lib/fmt';

/** Задание на производство: потребность и остатки, замеры при выпуске (ККТ), выпуск партии п/ф, этикетка. */

interface Last { id: string; value: string; value_before: string | null; ok: boolean; phase: string; measured_at: string; recorded_at: string; recorded_by: string; incident_id: string | null; duration_min: string | null; instrument: string | null; start_value: string | null; start_at: string | null }
/** Требование к замеру при выпуске: из этапа ТТК со ссылкой на ККТ плана ХАССП или действующего параметра выпуска. */
interface Check { key: string; ccp_code: string | null; kind: 'core_temp' | 'cooling' | 'reheat' | 'other'; kind_label: string; source: string; state: 'ready' | 'not_configured'; reason: string | null;
  check: { id: string; name: string; unit: string; basis: string } | null; limits: string | null; corrective_action: string | null; record_form: string | null;
  last: Last | null; open_start: { id: string; value: string; measured_at: string; instrument: string | null } | null }
interface Probe { id: string; name: string; serial_no: string | null; calibration_due: string | null; usable: boolean; reason: string | null }
interface Card {
  order: { id: string; site_id: string; status: string; status_label: string; dish_id: string; dish_name: string; dish_kind?: string; organoleptic?: string | null; release_decision?: string | null; planned_g: string; actual_g: string | null; planned_for: string; note: string | null; cost: string | null;
    created_by_name: string | null; started_by_name: string | null; started_at: string | null; completed_by_name: string | null; completed_at: string | null; cancel_reason: string | null };
  ttk: { version: number; yield_g: string; shelf_life_hours: string | null; storage_conditions: string | null };
  checks: Check[]; ccp_blocked: string[];
  need: { product_id: string; name: string; unit: string; need: number; have: number; enough: boolean; semi: boolean }[] | null; need_error: string | null;
  consumed: { lot_id: string; quantity: string; unit: string; product: string; lot_no: string | null }[];
  lots: { product_id: string; lot_id: string; lot_no: string | null; quantity: number; unit: string; expires_at: string; suggest: number }[];
  deviation: { product_id: string; name: string; unit: string; norm: number | null; fact: number; diff: number | null; diff_pct: number | null }[] | null;
  lot: { id: string; lot_no: string; quantity: string; unit: string; expires_at: string | null; expiry_basis: string | null; status: string; status_reason: string | null } | null;
  label: { id: string; code: string } | null;
}
const TONE: Record<string, string> = { in_progress: 'warn', planned: '', done: 'ok', cancelled: 'crit' };

export default function ProductionOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { org, can } = useOrg();
  const router = useRouter();
  const [c, setC] = useState<Card | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [before, setBefore] = useState<Record<string, string>>({});
  const [at, setAt] = useState<Record<string, string>>({});          // время замера, если вносится позже (чч:мм)
  const [probes, setProbes] = useState<Probe[]>([]);
  const [probe, setProbe] = useState('');
  const [msg, setMsg] = useState<{ key: string; ok: boolean; text: string; action: string | null } | null>(null);
  const [fix, setFix] = useState<Record<string, { value: string; reason: string }>>({});
  const [actual, setActual] = useState('');
  const [orgl, setOrgl] = useState('');
  const [decision, setDecision] = useState<'allowed' | 'rejected' | ''>('');
  const [reason, setReason] = useState('');
  const [used, setUsed] = useState<Record<string, string> | null>(null);   // фактический расход по партиям, вводит повар
  const op = useOperationId();
  const { busy, error, run, setError } = useSubmit();
  const load = useCallback(() => api<Card>(`/orgs/${org.id}/production/${id}`).then((x) => { setC(x); setActual((v) => v || String(Number(x.order.planned_g) / 1000).replace('.', ',')); }).catch((e) => setError(e.message)), [org.id, id, setError]);
  useEffect(() => { load(); }, [load]);
  const siteId = c?.order.site_id;
  useEffect(() => { if (siteId) api<Probe[]>(`/orgs/${org.id}/equipment/instruments?siteId=${siteId}`).then((l) => { setProbes(l); setProbe((p) => p || l.find((x) => x.usable)?.id || ''); }).catch(() => setProbes([])); }, [org.id, siteId]);
  if (!c) return error ? <div className="err">{error}</div> : <p className="muted">Загрузка…</p>;
  const o = c.order, tz = org.timezone;
  const run_ = can('production.run'), open = ['planned', 'in_progress'].includes(o.status);
  const unset = c.checks.filter((x) => x.state === 'not_configured');
  const missing = c.checks.filter((x) => x.state === 'ready' && !x.last);
  const bad = c.checks.filter((x) => x.last && !x.last.ok);
  const blocked = [...unset, ...missing];
  const short = (c.need || []).filter((x) => !x.enough);
  const fact = used ?? Object.fromEntries(c.lots.filter((l) => l.suggest > 0).map((l) => [l.lot_id, String(l.suggest).replace('.', ',')]));
  const consumed = Object.entries(fact).filter(([, v]) => Number(v.replace(',', '.')) > 0).map(([lotId, v]) => ({ lotId, quantity: v }));
  // «чч:мм» в поясе предприятия (не устройства): сдвиг от текущего времени предприятия
  const isoAt = (hhmm: string) => {
    if (!hhmm) return null;
    const [h, m] = hhmm.split(':').map(Number);
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    const nowMin = Number(p.find((x) => x.type === 'hour')!.value) * 60 + Number(p.find((x) => x.type === 'minute')!.value);
    return new Date(Date.now() - (nowMin - (h * 60 + m)) * 60e3).toISOString();
  };
  const measure = (x: Check, phase: 'single' | 'start' | 'end') => run(async () => {
    const r = await api<{ ok: boolean; corrective_action: string | null; limits: string; minutes: number | null }>(`/orgs/${org.id}/production/${id}/checks`, { body: {
      checkId: x.check!.id, value: (vals[x.key] || '').replace(',', '.'), phase, instrumentId: probe || null, measuredAt: isoAt(at[x.key] || ''),
      valueBefore: before[x.key] ? before[x.key].replace(',', '.') : null } });
    setMsg({ key: x.key, ok: r.ok, text: r.ok ? `В пределах (${r.limits})${r.minutes !== null && phase === 'end' ? `, ${n(r.minutes)} мин` : ''}.` : `Вне предела: ${r.limits}.`, action: r.corrective_action });
    setVals({ ...vals, [x.key]: '' }); setBefore({ ...before, [x.key]: '' }); setAt({ ...at, [x.key]: '' }); await load();
  });
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/production`}>← Производство</Link></p>
      <h1 style={{ marginBottom: 4 }}>{o.dish_name}</h1>
      <p style={{ marginTop: 0 }}><span className={`badge ${TONE[o.status]}`}>{o.status_label}</span></p>
      <div className="card">
        <dl className="kv">
          <dt>План</dt><dd>{n(Number(o.planned_g) / 1000)} кг на {day(o.planned_for, tz)}</dd>
          <dt>ТТК</dt><dd><Link href={`/app/${org.id}/menu/${o.dish_id}`}>версия {c.ttk.version}</Link> · срок партии {c.ttk.shelf_life_hours ? `${n(c.ttk.shelf_life_hours)} ч` : <b>не задан</b>}{c.ttk.storage_conditions ? ` · ${c.ttk.storage_conditions}` : ''}</dd>
          <dt>Создал</dt><dd>{o.created_by_name}{o.note ? ` · ${o.note}` : ''}</dd>
          {o.started_at && <><dt>Начал</dt><dd>{o.started_by_name} · {dt(o.started_at, tz)}</dd></>}
          {o.completed_at && <><dt>Выпустил</dt><dd>{o.completed_by_name} · {dt(o.completed_at, tz)}</dd></>}
          {o.cancel_reason && <><dt>Отменено</dt><dd>{o.cancel_reason}</dd></>}
        </dl>
        {!c.ttk.shelf_life_hours && open && <div className="note">В ТТК не задан срок партии в часах — выпущенная партия получит «срок не подтверждён», использовать её можно будет только после подтверждения срока.</div>}
      </div>
      {error && <div className="err" role="alert">{error}</div>}

      {o.status === 'planned' && run_ && <button className="btn block" disabled={busy} onClick={() => run(async () => { await api(`/orgs/${org.id}/production/${id}/start`, { body: {} }); await load(); })}>Начать</button>}

      {open && c.need && (
        <div className="card">
          <h2>Потребность по ТТК</h2>
          {short.length > 0 && <div className="err">Не хватает годного остатка: {short.map((x) => x.name).join(', ')}. Выпуск будет отклонён целиком.</div>}
          <div className="scroll"><table className="tbl"><thead><tr><th>Позиция</th><th>Нужно</th><th>Годный остаток</th></tr></thead>
            <tbody>{c.need.map((x) => <tr key={x.product_id}><td>{x.name}{x.semi && <span className="badge" style={{ marginLeft: 6 }}>готовый п/ф</span>}</td><td>{n(x.need)} {x.unit}</td>
              <td><span className={`badge ${x.enough ? 'ok' : 'crit'}`}>{n(x.have)} {x.unit}</span></td></tr>)}</tbody></table></div>
          <p className="small muted">Готовые полуфабрикаты со склада идут первыми, остальное — сырьём; всё по ближайшему сроку годности.</p>
        </div>
      )}
      {open && c.need_error && <div className="err">{c.need_error}</div>}

      {c.checks.length > 0 && (
        <div className="card">
          <h2>Контроль при выпуске (ККТ)</h2>
          {o.status === 'in_progress' && run_ && c.checks.some((x) => x.state === 'ready' && x.kind !== 'other') && <>
            <label htmlFor="probe">Щуп (из реестра оборудования, поверка действует)</label>
            <select id="probe" value={probe} onChange={(e) => setProbe(e.target.value)}>
              <option value="">— выберите —</option>
              {probes.map((p) => <option key={p.id} value={p.id} disabled={!p.usable}>{p.name}{p.serial_no ? ` № ${p.serial_no}` : ''}{p.usable ? (p.calibration_due ? ` · поверка до ${day(p.calibration_due, tz)}` : '') : ` — ${p.reason}`}</option>)}
            </select>
            {probes.filter((p) => p.usable).length === 0 && <div className="err">На площадке нет щупа с действующей поверкой — замер ККТ не принимается. Обратитесь к ответственному за оборудование.</div>}
          </>}
          <ul className="list">{c.checks.map((x) => {
            const u = x.check?.unit || '°C';
            const phase: 'single' | 'start' | 'end' = x.kind === 'cooling' ? (x.open_start ? 'end' : 'start') : 'single';
            return (
            <li key={x.key}>
              <div className="between"><div><b>{x.check?.name || x.kind_label}</b>{x.limits ? `: ${x.limits}` : ''}
                <div className="small muted">{x.kind_label}{x.record_form ? ` · журнал ${x.record_form}` : ''} · {x.source}</div></div>
                {x.state === 'not_configured' ? <span className="badge crit">не настроено</span>
                  : x.last ? <span className={`badge ${x.last.ok ? 'ok' : 'crit'}`}>{x.kind === 'cooling' && x.last.start_value !== null ? `${n(x.last.start_value)} → ` : ''}{n(x.last.value)} {u}</span>
                  : x.open_start ? <span className="badge warn">охлаждение идёт</span> : <span className="badge warn">нет замера</span>}</div>
              {x.state === 'not_configured' && <div className="note">{x.reason}. Выпуск закрыт, пока предел не утвердит ответственный (раздел блюда → «Контроль при выпуске»).</div>}
              {x.last && <div className="small muted">{x.last.recorded_by}, замер {dt(x.last.measured_at, tz)}{x.last.duration_min !== null && x.kind === 'cooling' ? ` · ${n(x.last.duration_min)} мин` : ''}{x.last.instrument ? ` · ${x.last.instrument}` : ''}
                {x.last.incident_id && <> · <Link href={`/app/${org.id}/incidents/${x.last.incident_id}`}>отклонение</Link></>}</div>}
              {x.open_start && <div className="small">Начало охлаждения: {n(x.open_start.value)} {u} в {dt(x.open_start.measured_at, tz)}. Запишите конечный замер.</div>}
              {msg?.key === x.key && <div className={msg.ok ? 'note' : 'err'} role="status">{msg.text}{msg.action && <><br /><b>Что делать сейчас:</b> {msg.action}</>}</div>}
              {x.last && !x.last.ok && msg?.key !== x.key && x.corrective_action && <div className="err"><b>Что делать сейчас:</b> {x.corrective_action}</div>}
              {o.status === 'in_progress' && run_ && x.state === 'ready' && (
                <form style={{ marginTop: 6 }} onSubmit={(e) => { e.preventDefault(); measure(x, phase); }}>
                  {(x.kind === 'core_temp' || x.kind === 'reheat') && <input aria-label={`Температура до: ${x.check!.name}`} inputMode="decimal" value={before[x.key] || ''} onChange={(e) => setBefore({ ...before, [x.key]: e.target.value })} placeholder={`до, ${u} (необязательно)`} />}
                  <div className="row">
                    <input aria-label={`${phase === 'start' ? 'Начало охлаждения' : phase === 'end' ? 'Конец охлаждения' : 'Замер'}: ${x.check!.name}`} inputMode="decimal" required value={vals[x.key] || ''}
                      onChange={(e) => setVals({ ...vals, [x.key]: e.target.value })} placeholder={phase === 'start' ? `начало, ${u}` : phase === 'end' ? `конец, ${u}` : u} style={{ flex: 2, minHeight: 48 }} />
                    <input aria-label="Время замера, если вносите позже" type="time" value={at[x.key] || ''} onChange={(e) => setAt({ ...at, [x.key]: e.target.value })} style={{ flex: 1, minHeight: 48 }} />
                    <button className="btn" style={{ minHeight: 48 }} disabled={busy || (x.kind !== 'other' && !probe)}>{phase === 'start' ? 'Начало' : phase === 'end' ? 'Конец' : 'Записать'}</button>
                  </div>
                  <p className="small muted">Время — сейчас, если не указано. Замер не меняется; ошибку исправляет ответственный ХАССП с причиной.</p>
                </form>)}
              {x.last && can('haccp.manage') && (
                <details style={{ marginTop: 4 }}><summary className="small">Исправить запись (с причиной)</summary>
                  <form className="row" onSubmit={(e) => { e.preventDefault(); run(async () => {
                    const f = fix[x.key];
                    const r = await api<{ ok: boolean; lot_quarantined: boolean; corrective_action: string | null }>(`/orgs/${org.id}/production-checks/${x.last!.id}/correct`, { body: { value: (f?.value || '').replace(',', '.'), reason: f?.reason || '' } });
                    setMsg({ key: x.key, ok: r.ok, text: r.ok ? 'Исправлено.' : `Исправлено: значение вне предела${r.lot_quarantined ? ', партия переведена в карантин' : ''}.`, action: r.corrective_action });
                    setFix({ ...fix, [x.key]: { value: '', reason: '' } }); await load();
                  }); }}>
                    <input aria-label="Верное значение" inputMode="decimal" required placeholder={u} value={fix[x.key]?.value || ''} onChange={(e) => setFix({ ...fix, [x.key]: { value: e.target.value, reason: fix[x.key]?.reason || '' } })} style={{ flex: 1 }} />
                    <input aria-label="Причина исправления" required placeholder="причина: что было неверно, откуда верное значение" value={fix[x.key]?.reason || ''} onChange={(e) => setFix({ ...fix, [x.key]: { value: fix[x.key]?.value || '', reason: e.target.value } })} style={{ flex: 3 }} />
                    <button className="btn small secondary" disabled={busy}>Исправить</button>
                  </form>
                </details>)}
            </li>); })}</ul>
        </div>
      )}

      {o.status === 'in_progress' && run_ && (
        <div className="card">
          <h2>Выпуск партии</h2>
          {unset.length > 0 && <div className="err">Выпуск закрыт: контроль ККТ не настроен — {unset.map((x) => `${x.kind_label} (${x.reason})`).join('; ')}.</div>}
          {missing.length > 0 && <div className="note">Выпуск закрыт: нужен замер — {missing.map((x) => x.check!.name).join(', ')}.</div>}
          {bad.length > 0 && <div className="err">Последний замер вне предела: {bad.map((x) => x.check!.name).join(', ')}. Выпуск оформит партию в карантин, отклонение и CAPA — реализовать её нельзя до решения ответственного. Если обработку можно продолжить — продолжите и замерьте снова.</div>}
          <form onSubmit={(e) => { e.preventDefault(); run(async () => {
            const r = await api<{ label_id: string; lot_status: string }>(`/orgs/${org.id}/production/${id}/complete`, { body: { actualKg: actual, consumed, operationId: op.id, organoleptic: orgl || null, decision: decision || null } });
            op.next(); await load();
            if (r.lot_status !== 'quarantine') router.push(`/app/${org.id}/labels/print?ids=${r.label_id}`);
          }); }}>
            <h3>Фактический расход</h3>
            <p className="small muted">Укажите, сколько взяли из каждой партии. Значения заполнены подсказкой по ТТК на плановый выход и ближайшему сроку — исправьте по факту:
              в учёт пойдут именно они. Норма ТТК сохранится отдельно, отклонение будет видно после выпуска.</p>
            {(c.need || []).map((nd) => {
              const ls = c.lots.filter((l) => l.product_id === nd.product_id);
              return (
                <div key={nd.product_id} style={{ marginBottom: 8 }}>
                  <div className="small"><b>{nd.name}</b> · по ТТК на план {n(nd.need)} {nd.unit}</div>
                  {ls.length === 0 && <div className="small err">Нет годных партий на площадке.</div>}
                  {ls.map((l) => (
                    <div key={l.lot_id} className="row" style={{ alignItems: 'center' }}>
                      <span className="small" style={{ flex: 2 }}>{l.lot_no || 'без номера'} · остаток {n(l.quantity)} {l.unit} · до {day(l.expires_at, tz)}</span>
                      <input aria-label={`Взято из партии ${l.lot_no || ''}: ${nd.name}`} inputMode="decimal" style={{ flex: 1 }} placeholder={l.unit}
                        value={fact[l.lot_id] || ''} onChange={(e) => setUsed({ ...fact, [l.lot_id]: e.target.value })} />
                    </div>))}
                </div>);
            })}
            <label htmlFor="ak">Фактический выход, кг</label>
            <input id="ak" required inputMode="decimal" value={actual} onChange={(e) => setActual(e.target.value)} />
            {o.dish_kind === 'dish' && <>
              <h3>Бракераж (журнал J58)</h3>
              <label htmlFor="org">Органолептика: внешний вид, цвет, консистенция, вкус и запах</label>
              <textarea id="org" rows={2} required value={orgl} onChange={(e) => setOrgl(e.target.value)} />
              <label htmlFor="dec">Решение</label>
              <select id="dec" required value={decision} onChange={(e) => setDecision(e.target.value as 'allowed' | 'rejected' | '')}>
                <option value="">— выберите —</option><option value="allowed">Допущено к реализации</option><option value="rejected">Не допущено — партия в карантин</option></select>
            </>}
            <p className="small muted">Списывается только указанный фактический расход; партия выпуска — по фактическому выходу. Расход по норме фактом не записывается.</p>
            <button className="btn block" disabled={busy || blocked.length > 0 || consumed.length === 0}>{bad.length ? 'Выпустить партию в карантин' : 'Выпустить партию и напечатать этикетку'}</button>
          </form>
        </div>
      )}

      {o.status === 'done' && c.lot && (
        <div className="card">
          <h2>Выпущено</h2>
          <dl className="kv">
            <dt>Партия</dt><dd><Link href={`/app/${org.id}/lots/${c.lot.id}`}>{c.lot.lot_no}</Link> · {n(c.lot.quantity)} {c.lot.unit}{c.lot.status === 'quarantine' && <> · <span className="badge crit">карантин</span></>}</dd>
            {c.lot.status === 'quarantine' && c.lot.status_reason && <><dt>Причина</dt><dd>{c.lot.status_reason}</dd></>}
            <dt>Годен до</dt><dd>{c.lot.expires_at ? `${dt(c.lot.expires_at, tz)} — ${c.lot.expiry_basis}` : 'срок не подтверждён'}</dd>
            {can('cost.read') && o.cost !== null && <><dt>Себестоимость</dt><dd>{n(o.cost)} ₽</dd></>}
          </dl>
          {c.label && <Link className="btn block secondary" href={`/app/${org.id}/labels/print?ids=${c.label.id}`}>Этикетка {c.label.code}</Link>}
          <h3 style={{ marginTop: 12 }}>Израсходовано</h3>
          <ul className="list">{c.consumed.map((x, i) => <li key={i}><Link href={`/app/${org.id}/lots/${x.lot_id}`}>{x.product}</Link> · {x.lot_no || 'без номера'} · {n(Math.abs(Number(x.quantity)))} {x.unit}</li>)}</ul>
          {c.deviation && c.deviation.length > 0 && <>
            <h3 style={{ marginTop: 12 }}>Факт против нормы ТТК</h3>
            <div className="scroll"><table className="tbl"><thead><tr><th>Позиция</th><th>Норма на факт. выход (расчёт)</th><th>Факт</th><th>Отклонение</th></tr></thead>
              <tbody>{c.deviation.map((x) => <tr key={x.product_id}><td>{x.name}</td><td>{x.norm === null ? '—' : `${n(x.norm)} ${x.unit}`}</td><td>{n(x.fact)} {x.unit}</td>
                <td>{x.diff === null ? '—' : <span>{x.diff > 0 ? '+' : ''}{n(x.diff)} {x.unit}{x.diff_pct !== null ? ` (${x.diff_pct > 0 ? '+' : ''}${n(x.diff_pct)} %)` : ''}</span>}</td></tr>)}</tbody></table></div>
            <p className="small muted">Норма — расчёт по утверждённой ТТК; в склад записан только факт.</p>
          </>}
        </div>
      )}

      {open && can('production.plan') && (
        <div className="card">
          <h2>Отменить задание</h2>
          <label htmlFor="cr">Причина</label><input id="cr" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="перенесли, нет сырья" />
          <button className="btn block danger" disabled={busy} onClick={() => run(async () => { await api(`/orgs/${org.id}/production/${id}/cancel`, { body: { reason } }); await load(); })}>Отменить</button>
          <p className="small muted">До выпуска ничего не списано — отмена склад не меняет.</p>
        </div>
      )}
    </>
  );
}
