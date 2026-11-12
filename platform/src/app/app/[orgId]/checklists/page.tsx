'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useOrg } from '@/lib/org';
import { SitePicker } from '@/components/OrgNav';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';

interface Row { id: string; name: string; scope_key: string; version: number; status: string; sources: string[]; items: number; approved_by: string | null; today: { id: string; status: string; missing: number | null } | null }

/** Чек-листы площадки: из утверждённых ТТК (этапы на плане) и плана ХАССП (мониторинг). */
export default function Checklists() {
  const { org, siteId, can } = useOrg();
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const { busy, error, run, setError } = useSubmit();
  const load = useCallback(() => { if (siteId) api<Row[]>(`/orgs/${org.id}/checklists?siteId=${siteId}`).then(setRows).catch((e) => setError(e.message)); }, [org.id, siteId, setError]);
  useEffect(() => { load(); }, [load]);
  const approved = (rows || []).filter((r) => r.status === 'approved'), drafts = (rows || []).filter((r) => r.status === 'draft');
  return (
    <>
      <h1>Чек-листы</h1>
      <SitePicker />
      {error && <div className="err">{error}</div>}
      {msg && <div className="okbox">{msg}</div>}
      <div className="card">
        <h2>На сегодня</h2>
        {approved.length === 0 && <p className="small muted">Утверждённых чек-листов нет.</p>}
        <ul className="list">{approved.map((r) => (
          <li key={r.id}><div className="between"><b>{r.name}</b>
            {r.today?.status === 'closed' ? <span className={`badge ${r.today.missing ? 'warn' : 'ok'}`}>{r.today.missing ? `закрыт, пропусков ${r.today.missing}` : 'выполнен'}</span>
              : can('task.work') && <button className="btn small" disabled={busy} onClick={() => run(async () => { const x = await api<{ id: string }>(`/orgs/${org.id}/checklists/${r.id}/run`, { body: {} }); router.push(`/app/${org.id}/checklists/run/${x.id}`); })}>
                {r.today ? 'Продолжить' : 'Начать'}</button>}</div>
            <div className="small muted">пунктов {r.items} · версия {r.version} · <Link href={`/app/${org.id}/checklists/${r.id}`}>состав и источники</Link></div></li>))}</ul>
      </div>
      {(drafts.length > 0 || can('checklist.manage')) && <div className="card">
        <h2>Черновики</h2>
        <p className="small muted">Пункты берутся только из утверждённых источников: этапов ТТК с указанным контролем, привязанных к местам на плане площадки, и мониторинга плана ХАССП.
          Черновик проверяет и утверждает специалист; утверждённая версия не меняется.</p>
        <ul className="list">{drafts.map((r) => <li key={r.id}><Link href={`/app/${org.id}/checklists/${r.id}`}><b>{r.name}</b></Link> <span className="badge warn">черновик v{r.version}</span>
          <div className="small muted">пунктов {r.items} · источники: {r.sources.join(', ')}</div></li>)}</ul>
        {can('checklist.manage') && <button className="btn block" disabled={busy || !siteId} onClick={() => run(async () => {
          const x = await api<{ made: { name: string; items: number }[] }>(`/orgs/${org.id}/checklists`, { body: { siteId } });
          setMsg(`Сформировано черновиков: ${x.made.length} (${x.made.map((m) => `${m.name} — ${m.items}`).join('; ')}).`); load();
        })}>Сформировать из ТТК и плана ХАССП</button>}
      </div>}
    </>
  );
}
