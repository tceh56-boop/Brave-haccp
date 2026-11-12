'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { d } from '@/lib/fmt';

interface Row { id: string; title: string; status: string; status_label: string; due_at: string | null; check_due_at: string | null; site_name: string | null; responsible: string | null; overdue: boolean; incident_id: string | null }

const TONE: Record<string, string> = { open: 'crit', in_progress: 'warn', verification: 'warn', closed: 'ok' };

/** CAPA: корректирующие и предупреждающие действия с проверкой эффективности. */
export default function CapaList() {
  const { org, sites, siteId, can } = useOrg();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [openOnly, setOpenOnly] = useState(true);
  const [f, setF] = useState<{ title: string; problem: string } | null>(null);
  const { busy, error, run } = useSubmit();
  useEffect(() => { api<Row[]>(`/orgs/${org.id}/capa${openOnly ? '?open=1' : ''}`).then(setRows); }, [org.id, openOnly]);
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}`}>← Управление</Link></p>
      <h1>CAPA</h1>
      <p className="small muted">Отклонение высокого и критического риска после закрытия открывает CAPA автоматически. Закрыть CAPA может только другой ответственный — после проверки эффективности.</p>
      <div className="chips">
        <button aria-pressed={openOnly} onClick={() => setOpenOnly(true)}>Открытые</button>
        <button aria-pressed={!openOnly} onClick={() => setOpenOnly(false)}>Все</button>
      </div>
      <div className="card">
        {!rows ? <p className="muted">Загрузка…</p> : rows.length === 0 ? <p className="muted">{openOnly ? 'Открытых CAPA нет.' : 'CAPA ещё не было.'}</p> : rows.map((r) => (
          <Link key={r.id} className="objrow" href={`/app/${org.id}/capa/${r.id}`}>
            <div><b>{r.title}</b>
              <div className="small muted">{[r.site_name, r.responsible, r.due_at ? `срок ${d(r.due_at, org.timezone)}` : ''].filter(Boolean).join(' · ') || 'ответственный не назначен'}</div></div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <span className={`badge ${TONE[r.status]}`}>{r.status_label}</span>{r.overdue && <span className="badge crit">просрочено</span>}<span aria-hidden>›</span>
            </div>
          </Link>
        ))}
      </div>
      {can('capa.manage') && (
        <div className="card">
          {error && <div className="err">{error}</div>}
          {!f ? <button className="btn block secondary" onClick={() => setF({ title: '', problem: '' })}>Новое CAPA без отклонения</button> : (
            <form onSubmit={(e) => { e.preventDefault(); run(async () => {
              const r = await api<{ id: string }>(`/orgs/${org.id}/capa`, { body: { ...f, siteId: sites.length > 1 ? siteId : sites[0]?.id || null } });
              location.assign(`/app/${org.id}/capa/${r.id}`);
            }); }}>
              <label htmlFor="ct">Название</label><input id="ct" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Например: пропуски ночных замеров" />
              <label htmlFor="cp">Проблема</label><textarea id="cp" rows={3} required value={f.problem} onChange={(e) => setF({ ...f, problem: e.target.value })} placeholder="Что выявлено: аудит, жалоба, повторяющиеся отклонения" />
              <button className="btn block" disabled={busy}>Открыть CAPA</button>
            </form>
          )}
        </div>
      )}
    </>
  );
}
