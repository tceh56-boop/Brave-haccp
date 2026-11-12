'use client';
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { d, dt, n } from '@/lib/fmt';

/** Заказ поставщику: позиции (в черновике — правка), текст для отправки, переходы, приёмка по заказу, расхождения. */

interface Line { id: string; product_id: string; product: string; quantity: string; unit: string; price: string | null; note: string | null; received: string; diff: number | null }
interface O { order: { id: string; number: number; status: string; status_label: string; supplier: string; supplier_phone: string | null; supplier_email: string | null; blocked_reason: string | null;
  site_name: string; expected_at: string | null; note: string | null; created_at: string; sent_at: string | null; confirmed_at: string | null; received_at: string | null; cancel_reason: string | null };
  lines: Line[]; extra: { product: string; quantity: string; unit: string }[]; receipts: { id: string; status: string; document_no: string | null; completed_at: string | null }[]; amount: number | null; text: string }
interface Product { id: string; name: string; unit: string }
const TONE: Record<string, string> = { draft: '', sent: 'warn', confirmed: 'warn', received: 'ok', cancelled: '' };
const num = (s: string) => s.trim().replace(',', '.');

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { org, can } = useOrg();
  const router = useRouter();
  const [o, setO] = useState<O | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [add, setAdd] = useState({ productId: '', quantity: '', price: '' });
  const [reason, setReason] = useState('');
  const [copied, setCopied] = useState(false);
  const { busy, error, run, setError } = useSubmit();
  const load = useCallback(() => api<O>(`/orgs/${org.id}/purchasing/orders/${id}`).then(setO).catch((e) => setError(e.message)), [org.id, id, setError]);
  useEffect(() => { load(); }, [load]);
  const manage = can('purchase.manage');
  useEffect(() => { if (manage && o?.order.status === 'draft' && !products.length) api<Product[]>(`/orgs/${org.id}/products`).then(setProducts).catch(() => undefined); }, [manage, o?.order.status, org.id, products.length]);
  if (!o) return error ? <div className="err">{error}</div> : <p className="muted">Загрузка…</p>;
  const { order } = o, draft = order.status === 'draft', open = ['sent', 'confirmed'].includes(order.status), done = order.status === 'received';
  const step = (s: string, body: object = {}) => run(async () => { await api(`/orgs/${org.id}/purchasing/orders/${id}/${s}`, { body }); await load(); });
  const patch = (body: object) => run(async () => { await api(`/orgs/${org.id}/purchasing/orders/${id}`, { method: 'PATCH', body }); await load(); });
  const draftReceipt = o.receipts.find((r) => r.status === 'draft');
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/purchasing?tab=orders`}>← Закупки</Link></p>
      <div className="between"><h1 style={{ margin: 0 }}>Заказ № {order.number}</h1><span className={`badge ${TONE[order.status]}`}>{order.status_label}</span></div>
      <p className="muted">{order.supplier} · {order.site_name}</p>
      {order.blocked_reason && <div className="err">Поставщик заблокирован для заказов: {order.blocked_reason}</div>}

      <div className="card">
        <div className="kv">
          <span>Создан</span><b>{dt(order.created_at, org.timezone)}</b>
          {order.sent_at && <><span>Отправлен</span><b>{dt(order.sent_at, org.timezone)}</b></>}
          {order.confirmed_at && <><span>Подтверждён</span><b>{dt(order.confirmed_at, org.timezone)}</b></>}
          {order.received_at && <><span>Принят</span><b>{dt(order.received_at, org.timezone)}</b></>}
          {order.cancel_reason && <><span>Отменён</span><b>{order.cancel_reason}</b></>}
          <span>Поставка</span><b>{order.expected_at ? d(order.expected_at, org.timezone) : '—'}</b>
          {(order.supplier_phone || order.supplier_email) && <><span>Контакты</span><b>{[order.supplier_phone, order.supplier_email].filter(Boolean).join(' · ')}</b></>}
          {o.amount !== null && <><span>Сумма</span><b>{n(o.amount)} ₽</b></>}
        </div>
      </div>

      <div className="card">
        <h2>Позиции · {o.lines.length}</h2>
        <div className="scroll"><table className="tbl">
          <thead><tr><th>Товар</th><th>Заказано</th><th>Цена, ₽</th>{done && <th>Принято</th>}{draft && manage && <th />}</tr></thead>
          <tbody>{o.lines.map((l) => (
            <tr key={l.id}>
              <td>{l.product}</td>
              <td>{n(l.quantity)} {l.unit}</td>
              <td>{l.price === null ? '—' : n(l.price)}</td>
              {done && <td>{n(l.received)} {l.diff ? <span className={`badge ${l.diff < 0 ? 'crit' : 'warn'}`}>{l.diff > 0 ? '+' : ''}{n(l.diff)}</span> : <span className="badge ok">✓</span>}</td>}
              {draft && manage && <td><button className="btn secondary small" aria-label={`Убрать ${l.product}`} disabled={busy} onClick={() => patch({ removeProductIds: [l.product_id] })}>✕</button></td>}
            </tr>))}</tbody>
        </table></div>
        {done && o.extra.length > 0 && <p className="small">Сверх заказа принято: {o.extra.map((x) => `${x.product} ${n(x.quantity)} ${x.unit}`).join('; ')}.</p>}
        {draft && manage && (
          <>
            <h3 style={{ marginTop: 14 }}>Добавить или изменить позицию</h3>
            <select aria-label="Товар" value={add.productId} onChange={(e) => setAdd({ ...add, productId: e.target.value })}>
              <option value="">— товар —</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
            </select>
            <div className="grid2">
              <div><label htmlFor="aq">Количество</label><input id="aq" inputMode="decimal" value={add.quantity} onChange={(e) => setAdd({ ...add, quantity: e.target.value })} /></div>
              <div><label htmlFor="ap">Цена, ₽</label><input id="ap" inputMode="decimal" value={add.price} onChange={(e) => setAdd({ ...add, price: e.target.value })} placeholder="если известна" /></div>
            </div>
            <button className="btn secondary block" disabled={busy || !add.productId || !add.quantity} onClick={() => { patch({ lines: [{ productId: add.productId, quantity: num(add.quantity), price: add.price ? num(add.price) : null }] }); setAdd({ productId: '', quantity: '', price: '' }); }}>Сохранить позицию</button>
            <label htmlFor="ea">Дата поставки</label>
            <input id="ea" type="date" defaultValue={order.expected_at?.slice(0, 10) || ''} onBlur={(e) => e.target.value && e.target.value !== order.expected_at?.slice(0, 10) && patch({ expectedAt: e.target.value })} />
          </>
        )}
      </div>

      {(draft || open) && (
        <div className="card">
          <h2>Текст заказа</h2>
          <pre className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{o.text}</pre>
          <div className="grid2" style={{ marginTop: 10 }}>
            <button className="btn secondary" onClick={() => navigator.clipboard?.writeText(o.text).then(() => setCopied(true)).catch(() => setError('Не удалось скопировать — выделите текст вручную.'))}>{copied ? 'Скопировано' : 'Скопировать'}</button>
            {order.supplier_email ? <a className="btn secondary" href={`mailto:${order.supplier_email}?subject=${encodeURIComponent(`Заказ № ${order.number}`)}&body=${encodeURIComponent(o.text)}`}>Письмо поставщику</a> : <span />}
          </div>
          <p className="small muted">Система не отправляет заказ сама: отправьте текст поставщику и отметьте «Отправлен».</p>
        </div>
      )}

      {error && <div className="err" role="alert">{error}</div>}
      {manage && draft && <button className="btn block" disabled={busy || !o.lines.length} onClick={() => step('send')}>Отметить «Отправлен поставщику»</button>}
      {manage && order.status === 'sent' && <button className="btn block secondary" disabled={busy} onClick={() => step('confirm')}>Поставщик подтвердил</button>}
      {open && can('receipt.record') && (
        <button className="btn block" disabled={busy} onClick={() => run(async () => {
          const r = await api<{ receipt_id: string }>(`/orgs/${org.id}/purchasing/orders/${id}/receive`, { body: {} });
          router.push(`/app/${org.id}/receipts/${r.receipt_id}`);
        })}>{draftReceipt ? 'Продолжить приёмку' : 'Принять поставку'}</button>
      )}
      {o.receipts.length > 0 && (
        <div className="card">
          <h2>Приёмки по заказу</h2>
          {o.receipts.map((r) => <Link key={r.id} className="objrow" href={`/app/${org.id}/receipts/${r.id}`}><span>{r.document_no || 'без номера'}{r.completed_at ? ` · ${dt(r.completed_at, org.timezone)}` : ''}</span><span className="badge">{r.status === 'draft' ? 'идёт' : 'завершена'}</span></Link>)}
        </div>
      )}
      {manage && (draft || open) && (
        <div className="card">
          <h2>Отменить заказ</h2>
          <label htmlFor="cr">Причина</label>
          <input id="cr" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="поставщик не может привезти, заказали у другого" />
          <button className="btn block danger" disabled={busy || reason.trim().length < 3} onClick={() => step('cancel', { reason })}>Отменить заказ</button>
        </div>
      )}
    </>
  );
}
