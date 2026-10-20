'use client';
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { Evidence } from '@/components/Evidence';
import { api } from '@/lib/api';
import { d, dt } from '@/lib/fmt';

interface Capa { id: string; title: string; problem: string; risk: string | null; root_cause: string | null; corrective_action: string | null; preventive_action: string | null;
  effectiveness_criterion: string | null; responsible_user_id: string | null; responsible: string | null; due_at: string | null; check_due_at: string | null; status: string; status_label: string;
  done_note: string | null; done_by: string | null; done_by_name: string | null; done_at: string | null; verified_by_name: string | null; verified_at: string | null; verification_note: string | null;
  incident_id: string | null; incident_title: string | null; site_name: string | null }
interface Data { capa: Capa; events: { at: string; event: string; note: string | null; who: string | null }[]; members: { id: string; full_name: string }[] }

const EVENT: Record<string, string> = { created: 'Открыто', updated: 'Изменено', done: 'Выполнено, на проверку', effective: 'Эффективно — закрыто', ineffective: 'Неэффективно — снова в работу' };
const day = (v: string | null) => (v ? String(v).slice(0, 10) : '');

/** Карточка CAPA: причина → действия → исполнение → проверка эффективности другим человеком. */
export default function CapaPage({ params }: { params: Promise<{ capaId: string }> }) {
  const { capaId } = use(params);
  const { org, me, can } = useOrg();
  const [data, setData] = useState<Data | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const { busy, error, run, setError } = useSubmit();
  const load = useCallback(() => api<Data>(`/orgs/${org.id}/capa/${capaId}`).then((r) => {
    setData(r);
    const c = r.capa;
    setF({ risk: c.risk || '', rootCause: c.root_cause || '', correctiveAction: c.corrective_action || '', preventiveAction: c.preventive_action || '', effectivenessCriterion: c.effectiveness_criterion || '',
      responsibleUserId: c.responsible_user_id || '', dueAt: day(c.due_at), checkDueAt: day(c.check_due_at) });
  }).catch((e) => setError(e.message)), [org.id, capaId, setError]);
  useEffect(() => { load(); }, [load]);
  if (!data) return error ? <div className="err">{error}</div> : <p className="muted">Загрузка…</p>;
  const c = data.capa, tz = org.timezone;
  const editable = can('capa.manage') && (c.status === 'open' || c.status === 'in_progress');
  const field = (key: string, label: string, rows = 2, hint?: string) => (
    <div><label htmlFor={key}>{label}</label><textarea id={key} rows={rows} value={f[key] || ''} disabled={!editable} onChange={(e) => setF({ ...f, [key]: e.target.value })} placeholder={hint} /></div>
  );
  const op = (path: string, body: unknown) => run(async () => { await api(`/orgs/${org.id}/capa/${capaId}/${path}`, { body }); setNote(''); await load(); });
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/capa`}>← CAPA</Link></p>
      <h1 style={{ marginBottom: 4 }}>{c.title}</h1>
      <p className="row" style={{ marginTop: 0 }}><span className={`badge ${c.status === 'closed' ? 'ok' : 'warn'}`}>{c.status_label}</span>{c.site_name && <span className="badge">{c.site_name}</span>}</p>
      <div className="card">
        <p style={{ marginTop: 0, whiteSpace: 'pre-line' }}>{c.problem}</p>
        {c.incident_id && <Link className="btn small secondary" href={`/app/${org.id}/incidents/${c.incident_id}`}>Отклонение: {c.incident_title}</Link>}
      </div>
      {error && <div className="err" role="alert">{error}</div>}
      <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => {
        await api(`/orgs/${org.id}/capa/${capaId}`, { method: 'PATCH', body: { ...f, responsibleUserId: f.responsibleUserId || null, dueAt: f.dueAt || null, checkDueAt: f.checkDueAt || null } });
        await load();
      }); }}>
        <h2>Анализ и действия</h2>
        {field('risk', 'Риск', 2, 'Чем опасно для продукции и гостей')}
        {field('rootCause', 'Причина (корневая)', 3, 'Почему произошло — не «сотрудник ошибся», а что в процессе это допустило')}
        {field('correctiveAction', 'Корректирующее действие', 3, 'Что устраняет причину')}
        {field('preventiveAction', 'Предупреждающее действие', 3, 'Что не даст повториться: график, обучение, изменение процедуры')}
        {field('effectivenessCriterion', 'Критерий эффективности', 2, 'Как поймём, что помогло: например, нет отклонений 14 дней')}
        <div className="grid2">
          <div><label htmlFor="ru">Ответственный</label><select id="ru" disabled={!editable} value={f.responsibleUserId} onChange={(e) => setF({ ...f, responsibleUserId: e.target.value })}>
            <option value="">— не назначен —</option>{data.members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}</select></div>
          <div><label htmlFor="du">Срок выполнения</label><input id="du" type="date" disabled={!editable} value={f.dueAt} onChange={(e) => setF({ ...f, dueAt: e.target.value })} /></div>
          <div><label htmlFor="cd">Проверить эффективность</label><input id="cd" type="date" disabled={!editable} value={f.checkDueAt} onChange={(e) => setF({ ...f, checkDueAt: e.target.value })} /></div>
        </div>
        {editable && <button className="btn block secondary" disabled={busy}>Сохранить</button>}
      </form>

      {editable && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); op('complete', { note }); }}>
          <h2>Выполнено</h2>
          <label htmlFor="dn">Что сделано</label>
          <textarea id="dn" rows={2} required value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn block" disabled={busy}>Отправить на проверку эффективности</button>
          <p className="small muted">Нужны причина, корректирующее действие и критерий эффективности. Проверяет другой ответственный.</p>
        </form>
      )}

      {c.status === 'verification' && (
        <div className="card">
          <h2>Проверка эффективности</h2>
          <div className="note"><b>Выполнено:</b> {c.done_note} <span className="small muted">({c.done_by_name}, {dt(c.done_at, tz)})</span></div>
          <p className="small"><b>Критерий:</b> {c.effectiveness_criterion}{c.check_due_at ? ` · проверить ${d(c.check_due_at, tz)}` : ''}</p>
          {can('capa.verify') && c.done_by !== me.id ? (
            <>
              <label htmlFor="vn">Что проверено и чем подтверждено</label>
              <textarea id="vn" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Например: по J01 за 14 дней отклонений нет" />
              <div className="grid2">
                <button className="btn block" disabled={busy || note.trim().length < 5} onClick={() => op('verify', { effective: true, note })}>Эффективно — закрыть</button>
                <button className="btn block secondary" disabled={busy || note.trim().length < 5} onClick={() => op('verify', { effective: false, note })}>Неэффективно</button>
              </div>
            </>
          ) : <p className="small muted">Проверяет другой ответственный — не тот, кто выполнял.</p>}
        </div>
      )}
      {c.status === 'closed' && <div className="okbox">Закрыто: эффективность подтвердил {c.verified_by_name}, {dt(c.verified_at, tz)} — {c.verification_note}</div>}

      <Evidence entityType="capa" entityId={capaId} />

      <div className="card">
        <h2>История</h2>
        <ul className="timeline">{data.events.map((e, k) => <li key={k}><b>{EVENT[e.event] || e.event}</b> · <span className="small muted">{dt(e.at, tz)}{e.who ? ` · ${e.who}` : ''}</span>{e.note && <div>{e.note}</div>}</li>)}</ul>
      </div>
    </>
  );
}
