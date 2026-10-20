'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { SitePicker } from '@/components/OrgNav';
import { api } from '@/lib/api';
import { n, ago } from '@/lib/fmt';

interface Obj { id: string; name: string; kind_label: string; criterion: string | null; last: { value: string; unit: string; measured_at: string; result: string } | null; due: { state: string } }
interface Shift { site: { name: string }; objects: Obj[]; myTasks: number; openIncidents: number }

const DUE: Record<string, [string, string]> = { ok: ['в норме по графику', 'ok'], due: ['пора замерить', 'warn'], missed: ['пропущен замер', 'crit'], no_schedule: ['', ''] };

/** Главный экран сотрудника (ТЗ v2 §1, §3): только задачи смены, приёмка, замеры, сроки и «сообщить о проблеме». */
export default function ShiftPage() {
  const { org, siteId, can } = useOrg();
  const [s, setS] = useState<Shift | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { if (siteId) api<Shift>(`/orgs/${org.id}/sites/${siteId}/shift`).then(setS).catch((e) => setErr(e.message)); }, [org.id, siteId]);
  useEffect(() => { load(); }, [load]);
  if (!siteId) return <p className="muted">Нет доступных площадок.</p>;
  if (err) return <div className="err">{err}</div>;
  const base = `/app/${org.id}`;
  const missed = s?.objects.filter((o) => o.due.state === 'missed' || o.due.state === 'due').length || 0;
  return (
    <>
      <SitePicker />
      <h1>{s?.site.name || 'Смена'}</h1>
      <div className="tiles">
        {can('receipt.record') && <Link className="tile primary" href={`${base}/receipts/new`}>Приёмка<span className="sub">товар, партия, проверки</span></Link>}
        <a className={`tile ${missed ? 'alert' : ''}`} href="#temps">Температура<span className="sub">{missed ? `ждут замера: ${missed}` : 'по графику'}</span></a>
        <Link className="tile" href={`${base}/lots`}>Сроки<span className="sub">годность партий</span></Link>
        <Link className="tile" href={`${base}/tasks`}>Задачи<span className="sub">{s ? `открыто: ${s.myTasks}` : '…'}</span></Link>
        <Link className={`tile ${s?.openIncidents ? 'alert' : ''}`} href={`${base}/problems`}>Проблемы<span className="sub">{s ? (s.openIncidents ? `открыто: ${s.openIncidents}` : 'нет открытых') : '…'}</span></Link>
        <Link className="tile" href={`${base}/report`}>Сообщить<span className="sub">о проблеме</span></Link>
      </div>
      <div className="card" id="temps">
        <h2>Температура</h2>
        {!s ? <p className="muted">Загрузка…</p> : s.objects.length === 0 ? <p className="muted">Объекты контроля ещё не заведены. Их добавляет ответственный в разделе «Управление».</p> : (
          <div>
            {s.objects.map((o) => (
              <Link key={o.id} className="objrow" href={`${base}/objects/${o.id}`}>
                <div>
                  <b>{o.name}</b>
                  <div className="small muted">{o.criterion ? `предел ${o.criterion}` : 'критерий не утверждён'}</div>
                  {o.last && <div className="small">последний: {n(o.last.value)} {o.last.unit}, {ago(o.last.measured_at)}</div>}
                </div>
                <div className="row">
                  {o.last?.result === 'deviation' && <span className="badge crit">вне предела</span>}
                  {DUE[o.due.state]?.[0] && <span className={`badge ${DUE[o.due.state][1]}`}>{DUE[o.due.state][0]}</span>}
                  <span aria-hidden>›</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
