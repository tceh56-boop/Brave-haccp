'use client';
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { dt, n } from '@/lib/fmt';

interface Item { id: string; position: number; action: string; object: string | null; criterion: string | null; kind: string; unit: string | null; min_value: number | null; max_value: number | null;
  frequency: string | null; responsible: string | null; source_ref: string }
interface Data { template: { id: string; name: string; version: number; status: string; sources: string[]; approved_at: string | null; approved_by_name: string | null }; items: Item[] }
const KIND: Record<string, string> = { check: 'отметка', measure: 'измерение', observe: 'наблюдение' };
const limits = (i: { min_value: number | null; max_value: number | null; unit: string | null }) =>
  [i.min_value !== null ? `не ниже ${n(i.min_value)}` : '', i.max_value !== null ? `не выше ${n(i.max_value)}` : ''].filter(Boolean).join(', ') + (i.unit ? ` ${i.unit}` : '');

/** Состав чек-листа: пункт — действие, объект, критерий, вид, периодичность, ответственный, источник с версией. */
export default function ChecklistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { org, can } = useOrg();
  const [d, setD] = useState<Data | null>(null);
  const { busy, error, run, setError } = useSubmit();
  const load = useCallback(() => api<Data>(`/orgs/${org.id}/checklists/${id}`).then(setD).catch((e) => setError(e.message)), [org.id, id, setError]);
  useEffect(() => { load(); }, [load]);
  if (!d) return error ? <div className="err">{error}</div> : <p className="muted">Загрузка…</p>;
  const t = d.template;
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/checklists`}>← Чек-листы</Link></p>
      <h1 style={{ marginBottom: 4 }}>{t.name}</h1>
      <p style={{ marginTop: 0 }}><span className={`badge ${t.status === 'approved' ? 'ok' : 'warn'}`}>{t.status === 'approved' ? `утверждён ${t.approved_by_name}, ${dt(t.approved_at!, org.timezone)}` : t.status === 'draft' ? 'черновик' : 'архив'}</span>
        <span className="small muted"> · версия {t.version} · источники: {t.sources.join(', ')}</span></p>
      {error && <div className="err">{error}</div>}
      <div className="card"><div className="scroll"><table className="tbl small">
        <thead><tr><th>№</th><th>Действие</th><th>Объект</th><th>Критерий</th><th>Вид</th><th>Периодичность</th><th>Кто</th><th>Источник</th></tr></thead>
        <tbody>{d.items.map((i) => <tr key={i.id}><td>{i.position}</td><td>{i.action}</td><td>{i.object || '—'}</td>
          <td>{i.kind === 'measure' ? limits(i) : i.criterion || '—'}{i.kind === 'measure' && i.criterion ? <div className="muted">{i.criterion}</div> : null}</td>
          <td>{KIND[i.kind]}</td><td>{i.frequency || '—'}</td><td>{i.responsible || '—'}</td><td className="muted">{i.source_ref}</td></tr>)}</tbody></table></div></div>
      {t.status === 'draft' && can('checklist.approve') && <button className="btn block" disabled={busy} onClick={() => run(async () => { await api(`/orgs/${org.id}/checklists/${id}/approve`, { body: {} }); await load(); })}>Утвердить чек-лист</button>}
    </>
  );
}
