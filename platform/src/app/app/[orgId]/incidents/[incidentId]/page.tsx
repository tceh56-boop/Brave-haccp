'use client';
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { dt, n } from '@/lib/fmt';
import { Evidence } from '@/components/Evidence';
import { AiPanel } from '@/components/AiAnswer';

interface Inc { incident: { id: string; title: string; what: string; status: string; status_label: string; severity: string; severity_label: string; rule_source: string | null; recommended_action: string | null;
  entity_type: string | null; entity_id: string | null; requires_confirmation: boolean; action_note: string | null; action_by: string | null; due_at: string | null; created_at: string };
  events: { at: string; event: string; note: string | null; who: string | null }[]; lots: { id: string; product: string; lot_no: string | null; quantity: string; unit: string; status: string }[]; allowIsolation: boolean;
  capa: { id: string; status: string } | null }

const EVENT: Record<string, string> = { created: 'Создано', repeat: 'Повторное отклонение', remeasure_ok: 'Повторный замер', taken: 'Взято в работу', action: 'Действие', confirmed: 'Закрытие подтверждено', returned: 'Возвращено на доработку' };

/** Карточка отклонения (ТЗ v2 §2, §5): что случилось, основание, рекомендуемое действие, затронутые партии, ход работы. */
export default function IncidentPage({ params }: { params: Promise<{ incidentId: string }> }) {
  const { incidentId } = use(params);
  const { org, me, can } = useOrg();
  const [c, setC] = useState<Inc | null>(null);
  const [note, setNote] = useState('');
  const [isolate, setIsolate] = useState(false);
  const { busy, error, run, setError } = useSubmit();
  const load = useCallback(() => api<Inc>(`/orgs/${org.id}/incidents/${incidentId}`).then(setC).catch((e) => setError(e.message)), [org.id, incidentId, setError]);
  useEffect(() => { load(); }, [load]);
  if (!c) return error ? <div className="err">{error}</div> : <p className="muted">Загрузка…</p>;
  const i = c.incident, tz = org.timezone;
  const op = (name: string, body: unknown = {}) => run(async () => {
    await api(`/orgs/${org.id}/incidents/${incidentId}/${name}`, { body });
    if (name !== 'take') { setNote(''); setIsolate(false); }
    await load();
  });
  const objHref = i.entity_type === 'control_object' ? `/app/${org.id}/objects/${i.entity_id}` : i.entity_type === 'lot' ? `/app/${org.id}/lots/${i.entity_id}` : i.entity_type === 'production_order' ? `/app/${org.id}/production/${i.entity_id}` : null;
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/problems`}>← Проблемы</Link></p>
      <h1 style={{ marginBottom: 4 }}>{i.title}</h1>
      <p className="row" style={{ marginTop: 0 }}><span className={`badge ${i.status === 'closed' ? 'ok' : 'crit'}`}>{i.status_label}</span><span className="badge">{i.severity_label}</span></p>
      <div className="card">
        <p style={{ marginTop: 0 }}>{i.what}</p>
        <dl className="kv">
          <dt>Создано</dt><dd>{dt(i.created_at, tz)}</dd>
          {i.due_at && i.status !== 'closed' && <><dt>Срок реакции</dt><dd>{dt(i.due_at, tz)}</dd></>}
          {i.rule_source && <><dt>Основание</dt><dd className="small">{i.rule_source}</dd></>}
        </dl>
        {i.recommended_action && <div className="note"><b>Что сделать:</b> {i.recommended_action}</div>}
        {objHref && <Link className="btn secondary small" href={objHref}>Открыть объект</Link>}
      </div>

      {c.lots.length > 0 && (
        <div className="card">
          <h2>Затронутые партии</h2>
          <ul className="list">{c.lots.map((l) => <li key={l.id} className="between"><Link href={`/app/${org.id}/lots/${l.id}`}>{l.product}{l.lot_no ? ` · ${l.lot_no}` : ''}</Link>
            <span className="row"><span className="small">{n(l.quantity)} {l.unit}</span>{l.status === 'quarantine' && <span className="badge crit">карантин</span>}</span></li>)}</ul>
        </div>
      )}

      {i.status !== 'closed' && (
        <div className="card">
          {error && <div className="err" role="alert">{error}</div>}
          {i.status === 'new' && can('incident.work') && <button className="btn block" disabled={busy} onClick={() => op('take')}>Взять в работу</button>}
          {(i.status === 'new' || i.status === 'in_progress') && can('incident.work') && (
            <form onSubmit={(e) => { e.preventDefault(); op('action', { note, isolateLots: isolate }); }}>
              <label htmlFor="an">Что сделано</label>
              <textarea id="an" rows={3} required value={note} onChange={(e) => setNote(e.target.value)} placeholder="Например: дверь закрыта, уплотнитель заменён, повторный замер 4 °C" />
              {c.allowIsolation && c.lots.some((l) => l.status === 'available') && (
                <label className="row" style={{ fontWeight: 400 }}><input type="checkbox" style={{ width: 22, minHeight: 22 }} checked={isolate} onChange={(e) => setIsolate(e.target.checked)} /> Изолировать затронутые продукты (предусмотрено процедурой)</label>
              )}
              <button className="btn block" disabled={busy}>Записать действие</button>
              {i.requires_confirmation && <p className="small muted">После записи закрытие подтверждает другой ответственный.</p>}
            </form>
          )}
          {i.status === 'pending_review' && (
            <>
              <div className="note"><b>Сделано:</b> {i.action_note}</div>
              {can('incident.confirm') && i.action_by !== me.id ? (
                <div className="grid2">
                  <button className="btn block" disabled={busy} onClick={() => op('confirm', { note: note || null })}>Подтвердить закрытие</button>
                  <button className="btn block secondary" disabled={busy} onClick={() => { const r = prompt('Что нужно доделать?'); if (r) op('return', { note: r }); }}>Вернуть</button>
                </div>
              ) : <p className="small muted">Ожидает подтверждения другим ответственным.</p>}
            </>
          )}
          {!can('incident.work') && i.status !== 'pending_review' && <p className="small muted">Ответственный уведомлён. Если ситуация меняется — <Link href={`/app/${org.id}/report?entityType=${i.entity_type || ''}&entityId=${i.entity_id || ''}`}>сообщите</Link>.</p>}
        </div>
      )}

      {c.capa ? (
        <div className="card between"><span>CAPA: причина, предупреждение, проверка эффективности</span><Link className="btn small secondary" href={`/app/${org.id}/capa/${c.capa.id}`}>Открыть CAPA</Link></div>
      ) : can('capa.manage') && (
        <div className="card">
          <button className="btn block secondary" disabled={busy} onClick={() => run(async () => {
            const r = await api<{ id: string }>(`/orgs/${org.id}/capa`, { body: { incidentId } });
            location.assign(`/app/${org.id}/capa/${r.id}`);
          })}>Открыть CAPA по этому отклонению</button>
        </div>
      )}

      <AiPanel kind="incidents" entityId={incidentId} />

      <Evidence entityType="incident" entityId={incidentId} />

      <div className="card">
        <h2>Ход работы</h2>
        <ul className="timeline">{c.events.map((e, k) => <li key={k}><b>{EVENT[e.event] || e.event}</b> · <span className="small muted">{dt(e.at, tz)}{e.who ? ` · ${e.who}` : ''}</span>{e.note && <div>{e.note}</div>}</li>)}</ul>
      </div>
    </>
  );
}
