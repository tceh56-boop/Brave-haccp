'use client';
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { useOperationId } from '@/lib/op';
import { api } from '@/lib/api';
import { dt, n } from '@/lib/fmt';

interface Line { id: string; dish_id: string; name: string; qty: string; price: string; amount: string; status: string }
interface Order { order: { id: string; site_id: string; number: number; table_label: string | null; status: string; status_label: string; total: string; refunded: string; version: number; paid_at: string | null };
  lines: Line[]; payments: { method: string; amount: string; kind: string; reason: string | null; created_at: string }[] }
interface MenuItem { id: string; name: string; category: string | null; sale_price: string; stop: { reason: string; source: string } | null; has_ttk: boolean; low: number | null }

const METHOD: Record<string, string> = { cash: 'Наличные', card: 'Карта', other: 'Прочее' };

/** Заказ: меню с учётом стоп-листа, позиции, оплата (сдача — только с наличных), отмена, возврат по позициям. */
export default function OrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params);
  const { org, can } = useOrg();
  const [o, setO] = useState<Order | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [cat, setCat] = useState<string | null>(null);
  const [pay, setPay] = useState({ cash: '', card: '', other: '' });
  const [done, setDone] = useState<string | null>(null);
  const op = useOperationId();
  const { busy, error, run, setError } = useSubmit();
  const load = useCallback(async () => {
    const r = await api<Order>(`/orgs/${org.id}/pos/orders/${orderId}`);
    setO(r);
    if (r.order.status === 'open') setMenu(await api<MenuItem[]>(`/orgs/${org.id}/sites/${r.order.site_id}/pos/menu`));
  }, [org.id, orderId]);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load, setError]);
  if (!o) return error ? <div className="err">{error}</div> : <p className="muted">Загрузка…</p>;
  const order = o.order, open = order.status === 'open';
  const total = Number(order.total);
  const num = (s: string) => (s ? Number(s.replace(',', '.')) : 0);
  const paid = num(pay.cash) + num(pay.card) + num(pay.other);
  const change = Math.round((paid - total) * 100) / 100;
  const cats = [...new Set(menu.map((m) => m.category || 'Без категории'))];
  const shown = menu.filter((m) => !cat || (m.category || 'Без категории') === cat);
  const active = o.lines.filter((l) => l.status === 'new' || l.status === 'sold');
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/pos`}>← Касса</Link></p>
      <div className="between"><h1 style={{ margin: 0 }}>Заказ №{order.number}{order.table_label ? ` · стол ${order.table_label}` : ''}</h1><span className={`badge ${open ? 'warn' : order.status === 'paid' ? 'ok' : ''}`}>{order.status_label}</span></div>
      {error && <div className="err" role="alert">{error}</div>}
      {done && <div className="okbox">{done}</div>}

      <div className="card">
        {active.length === 0 && o.lines.length === 0 ? <p className="small muted">Добавьте блюда из меню ниже.</p> : (
          <ul className="list">{o.lines.map((l) => (
            <li key={l.id} className="between">
              <span>{l.name}{l.status === 'refunded' && <span className="badge"> возврат</span>}<div className="small muted">{n(l.price)} ₽ × {n(l.qty)}</div></span>
              <span className="row">
                {open && <>
                  <button className="btn small secondary" aria-label={`Меньше ${l.name}`} disabled={busy} onClick={() => run(async () => { await api(`/orgs/${org.id}/pos/lines/${l.id}`, { method: 'PATCH', body: { qty: Number(l.qty) - 1, version: order.version } }); await load(); })}>−</button>
                  <button className="btn small secondary" aria-label={`Больше ${l.name}`} disabled={busy} onClick={() => run(async () => { await api(`/orgs/${org.id}/pos/lines/${l.id}`, { method: 'PATCH', body: { qty: Number(l.qty) + 1, version: order.version } }); await load(); })}>+</button>
                </>}
                <b>{n(l.amount)} ₽</b>
              </span>
            </li>
          ))}</ul>
        )}
        <div className="between" style={{ marginTop: 10 }}><b>Итого</b><b style={{ fontSize: 22 }}>{n(order.total)} ₽</b></div>
        {Number(order.refunded) > 0 && <p className="small">Возвращено: {n(order.refunded)} ₽</p>}
      </div>

      {open && (
        <>
          <div className="chips"><button aria-pressed={!cat} onClick={() => setCat(null)}>Всё</button>{cats.map((c) => <button key={c} aria-pressed={cat === c} onClick={() => setCat(c)}>{c}</button>)}</div>
          <div className="tiles">{shown.map((m) => (
            <button key={m.id} className={`tile ${m.stop ? '' : 'primary'}`} disabled={busy || !!m.stop} title={m.stop?.reason}
              onClick={() => run(async () => { await api(`/orgs/${org.id}/pos/orders/${orderId}/lines`, { body: { dishId: m.id, version: order.version } }); await load(); })}
              style={m.stop ? { opacity: 0.55 } : undefined}>
              {m.name}<span className="sub">{m.stop ? `стоп: ${m.stop.reason}` : `${n(m.sale_price)} ₽${m.low !== null ? ` · осталось ${m.low}` : ''}${m.has_ttk ? '' : ' · нет ТТК'}`}</span>
            </button>
          ))}</div>

          {total > 0 && (
            <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => {
              const payments = (['cash', 'card', 'other'] as const).filter((k) => num(pay[k]) > 0).map((k) => ({ method: k, amount: num(pay[k]) }));
              const r = await api<{ change: number; fulfil: Record<string, number> }>(`/orgs/${org.id}/pos/orders/${orderId}/pay`, { body: { payments, operationId: op.id, version: order.version } });
              op.next();
              setDone(`Оплачено${r.change ? `. Сдача: ${n(r.change)} ₽` : ''}.${r.fulfil.no_ttk || r.fulfil.failed ? ' Часть позиций не списана по ТТК — шеф получил задачу.' : ''} Пробейте чек на ККТ.`);
              await load();
            }); }}>
              <h2>Оплата</h2>
              <div className="row" style={{ marginBottom: 8 }}>
                <button type="button" className="btn small secondary" onClick={() => setPay({ cash: String(total), card: '', other: '' })}>Всё наличными</button>
                <button type="button" className="btn small secondary" onClick={() => setPay({ cash: '', card: String(total), other: '' })}>Всё картой</button>
              </div>
              <div className="grid2">
                {(['cash', 'card', 'other'] as const).map((k) => <div key={k}><label htmlFor={`p-${k}`}>{METHOD[k]}, ₽</label><input id={`p-${k}`} inputMode="decimal" value={pay[k]} onChange={(e) => setPay({ ...pay, [k]: e.target.value })} /></div>)}
              </div>
              <p className="small">{paid < total ? `Не хватает ${n(Math.round((total - paid) * 100) / 100)} ₽` : change > 0 ? `Сдача ${n(change)} ₽ (только с наличных)` : 'Сумма совпадает'}</p>
              <button className="btn block" disabled={busy || paid < total}>Оплатить {n(order.total)} ₽</button>
            </form>
          )}
          <Cancel orderId={orderId} onDone={load} />
        </>
      )}

      {order.status === 'paid' && can('pos.refund') && <Refund o={o} onDone={(msg) => { setDone(msg); load(); }} />}

      {o.payments.length > 0 && (
        <div className="card">
          <h2>Оплаты</h2>
          <ul className="list">{o.payments.map((p, i) => <li key={i} className="between"><span>{p.kind === 'refund' ? 'Возврат' : 'Оплата'} · {METHOD[p.method]}{p.reason ? ` · ${p.reason}` : ''}<div className="small muted">{dt(p.created_at, org.timezone)}</div></span><b>{n(p.amount)} ₽</b></li>)}</ul>
        </div>
      )}
    </>
  );
}

function Cancel({ orderId, onDone }: { orderId: string; onDone: () => void }) {
  const { org } = useOrg();
  const [reason, setReason] = useState<string | null>(null);
  const { busy, error, run } = useSubmit();
  return (
    <div className="card">
      {error && <div className="err">{error}</div>}
      {reason === null ? <button className="btn block secondary" onClick={() => setReason('')}>Отменить заказ</button> : (
        <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/orgs/${org.id}/pos/orders/${orderId}/cancel`, { body: { reason } }); onDone(); }); }}>
          <label htmlFor="cr">Причина отмены</label><input id="cr" required value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className="btn block danger" disabled={busy}>Отменить заказ</button>
        </form>
      )}
    </div>
  );
}

