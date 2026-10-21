'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { d } from '@/lib/fmt';

export interface Citation { id: string; code: string; title: string; clause: string; edition: string; state_label: string; last_checked_at: string | null; next_check_at: string | null; text: string; quote?: string }
export interface AiResult {
  job_id: string; status: string; message: string | null; model: string | null;
  answer: { found: string; why: string; do_now: string[]; dont: string[]; who_confirms: string; closes_when: string; limitations: string; confidence: 'low' | 'medium' | 'high' } | null;
  citations: Citation[]; sources: Citation[]; unsupported: string[]; bad_citations: { source: string; quote: string; reason: string }[];
}

const CONF: Record<string, [string, string]> = { high: ['высокая', 'ok'], medium: ['средняя', 'warn'], low: ['низкая', 'crit'] };
const ROLES: [string, string][] = [['haccp_lead', 'Ответственный ХАССП'], ['chef', 'Шеф'], ['line_staff', 'Сотрудник цеха'], ['technologist', 'Технолог'], ['storekeeper', 'Кладовщик'], ['director', 'Директор']];

/** Реквизиты источника — обязательная часть нормативной рекомендации (ТЗ v2 AT-07). */
export function CitationCard({ c }: { c: Citation }) {
  const { org } = useOrg();
  return (
    <div className="note" style={{ marginTop: 6 }}>
      <b>{c.code}, {c.clause}</b> <span className="small">— {c.title}</span>
      <div className="small">{/^ред/i.test(c.edition) ? c.edition : `ред. ${c.edition}`} · {c.state_label}{c.last_checked_at ? ` · проверено ${d(c.last_checked_at, org.timezone)}` : ''}{c.next_check_at ? ` · след. проверка ${d(c.next_check_at, org.timezone)}` : ''}</div>
      {c.quote ? <blockquote style={{ margin: '6px 0 0', paddingLeft: 10, borderLeft: '3px solid var(--line)' }}>«{c.quote}»</blockquote> : <div className="small" style={{ marginTop: 4 }}>{c.text}</div>}
    </div>
  );
}

