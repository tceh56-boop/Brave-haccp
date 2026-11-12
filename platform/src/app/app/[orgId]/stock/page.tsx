'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { SitePicker } from '@/components/OrgNav';
import { api } from '@/lib/api';
import { d, n } from '@/lib/fmt';

interface Bal { product_id: string; name: string; unit: string; available: string; soon: string; quarantine: string; unconfirmed: string; unusable: string; lots: number; next_expiry: string | null }

/** Склад: остатки по товарам — что можно расходовать, что в карантине, что нельзя использовать. */
export default function StockPage() {
  const { org, siteId, can } = useOrg();
  const [rows, setRows] = useState<Bal[] | null>(null);
  const [q, setQ] = useState('');
  const load = useCallback(() => { if (siteId) api<Bal[]>(`/orgs/${org.id}/sites/${siteId}/stock`).then(setRows); }, [org.id, siteId]);
  useEffect(() => { load(); }, [load]);
  const base = `/app/${org.id}`;
  const shown = (rows || []).filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <SitePicker />
      <h1>Склад</h1>
      <div className="tiles">
        {can('stock.consume') && <Link className="tile primary" href={`${base}/stock/consume`}>Расход<span className="sub">по сроку годности</span></Link>}
        <Link className="tile" href={`${base}/lots`}>Сроки<span className="sub">партии и годность</span></Link>
        {can('receipt.record') && <Link className="tile" href={`${base}/receipts/new`}>Приёмка<span className="sub">новая поставка</span></Link>}
        {can('stock.count') && <Link className="tile" href={`${base}/stock/count`}>Инвентаризация<span className="sub">пересчёт партий</span></Link>}
      </div>
      <input aria-label="Поиск товара" placeholder="Найти товар" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12 }} />
      <div className="card">
        {!rows ? <p className="muted">Загрузка…</p> : shown.length === 0 ? <p className="muted">На складе пусто.</p> : (
          <div>{shown.map((r) => (
            <Link key={r.product_id} className="objrow" href={`${base}/lots?product=${r.product_id}`}>
              <div><b>{r.name}</b>
                <div className="small">можно расходовать: <b>{n(r.available)} {r.unit}</b>{r.next_expiry ? ` · ближайший срок ${d(r.next_expiry, org.timezone)}` : ''}</div>
                <div className="small muted">партий: {r.lots}</div></div>
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                {Number(r.soon) > 0 && <span className="badge warn">скоро: {n(r.soon)}</span>}
                {Number(r.quarantine) > 0 && <span className="badge crit">карантин: {n(r.quarantine)}</span>}
                {Number(r.unconfirmed) > 0 && <span className="badge warn">срок не подтв.: {n(r.unconfirmed)}</span>}
                {Number(r.unusable) > 0 && <span className="badge crit">нельзя: {n(r.unusable)}</span>}
              </div>
            </Link>
          ))}</div>
        )}
      </div>
    </>
  );
}
