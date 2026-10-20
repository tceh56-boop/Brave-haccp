'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { SitePicker } from '@/components/OrgNav';
import { useSubmit } from '@/components/useSubmit';
import { useOperationId } from '@/lib/op';
import { api } from '@/lib/api';
import { d, n } from '@/lib/fmt';

interface Product { id: string; name: string; unit: string }
interface Res { product: string; quantity: number; unit: string; lots: { lot_no: string | null; quantity: number; expires_at: string }[]; repeated?: boolean }

/** Расход по FEFO: сотрудник указывает товар и количество — партии подбирает система. */
export default function ConsumePage() {
  const { org, siteId } = useOrg();
  const [products, setProducts] = useState<Product[]>([]);
  const [f, setF] = useState({ productId: '', quantity: '', purpose: '' });
  const [res, setRes] = useState<Res | null>(null);
  const op = useOperationId();
  const { busy, error, run } = useSubmit();
  useEffect(() => { api<Product[]>(`/orgs/${org.id}/products`).then(setProducts); }, [org.id]);
  const unit = products.find((p) => p.id === f.productId)?.unit;
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/stock`}>← Склад</Link></p>
      <h1>Расход со склада</h1>
      <SitePicker />
      <div className="card">
        <form onSubmit={(e) => { e.preventDefault(); run(async () => {
          setRes(await api<Res>(`/orgs/${org.id}/stock/consume`, { body: { siteId, productId: f.productId, quantity: f.quantity.replace(',', '.'), purpose: f.purpose, operationId: op.id } }));
          op.next(); setF({ ...f, quantity: '' });
        }); }}>
          <label htmlFor="p">Товар</label>
          <select id="p" required value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })}>
            <option value="">— выберите —</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
          </select>
          <label htmlFor="q">Количество{unit ? `, ${unit}` : ''}</label>
          <input id="q" className="big-input" inputMode="decimal" required value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />
          <label htmlFor="pu">Для чего</label>
          <input id="pu" required value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} placeholder="заготовка на обед, банкет 18:00" />
          <p className="small muted">Система берёт партии с ближайшим сроком годности. Карантинные, просроченные и без подтверждённого срока не расходуются.</p>
          {error && <div className="err" role="alert">{error}</div>}
          <button className="btn block" disabled={busy}>Списать в расход</button>
        </form>
      </div>
      {res && (
        <div className="okbox" role="status">
          {res.repeated ? 'Эта операция уже проведена — повтор не списал второй раз. ' : ''}Списано {n(res.quantity)} {res.unit} «{res.product}»:
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{res.lots.map((l, i) => <li key={i}>партия {l.lot_no || 'без номера'} — {n(l.quantity)} {res.unit} (до {d(l.expires_at, org.timezone)})</li>)}</ul>
        </div>
      )}
    </>
  );
}
