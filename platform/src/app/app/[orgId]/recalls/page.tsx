'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { api } from '@/lib/api';
import { dt } from '@/lib/fmt';

interface Row { id: string; status: string; hazard: string; source_label: string; opened_at: string; decision: string | null; product: string; lot_no: string | null }

/** Отзывы и блокировки партий (ТЗ 3.0 §10.5). Новая блокировка — с карточки партии. */
export default function Recalls() {
  const { org } = useOrg();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<Row[]>(`/orgs/${org.id}/recalls`).then(setRows).catch((e) => setErr(e.message)); }, [org.id]);
  return (
    <>
      <h1>Отзывы партий</h1>
      <p className="small muted">Чтобы заблокировать партию при опасности, откройте её карточку («Склад» → партия) и нажмите «Заблокировать партию».</p>
      {err && <div className="err">{err}</div>}
      {rows && rows.length === 0 && <p className="muted">Отзывов не было.</p>}
      {rows && rows.length > 0 && <div className="card"><ul className="list">{rows.map((r) => (
        <li key={r.id}>
          <div className="between"><Link href={`/app/${org.id}/recalls/${r.id}`}><b>{r.product}{r.lot_no ? `, партия ${r.lot_no}` : ''}</b></Link>
            <span className={`badge ${r.status === 'open' ? 'crit' : 'ok'}`}>{r.status === 'open' ? 'ждёт решения' : r.decision === 'release' ? 'возвращено' : 'списано'}</span></div>
          <div className="small">{r.hazard}</div>
          <div className="small muted">{r.source_label} · {dt(r.opened_at, org.timezone)}</div>
        </li>))}</ul></div>}
    </>
  );
}
