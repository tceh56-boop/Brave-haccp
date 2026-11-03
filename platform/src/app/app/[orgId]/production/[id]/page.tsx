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

interface Check { id: string; name: string; unit: string; limits: string; basis: string; last: { value: string; ok: boolean; recorded_at: string; recorded_by: string; incident_id: string | null } | null }
interface Card {
  order: { id: string; status: string; status_label: string; dish_id: string; dish_name: string; dish_kind?: string; organoleptic?: string | null; release_decision?: string | null; planned_g: string; actual_g: string | null; planned_for: string; note: string | null; cost: string | null;
    created_by_name: string | null; started_by_name: string | null; started_at: string | null; completed_by_name: string | null; completed_at: string | null; cancel_reason: string | null };
  ttk: { version: number; yield_g: string; shelf_life_hours: string | null; storage_conditions: string | null };
  checks: Check[];
  need: { product_id: string; name: string; unit: string; need: number; have: number; enough: boolean; semi: boolean }[] | null; need_error: string | null;
  consumed: { lot_id: string; quantity: string; unit: string; product: string; lot_no: string | null }[];
  lots: { product_id: string; lot_id: string; lot_no: string | null; quantity: number; unit: string; expires_at: string; suggest: number }[];
  deviation: { product_id: string; name: string; unit: string; norm: number | null; fact: number; diff: number | null; diff_pct: number | null }[] | null;
  lot: { id: string; lot_no: string; quantity: string; unit: string; expires_at: string | null; expiry_basis: string | null } | null;
  label: { id: string; code: string } | null;
}
const TONE: Record<string, string> = { in_progress: 'warn', planned: '', done: 'ok', cancelled: 'crit' };

export default function ProductionOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { org, can } = useOrg();
  const router = useRouter();
  const [c, setC] = useState<Card | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [actual, setActual] = useState('');
  const [orgl, setOrgl] = useState('');
  const [decision, setDecision] = useState<'allowed' | 'rejected' | ''>('');
  const [reason, setReason] = useState('');
  const [used, setUsed] = useState<Record<string, string> | null>(null);   // фактический расход по партиям, вводит повар
  const op = useOperationId();
  const { busy, error, run, setError } = useSubmit();
  const load = useCallback(() => api<Card>(`/orgs/${org.id}/production/${id}`).then((x) => { setC(x); setActual((v) => v || String(Number(x.order.planned_g) / 1000).replace('.', ',')); }).catch((e) => setError(e.message)), [org.id, id, setError]);
  useEffect(() => { load(); }, [load]);
  if (!c) return error ? <div className="err">{error}</div> : <p className="muted">Загрузка…</p>;
  const o = c.order, tz = org.timezone;
  const run_ = can('production.run'), open = ['planned', 'in_progress'].includes(o.status);
  const blocked = c.checks.filter((x) => !x.last?.ok);
  const short = (c.need || []).filter((x) => !x.enough);
  const fact = used ?? Object.fromEntries(c.lots.filter((l) => l.suggest > 0).map((l) => [l.lot_id, String(l.suggest).replace('.', ',')]));
  const consumed = Object.entries(fact).filter(([, v]) => Number(v.replace(',', '.')) > 0).map(([lotId, v]) => ({ lotId, quantity: v }));
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
          <ul className="list">{c.checks.map((x) => (
            <li key={x.id}>
              <div className="between"><div><b>{x.name}</b>: {x.limits}<div className="small muted">{x.basis}</div></div>
                {x.last ? <span className={`badge ${x.last.ok ? 'ok' : 'crit'}`}>{n(x.last.value)} {x.unit}</span> : <span className="badge warn">нет замера</span>}</div>
              {x.last && <div className="small muted">{x.last.recorded_by}, {dt(x.last.recorded_at, tz)}{x.last.incident_id && <> · <Link href={`/app/${org.id}/incidents/${x.last.incident_id}`}>отклонение</Link></>}</div>}
              {o.status === 'in_progress' && run_ && (
                <form className="row" style={{ marginTop: 6 }} onSubmit={(e) => { e.preventDefault(); run(async () => {
                  await api(`/orgs/${org.id}/production/${id}/checks`, { body: { checkId: x.id, value: (vals[x.id] || '').replace(',', '.') } }); setVals({ ...vals, [x.id]: '' }); await load();
                }); }}>
                  <input aria-label={`Замер: ${x.name}`} inputMode="decimal" required value={vals[x.id] || ''} onChange={(e) => setVals({ ...vals, [x.id]: e.target.value })} placeholder={x.unit} style={{ flex: 1 }} />
                  <button className="btn small" disabled={busy}>Записать</button>
                </form>)}
            </li>))}</ul>
        </div>
      )}

      {o.status === 'in_progress' && run_ && (
        <div className="card">
          <h2>Выпуск партии</h2>
          {blocked.length > 0 && <div className="note">Выпуск закрыт: нужен замер в пределах — {blocked.map((x) => x.name).join(', ')}.</div>}
          <form onSubmit={(e) => { e.preventDefault(); run(async () => {
            const r = await api<{ label_id: string }>(`/orgs/${org.id}/production/${id}/complete`, { body: { actualKg: actual, consumed, operationId: op.id, organoleptic: orgl || null, decision: decision || null } });
            op.next(); await load(); router.push(`/app/${org.id}/labels/print?ids=${r.label_id}`);
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
            <button className="btn block" disabled={busy || blocked.length > 0 || consumed.length === 0}>Выпустить партию и напечатать этикетку</button>
          </form>
        </div>
      )}

      {o.status === 'done' && c.lot && (
        <div className="card">
          <h2>Выпущено</h2>
          <dl className="kv">
            <dt>Партия</dt><dd><Link href={`/app/${org.id}/lots/${c.lot.id}`}>{c.lot.lot_no}</Link> · {n(c.lot.quantity)} {c.lot.unit}</dd>
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
