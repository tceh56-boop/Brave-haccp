'use client';
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { dt, n } from '@/lib/fmt';

interface Item { id: string; position: number; action: string; object: string | null; criterion: string | null; kind: string; unit: string | null; min_value: number | null; max_value: number | null;
  responsible: string | null; source_ref: string; done: boolean | null; value: number | null; observation: string | null; ok: boolean | null; comment: string | null; event_at: string | null; done_by: string | null; incident_id: string | null }
interface Data { run: { id: string; name: string; version: number; status: string; run_date: string; missing: number | null }; items: Item[] }
const limits = (i: Item) => [i.min_value !== null ? `не ниже ${n(i.min_value)}` : '', i.max_value !== null ? `не выше ${n(i.max_value)}` : ''].filter(Boolean).join(', ') + (i.unit ? ` ${i.unit}` : '');

/** Выполнение чек-листа с телефона: отметка, фактическое измерение или наблюдение; запись не меняется. */
export default function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params);
  const { org } = useOrg();
  const [d, setD] = useState<Data | null>(null);
  const [val, setVal] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const { busy, error, run, setError } = useSubmit();
  const load = useCallback(() => api<Data>(`/orgs/${org.id}/checklist-runs/${runId}`).then(setD).catch((e) => setError(e.message)), [org.id, runId, setError]);
  useEffect(() => { load(); }, [load]);
  if (!d) return error ? <div className="err">{error}</div> : <p className="muted">Загрузка…</p>;
  const open = d.run.status === 'open', left = d.items.filter((i) => i.done === null).length;
  const send = (i: Item, done: boolean) => run(async () => {
    const r = await api<{ ok: boolean | null; incident_id: string | null }>(`/orgs/${org.id}/checklist-runs/${runId}/item`, { body: {
      itemId: i.id, done, value: i.kind === 'measure' && done ? (val[i.id] || '').replace(',', '.') || null : null, observation: i.kind === 'observe' && done ? val[i.id] || null : null, comment: done ? null : val[`c${i.id}`] || null } });
    setMsg(r.ok === false ? `«${i.action}»: значение вне предела — создано отклонение ответственному.` : null); await load();
  });
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/checklists`}>← Чек-листы</Link></p>
      <h1 style={{ marginBottom: 4 }}>{d.run.name}</h1>
      <p className="small muted" style={{ marginTop: 0 }}>{String(d.run.run_date).slice(0, 10)} · версия {d.run.version} · {open ? `осталось ${left}` : `закрыт${d.run.missing ? `, пропусков ${d.run.missing}` : ''}`}</p>
      {error && <div className="err" role="alert">{error}</div>}
      {msg && <div className="err" role="alert">{msg}</div>}
      <ul className="list">{d.items.map((i) => (
        <li key={i.id} className="card" style={{ marginBottom: 8 }}>
          <div className="between"><b>{i.position}. {i.action}</b>
            {i.done !== null && <span className={`badge ${!i.done || i.ok === false ? 'crit' : 'ok'}`}>{!i.done ? 'не выполнено' : i.ok === false ? 'вне предела' : 'выполнено'}</span>}</div>
          <div className="small">{i.object ? `${i.object} · ` : ''}{i.kind === 'measure' ? `предел: ${limits(i)}` : i.criterion}</div>
          <div className="small muted">{i.responsible ? `${i.responsible} · ` : ''}{i.source_ref}</div>
          {i.done !== null ? <div className="small">{i.value !== null ? `${n(i.value)} ${i.unit} · ` : ''}{i.observation ? `${i.observation} · ` : ''}{i.comment ? `${i.comment} · ` : ''}{i.done_by}, {dt(i.event_at!, org.timezone)}
            {i.incident_id && <> · <Link href={`/app/${org.id}/incidents/${i.incident_id}`}>отклонение</Link></>}</div>
            : open && <div style={{ marginTop: 6 }}>
              {i.kind === 'measure' && <input aria-label={`Значение: ${i.action}`} inputMode="decimal" placeholder={`факт, ${i.unit}`} value={val[i.id] || ''} onChange={(e) => setVal({ ...val, [i.id]: e.target.value })} />}
              {i.kind === 'observe' && <input aria-label={`Наблюдение: ${i.action}`} placeholder="что фактически наблюдали или измерили" value={val[i.id] || ''} onChange={(e) => setVal({ ...val, [i.id]: e.target.value })} />}
              <div className="row" style={{ marginTop: 4 }}>
                <button className="btn small" disabled={busy || (i.kind !== 'check' && !(val[i.id] || '').trim())} onClick={() => send(i, true)}>Выполнено</button>
                <input aria-label={`Причина: ${i.action}`} placeholder="если не выполнено — причина" value={val[`c${i.id}`] || ''} onChange={(e) => setVal({ ...val, [`c${i.id}`]: e.target.value })} style={{ flex: 1 }} />
                <button className="btn small secondary" disabled={busy || (val[`c${i.id}`] || '').trim().length < 3} onClick={() => send(i, false)}>Не выполнено</button>
              </div>
            </div>}
        </li>))}</ul>
      {open && <button className="btn block" disabled={busy} onClick={() => run(async () => { const r = await api<{ missing: number }>(`/orgs/${org.id}/checklist-runs/${runId}/close`, { body: {} }); setMsg(r.missing ? `Закрыт: пропусков ${r.missing} — поставлена задача шефу.` : null); await load(); })}>
        Закрыть чек-лист{left ? ` (не отмечено ${left})` : ''}</button>}
      <p className="small muted">Отметка не меняется после внесения. Измерение — только фактическое значение; вне предела — отклонение. Неотмеченные пункты при закрытии становятся задачей.</p>
    </>
  );
}
