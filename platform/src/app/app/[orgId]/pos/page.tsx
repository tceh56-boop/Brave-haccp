'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useOrg } from '@/lib/org';
import { SitePicker } from '@/components/OrgNav';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { dt, n } from '@/lib/fmt';

interface Totals { cash: number; card: number; other: number; revenue: number; gross: number; refunds: number; orders: number; open_orders: number; avg_check: number; cash_expected: number }
interface Shift { shift: { id: string; opened_at: string; cash_start: string } | null; totals: Totals | null }
interface Order { id: string; number: number; table_label: string | null; status: string; status_label: string; total: string; created_at: string; created_by_name: string }

/** Касса: смена (наличные на начало, X-отчёт, закрытие со сверкой), заказы смены. Чек пробивает ККТ предприятия. */
export default function PosPage() {
  const { org, siteId } = useOrg();
  const router = useRouter();
  const [s, setS] = useState<Shift | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [cash, setCash] = useState('');
  const [table, setTable] = useState('');
  const [closing, setClosing] = useState<string | null>(null);
  const [closed, setClosed] = useState<{ cash_diff: number; totals: Totals } | null>(null);
  const { busy, error, run } = useSubmit();
  const load = useCallback(async () => {
    if (!siteId) return;
    setS(await api<Shift>(`/orgs/${org.id}/sites/${siteId}/pos/shift`));
    setOrders(await api<Order[]>(`/orgs/${org.id}/sites/${siteId}/pos/orders`));
  }, [org.id, siteId]);
  useEffect(() => { load(); }, [load]);
  if (!s) return error ? <div className="err">{error}</div> : <p className="muted">Загрузка…</p>;
  const t = s.totals;
  return (
    <>
      <SitePicker />
      <h1>Касса</h1>
      <p className="small muted">Фискальный чек пробивает ККТ предприятия. Сумма заказа считается по ценам блюд, повторное нажатие «Оплатить» не создаёт вторую оплату.</p>
      {error && <div className="err" role="alert">{error}</div>}
      {closed && <div className={closed.cash_diff === 0 ? 'okbox' : 'note'}>Смена закрыта. Выручка {n(closed.totals.revenue)} ₽, заказов {closed.totals.orders}. Расхождение наличных: <b>{n(closed.cash_diff)} ₽</b>.</div>}
      {!s.shift ? (
        <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/orgs/${org.id}/pos/shift/open`, { body: { siteId, cashStart: cash ? Number(cash.replace(',', '.')) : 0 } }); setClosed(null); setCash(''); await load(); }); }}>
          <h2>Открыть смену</h2>
          <label htmlFor="cs">Наличные в кассе на начало, ₽</label>
          <input id="cs" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0" />
          <button className="btn block" disabled={busy}>Открыть смену</button>
        </form>
      ) : (
        <>
          <div className="card">
            <div className="between"><b>Смена открыта</b><span className="small muted">{dt(s.shift.opened_at, org.timezone)}</span></div>
            {t && <dl className="kv" style={{ marginTop: 8 }}>
              <dt>Выручка</dt><dd><b>{n(t.revenue)} ₽</b>{t.refunds ? ` (возвраты ${n(t.refunds)} ₽)` : ''}</dd>
              <dt>Наличные</dt><dd>{n(t.cash)} ₽ · ожидается в кассе {n(t.cash_expected)} ₽</dd>
              <dt>Карта / прочее</dt><dd>{n(t.card)} ₽ / {n(t.other)} ₽</dd>
              <dt>Заказов</dt><dd>{t.orders}{t.avg_check ? ` · средний чек ${n(t.avg_check)} ₽` : ''}</dd>
            </dl>}
          </div>
          <form className="card row" onSubmit={(e) => { e.preventDefault(); run(async () => {
            const o = await api<{ order: { id: string } }>(`/orgs/${org.id}/pos/orders`, { body: { siteId, tableLabel: table || null } });
            router.push(`/app/${org.id}/pos/${o.order.id}`);
          }); }}>
            <input aria-label="Стол" value={table} onChange={(e) => setTable(e.target.value)} placeholder="Стол (необязательно)" style={{ flex: 1, minWidth: 140 }} />
            <button className="btn" disabled={busy}>Новый заказ</button>
          </form>
          <div className="card">
            <h2>Заказы смены</h2>
            {orders.length === 0 ? <p className="small muted">Заказов пока нет.</p> : orders.map((o) => (
              <Link key={o.id} className="objrow" href={`/app/${org.id}/pos/${o.id}`}>
                <div><b>№{o.number}</b>{o.table_label ? ` · стол ${o.table_label}` : ''}<div className="small muted">{dt(o.created_at, org.timezone)} · {o.created_by_name}</div></div>
                <div className="row" style={{ justifyContent: 'flex-end' }}><b>{n(o.total)} ₽</b><span className={`badge ${o.status === 'open' ? 'warn' : o.status === 'paid' ? 'ok' : ''}`}>{o.status_label}</span><span aria-hidden>›</span></div>
              </Link>
            ))}
          </div>
          <div className="card">
            {closing === null ? <button className="btn block secondary" onClick={() => setClosing('')}>Закрыть смену</button> : (
              <form onSubmit={(e) => { e.preventDefault(); run(async () => {
                const r = await api<{ cash_diff: number; totals: Totals }>(`/orgs/${org.id}/pos/shift/close`, { body: { siteId, cashFact: Number(closing.replace(',', '.')) } });
                setClosed(r); setClosing(null); await load();
              }); }}>
                <label htmlFor="cf">Наличные в кассе по факту, ₽</label>
                <input id="cf" inputMode="decimal" required value={closing} onChange={(e) => setClosing(e.target.value)} />
                {t && <p className="small muted">Ожидается {n(t.cash_expected)} ₽. Расхождение фиксируется как есть.</p>}
                <button className="btn block" disabled={busy}>Закрыть смену</button>
              </form>
            )}
          </div>
        </>
      )}
    </>
  );
}