function Refund({ o, onDone }: { o: Order; onDone: (msg: string) => void }) {
  const { org } = useOrg();
  const sold = o.lines.filter((l) => l.status === 'sold');
  const [sel, setSel] = useState<string[]>([]);
  const [method, setMethod] = useState('cash');
  const [reason, setReason] = useState('');
  const op = useOperationId();
  const { busy, error, run } = useSubmit();
  const sum = sold.filter((l) => !sel.length || sel.includes(l.id)).reduce((s, l) => s + Number(l.amount), 0);
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => {
      const r = await api<{ refunded: number; full: boolean }>(`/orgs/${org.id}/pos/orders/${o.order.id}/refund`, { body: { lineIds: sel.length ? sel : undefined, method, reason, operationId: op.id } });
      op.next(); setSel([]); setReason(''); onDone(`Возврат ${n(r.refunded)} ₽ проведён. Оформите чек возврата на ККТ.`);
    }); }}>
      <h2>Возврат</h2>
      {error && <div className="err">{error}</div>}
      <p className="small muted">Отметьте позиции для частичного возврата; без отметок — весь заказ. Сырьё на склад не возвращается.</p>
      {sold.map((l) => (
        <label key={l.id} className="row" style={{ fontWeight: 400 }}>
          <input type="checkbox" style={{ width: 22, minHeight: 22 }} checked={sel.includes(l.id)} onChange={(e) => setSel(e.target.checked ? [...sel, l.id] : sel.filter((x) => x !== l.id))} />
          {l.name} × {n(l.qty)} — {n(l.amount)} ₽
        </label>
      ))}
      <div className="grid2">
        <div><label htmlFor="rm">Как вернуть</label><select id="rm" value={method} onChange={(e) => setMethod(e.target.value)}>{Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label htmlFor="rr">Причина</label><input id="rr" required value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      </div>
      <button className="btn block danger" disabled={busy || reason.trim().length < 3}>Вернуть {n(Math.round(sum * 100) / 100)} ₽</button>
    </form>
  );
}
