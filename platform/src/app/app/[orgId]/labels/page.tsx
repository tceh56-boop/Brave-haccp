'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { SitePicker } from '@/components/OrgNav';
import { api } from '@/lib/api';
import { dt } from '@/lib/fmt';

/** Журнал маркировки: каждая печать этикеток — что, сколько, в каком формате, кто. Записи не меняются. */

interface Row { id: string; printed_at: string; copies: number; format: string; printed_by: string; label_id: string; code: string; kind: string; lot_id: string; product: string; lot_no: string | null; expires_at: string | null; warning: string | null }
const FMT: Record<string, string> = { '58x40': '58×40', '58x30': '58×30', a4: 'A4' };

export default function LabelsPage() {
  const { org, siteId } = useOrg();
  const [days, setDays] = useState(7);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (siteId) api<Row[]>(`/orgs/${org.id}/labels/log?siteId=${siteId}&days=${days}`).then(setRows).catch((e) => setErr(e.message)); }, [org.id, siteId, days]);
  const tz = org.timezone;
  return (
    <>
      <h1>Маркировка</h1>
      <p className="small muted">Этикетка печатается из карточки партии: «Этикетка» или «Вскрыть тару». После приёмки — «Этикетки партий». QR на этикетке открывает карточку партии.</p>
      <SitePicker />
      <div className="chips">{[[1, 'Сегодня'], [7, '7 дней'], [30, '30 дней']].map(([v, t]) => <button key={v} aria-pressed={days === v} onClick={() => setDays(v as number)}>{t}</button>)}</div>
      {err && <div className="err">{err}</div>}
      <div className="card">
        <h2>Журнал печати</h2>
        {!rows ? <p className="muted">Загрузка…</p> : rows.length === 0 ? <p className="muted">За период этикетки не печатались.</p> : (
          <div className="scroll"><table className="tbl">
            <thead><tr><th>Когда</th><th>Продукт, партия</th><th>Годен до</th><th>Копий</th><th>Кто</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td>{dt(r.printed_at, tz)}</td>
                <td><Link href={`/app/${org.id}/lots/${r.lot_id}`}>{r.product}</Link><div className="small muted">{r.lot_no || 'без номера'} · {r.kind === 'opened' ? 'вскрытая тара' : 'партия'} · {r.code}</div>
                  {r.warning && <span className="badge crit">{r.warning}</span>}</td>
                <td>{r.expires_at ? dt(r.expires_at, tz) : '—'}</td>
                <td>{r.copies} · {FMT[r.format] || r.format}</td>
                <td className="small">{r.printed_by}</td>
                <td><Link className="small" href={`/app/${org.id}/labels/print?ids=${r.label_id}`}>Ещё раз</Link></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}