/** Ответ AI в формате ТЗ v2 §11; предложенное действие становится задачей только по решению человека. */
export function AiAnswerView({ r }: { r: AiResult }) {
  const { org, can } = useOrg();
  const [decided, setDecided] = useState<Record<number, string>>({});
  const [role, setRole] = useState('haccp_lead');
  const [fb, setFb] = useState<string | null>(null);
  const { busy, error, run } = useSubmit();
  const a = r.answer;
  const decideItem = (i: number, decision: 'task_created' | 'rejected') => run(async () => {
    let note: string | null = null;
    if (decision === 'rejected') { note = prompt('Почему не подходит?'); if (!note) return; }
    await api(`/orgs/${org.id}/ai/jobs/${r.job_id}/decide`, { body: { itemIndex: i, decision, assigneeRole: decision === 'task_created' ? role : undefined, note } });
    setDecided({ ...decided, [i]: decision === 'task_created' ? 'задача создана' : 'отклонено' });
  });
  return (
    <div className="card">
      <div className="between"><h2 style={{ margin: 0 }}>AI-помощник</h2>{a && <span className={`badge ${CONF[a.confidence][1]}`}>уверенность: {CONF[a.confidence][0]}</span>}</div>
      <p className="small muted">AI объясняет и предлагает. Решения принимает ответственный; AI ничего не утверждает, не закрывает и не списывает.</p>
      {error && <div className="err">{error}</div>}
      {r.message && <div className={r.status === 'unavailable' ? 'note' : 'err'}>{r.message}</div>}
      {r.unsupported.length > 0 && <p className="small">Значения без источника: {r.unsupported.join(', ')}.</p>}
      {a && (
        <>
          <h3>Что обнаружено</h3><p>{a.found}</p>
          <h3>Почему важно</h3><p>{a.why}</p>
          <h3>Что сделать сейчас</h3>
          {can('task.read') && a.do_now.length > 0 && (
            <div className="row small" style={{ marginBottom: 6 }}>Задачу назначить:
              <select aria-label="Исполнитель задачи" value={role} onChange={(e) => setRole(e.target.value)} style={{ width: 'auto' }}>{ROLES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          )}
          <ul className="list">{a.do_now.map((x, i) => (
            <li key={i} className="between"><span>{x}</span>
              {decided[i] ? <span className="badge">{decided[i]}</span> : (
                <span className="row" style={{ flexWrap: 'nowrap' }}>
                  <button className="btn small" disabled={busy} onClick={() => decideItem(i, 'task_created')}>В задачу</button>
                  <button className="btn small secondary" disabled={busy} onClick={() => decideItem(i, 'rejected')} aria-label={`Отклонить: ${x}`}>✕</button>
                </span>
              )}</li>
          ))}</ul>
          {a.dont.length > 0 && <><h3>Нельзя до решения</h3><ul style={{ margin: 0, paddingLeft: 18 }}>{a.dont.map((x) => <li key={x}>{x}</li>)}</ul></>}
          <dl className="kv" style={{ marginTop: 10 }}><dt>Подтверждает</dt><dd>{a.who_confirms}</dd><dt>Закроет проблему</dt><dd>{a.closes_when}</dd></dl>
          <h3>Источник</h3>
          {r.citations.length ? r.citations.map((c, i) => <CitationCard key={i} c={c} />) : <p className="small muted">Ответ без ссылки на утверждённое требование — относитесь к нему как к подсказке, а не к норме.</p>}
          {r.bad_citations.length > 0 && <p className="small">Отброшены недостоверные ссылки: {r.bad_citations.map((b) => `${b.source} (${b.reason})`).join('; ')}.</p>}
          <h3>Ограничения</h3><p className="small">{a.limitations}</p>
          {fb ? <p className="small muted">{fb}</p> : (
            <div className="row small">Ответ помог?
              <button className="btn small secondary" disabled={busy} onClick={() => run(async () => { await api(`/orgs/${org.id}/ai/jobs/${r.job_id}/decide`, { body: { decision: 'helpful' } }); setFb('Спасибо.'); })}>Да</button>
              <button className="btn small secondary" disabled={busy} onClick={() => run(async () => { await api(`/orgs/${org.id}/ai/jobs/${r.job_id}/decide`, { body: { decision: 'not_helpful' } }); setFb('Учтём.'); })}>Нет</button>
            </div>
          )}
        </>
      )}
      {!a && r.sources.length > 0 && (<><h3>Требования в реестре по теме</h3>{r.sources.map((c) => <CitationCard key={c.id} c={c} />)}</>)}
      {r.model && <p className="small muted" style={{ marginTop: 10 }}>Модель: {r.model}. <Link href={`/app/${org.id}/assistant/${r.job_id}`}>Запись в журнале →</Link></p>}
    </div>
  );
}

/** Кнопка «Объяснить с AI» для карточки отклонения или CAPA. */
export function AiPanel({ kind, entityId }: { kind: 'incidents' | 'capa'; entityId: string }) {
  const { org, can } = useOrg();
  const [r, setR] = useState<AiResult | null>(null);
  const { busy, error, run } = useSubmit();
  if (!can('ai.use')) return null;
  if (r) return <AiAnswerView r={r} />;
  return (
    <div className="card">
      {error && <div className="err">{error}</div>}
      <button className="btn block secondary" disabled={busy} onClick={() => run(async () => setR(await api<AiResult>(`/orgs/${org.id}/ai/${kind}/${entityId}`, { body: {} })))}>
        {busy ? 'AI думает…' : kind === 'incidents' ? 'Объяснить с AI и подсказать, что делать' : 'Предложить причины и действия (AI)'}
      </button>
      <p className="small muted">Ответ — только по данным системы и утверждённым требованиям реестра, со ссылкой на пункт и редакцию.</p>
    </div>
  );
}
