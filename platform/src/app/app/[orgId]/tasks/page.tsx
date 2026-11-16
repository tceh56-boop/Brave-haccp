'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { dt } from '@/lib/fmt';

interface Task { id: string; title: string; details: string | null; due_at: string | null; overdue: boolean; href: string; action: string; manual: boolean; site_name: string | null }

export default function TasksPage() {
  const { org, role } = useOrg();
  const manager = ['owner', 'enterprise_admin', 'director', 'chef', 'haccp_lead'].includes(role);
  const [all, setAll] = useState(false);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const { error, run } = useSubmit();
  const load = useCallback(() => api<Task[]>(`/orgs/${org.id}/tasks${all ? '?all=1' : ''}`).then(setTasks), [org.id, all]);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <h1>Задачи</h1>
      {manager && <div className="chips"><button aria-pressed={!all} onClick={() => setAll(false)}>Мои</button><button aria-pressed={all} onClick={() => setAll(true)}>Все по предприятию</button></div>}
      {error && <div className="err">{error}</div>}
      <div className="card">
        {!tasks ? <p className="muted">Загрузка…</p> : tasks.length === 0 ? <p className="muted">Открытых задач нет.</p> : (
          <ul className="list">{tasks.map((t) => (
            <li key={t.id} id={t.id}>
              <div className="between">
                <div><b>{t.title}</b>{t.details && <div className="small muted">{t.details}</div>}
                  <div className="small">{t.site_name}{t.due_at ? ` · срок ${dt(t.due_at, org.timezone)}` : ''}</div></div>
                {t.overdue && <span className="badge crit">просрочено</span>}
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                {!t.manual || t.href.includes('/lots/') || t.href.includes('/incidents/') || t.href.includes('/objects/')
                  ? <Link className="btn small" href={t.href}>{t.action}</Link>
                  : <button className="btn small" onClick={() => { const r = prompt('Результат выполнения:'); if (r) run(async () => { await api(`/orgs/${org.id}/tasks/${t.id}/complete`, { body: { result: r } }); await load(); }); }}>Выполнено</button>}
              </div>
            </li>
          ))}</ul>
        )}
      </div>
    </>
  );
}
