'use client';
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { useOperationId } from '@/lib/op';
import { api } from '@/lib/api';
import { dt, n } from '@/lib/fmt';

/**
 * Мероприятие: шапка (гости пересчитывают порции «на гостя»), меню, потребность по ТТК с нехваткой и заказом поставщику,
 * п/ф к приготовлению, подтверждение, «Проведено» с фактическими порциями и списанием, лист для кухни.
 */

interface Item { id: string; dish_id: string; dish: string; per_guest: number | null; portions: number; price: number | null; own_price: boolean; note: string | null; ttk_version: number | null; actual_portions: number | null; cost: number | null }
interface NeedLine { product_id: string; name: string; unit: string; semi: boolean; need: number; stock: number; ordered: number; shortage: number; last_supplier_id: string | null; last_price: number | null }
interface Semi { dish_id: string; name: string; need_kg: number; ready_kg: number; planned_kg: number; to_make_kg: number }
export interface EventData {
  event: { id: string; number: number; title: string; event_date: string; event_time: string | null; guests: number; format: string | null; contact: string | null; note: string | null; site_id: string; site_name: string;
    status: string; status_label: string; cancel_reason: string | null; revenue: number | null; cost: number | null; can_see_money: boolean; completed_at: string | null };
  items: Item[]; amount: number | null; per_guest_amount: number | null;
  needs: { lines: NeedLine[]; semis: Semi[]; missing: { dish: string; reason: string }[]; complete: boolean } | null;
  orders: { id: string; number: number; status: string; supplier: string }[];
  production: { id: string; status: string; planned_g: string; planned_for: string; dish: string }[];
}
interface Dish { id: string; name: string; kind: string; sale_price: string | null; approved: { version: number } | null }
interface Supplier { id: string; name: string; blocked_reason: string | null }
const TONE: Record<string, string> = { planned: '', confirmed: 'warn', done: 'ok', cancelled: '' };
const ddmm = (s: string) => s.slice(0, 10).split('-').reverse().join('.');
const num = (s: string) => s.trim().replace(',', '.');
const dayBefore = (s: string) => { const t = new Date(`${s.slice(0, 10)}T12:00:00Z`); t.setUTCDate(t.getUTCDate() - 1); const today = new Date().toLocaleDateString('sv-SE'); const v = t.toISOString().slice(0, 10); return v < today ? today : v; };

export default function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { org, can } = useOrg();
  const router = useRouter();
  const [x, setX] = useState<EventData | null>(null);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [it, setIt] = useState({ dishId: '', mode: 'guest', qty: '1', price: '', note: '' });
  const [guests, setGuests] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [actual, setActual] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const op = useOperationId();
  const { busy, error, run, setError } = useSubmit();
  const manage = can('event.manage');
  const load = useCallback(() => api<EventData>(`/orgs/${org.id}/events/${id}`).then((d) => { setX(d); setGuests(String(d.event.guests)); }).catch((e) => setError(e.message)), [org.id, id, setError]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (manage) api<Dish[]>(`/orgs/${org.id}/dishes`).then((l) => setDishes(l.filter((d) => d.kind === 'dish'))).catch(() => undefined); }, [manage, org.id]);
  useEffect(() => { if (can('purchase.manage')) api<Supplier[]>(`/orgs/${org.id}/suppliers`).then(setSuppliers).catch(() => undefined); }, [can, org.id]);
  if (!x) return error ? <div className="err">{error}</div> : <p className="muted">Загрузка…</p>;
  const e = x.event, open = ['planned', 'confirmed'].includes(e.status), edit = manage && open;
  const step = (s: string, body: object = {}) => run(async () => { await api(`/orgs/${org.id}/events/${id}/${s}`, { body }); await load(); });
  const short = x.needs?.lines.filter((l) => l.shortage > 0 && !l.semi) || [];
  const defaultSupplier = short.find((l) => l.last_supplier_id && suppliers.some((s) => s.id === l.last_supplier_id && !s.blocked_reason))?.last_supplier_id || '';
  const sup = supplierId || defaultSupplier;

  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/events`}>← План-меню</Link></p>
      <div className="between"><h1 style={{ margin: 0 }}>{e.title}</h1><span className={`badge ${TONE[e.status]}`}>{e.status_label}</span></div>
      <p className="muted">№ {e.number} · {ddmm(e.event_date)}{e.event_time ? ` ${e.event_time}` : ''} · {e.site_name}</p>

      <div className="card">
        <div className="kv">
          <span>Гостей</span><b>{e.guests}</b>
          {e.format && <><span>Формат</span><b>{e.format}</b></>}
          {e.contact && <><span>Контакт</span><b>{e.contact}</b></>}
          {x.amount !== null && <><span>Сумма меню</span><b>{n(x.amount)} ₽ · {n(x.per_guest_amount)} ₽ на гостя</b></>}
          {e.status === 'done' && e.can_see_money && <><span>Выручка</span><b>{e.revenue === null ? 'не рассчитана — нет цены у блюда' : `${n(e.revenue)} ₽`}</b></>}
          {e.status === 'done' && e.cost !== null && <><span>Себестоимость</span><b>{n(e.cost)} ₽</b></>}
          {e.completed_at && <><span>Проведено</span><b>{dt(e.completed_at, org.timezone)}</b></>}
          {e.cancel_reason && <><span>Отменено</span><b>{e.cancel_reason}</b></>}
        </div>
        {edit && (
          <div className="row" style={{ marginTop: 10 }}>
            <input aria-label="Гостей" inputMode="numeric" value={guests} onChange={(ev) => setGuests(ev.target.value)} style={{ flex: 1 }} />
            <button className="btn secondary small" disabled={busy || guests === String(e.guests)} onClick={() => run(async () => { await api(`/orgs/${org.id}/events/${id}`, { method: 'PATCH', body: { guests: guests } }); await load(); })}>Изменить число гостей</button>
          </div>
        )}
        <p className="small" style={{ marginTop: 10 }}><Link href={`/app/${org.id}/events/${id}/print`}>Лист для кухни (печать)</Link></p>
      </div>

      <div className="card">
        <h2>Меню · {x.items.length}</h2>
        {x.items.length === 0 && <p className="small muted">Блюд пока нет.</p>}
        <ul className="list">{x.items.map((i) => (
          <li key={i.id}>
            <div className="between" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              <div><b>{i.dish}</b>{!i.ttk_version && <> <span className="badge crit">нет утверждённой ТТК</span></>}
                <div className="small">{n(i.portions)} порц.{i.per_guest !== null ? ` (${n(i.per_guest)} на гостя)` : ` (≈ ${n(Math.round(i.portions / e.guests * 100) / 100)} на гостя)`}{i.price !== null ? ` · ${n(i.price)} ₽${i.own_price ? ' (своя цена)' : ''}` : ''}{i.note ? ` · ${i.note}` : ''}</div>
                {e.status === 'done' && <div className="small muted">факт {n(i.actual_portions)} порц.{i.cost !== null ? ` · себестоимость ${n(i.cost)} ₽` : ''}</div>}
              </div>
              {edit && <button className="btn secondary small" aria-label={`Убрать ${i.dish}`} disabled={busy} onClick={() => run(async () => { await api(`/orgs/${org.id}/events/${id}/items/${i.dish_id}`, { method: 'DELETE' }); await load(); })}>✕</button>}
            </div>
          </li>))}</ul>
        {edit && (
          <>
            <h3 style={{ marginTop: 14 }}>Добавить блюдо</h3>
            <select aria-label="Блюдо" value={it.dishId} onChange={(ev) => setIt({ ...it, dishId: ev.target.value })}>
              <option value="">— блюдо —</option>{dishes.map((d) => <option key={d.id} value={d.id}>{d.name}{d.approved ? '' : ' (нет утверждённой ТТК)'}</option>)}
            </select>
            <div className="chips" style={{ marginTop: 10 }}>
              {[['guest', 'На гостя'], ['total', 'Порций итого']].map(([k, l]) => <button key={k} type="button" aria-pressed={it.mode === k} onClick={() => setIt({ ...it, mode: k })}>{l}</button>)}
            </div>
            <div className="grid2">
              <div><label htmlFor="iq">{it.mode === 'guest' ? 'Порций на гостя' : 'Порций итого'}</label><input id="iq" inputMode="decimal" value={it.qty} onChange={(ev) => setIt({ ...it, qty: ev.target.value })} /></div>
              {e.can_see_money && <div><label htmlFor="ip">Цена порции, ₽</label><input id="ip" inputMode="decimal" value={it.price} onChange={(ev) => setIt({ ...it, price: ev.target.value })} placeholder="из карточки блюда" /></div>}
            </div>
            <label htmlFor="in">Примечание</label><input id="in" value={it.note} onChange={(ev) => setIt({ ...it, note: ev.target.value })} placeholder="фуршет, детям, без лука" />
            {it.mode === 'guest' && it.qty && <p className="small muted">Порций будет ⌈{it.qty} × {e.guests}⌉ = {Math.ceil(Number(num(it.qty)) * e.guests) || '—'}; при смене числа гостей пересчитается.</p>}
            <button className="btn secondary block" disabled={busy || !it.dishId || !it.qty} onClick={() => run(async () => {
              await api(`/orgs/${org.id}/events/${id}/items`, { body: { dishId: it.dishId, perGuest: it.mode === 'guest' ? num(it.qty) : null, portions: it.mode === 'total' ? num(it.qty) : null, price: it.price ? num(it.price) : null, note: it.note || null } });
              setIt({ dishId: '', mode: it.mode, qty: '1', price: '', note: '' }); await load();
            })}>Добавить в меню</button>
          </>
        )}
      </div>

      {x.needs && x.items.length > 0 && (
        <div className="card">
          <h2>Потребность по ТТК</h2>
          {x.needs.missing.length > 0 && <div className="err">Не рассчитано: {x.needs.missing.map((m) => `${m.dish} — ${m.reason}`).join('; ')}</div>}
          <p className="small muted">Остаток — годные партии, срок которых не истекает до дня мероприятия; готовые п/ф берутся первыми. Остаток общий: учтите текущую работу кухни.</p>
          <ul className="list">{x.needs.lines.map((l) => (
            <li key={l.product_id}>
              <div className="between">
                <div><b>{l.name}</b><div className="small muted">нужно {n(l.need)} · есть {n(l.stock)}{l.ordered ? ` · заказано ${n(l.ordered)}` : ''} {l.unit}</div></div>
                {l.shortage > 0 ? <span className="badge crit">не хватает {n(l.shortage)} {l.unit}</span> : <span className="badge ok">хватает</span>}
              </div>
            </li>))}</ul>
          {can('purchase.manage') && open && short.length > 0 && (
            <>
              <h3 style={{ marginTop: 14 }}>Заказать нехватку</h3>
              <select aria-label="Поставщик" value={sup} onChange={(ev) => setSupplierId(ev.target.value)}>
                <option value="">— поставщик —</option>
                {suppliers.map((s) => <option key={s.id} value={s.id} disabled={!!s.blocked_reason}>{s.name}{s.blocked_reason ? ' — заблокирован' : ''}</option>)}
              </select>
              <button className="btn block" disabled={busy || !sup} onClick={() => run(async () => {
                const o = await api<{ id: string }>(`/orgs/${org.id}/purchasing/orders`, { body: { siteId: e.site_id, supplierId: sup, planEventId: e.id, expectedAt: e.event_date.slice(0, 10) <= new Date().toLocaleDateString('sv-SE') ? null : dayBefore(e.event_date),
                  note: `под мероприятие № ${e.number} «${e.title}» ${ddmm(e.event_date)}`, lines: short.map((l) => ({ productId: l.product_id, quantity: l.shortage, price: l.last_supplier_id === sup ? l.last_price : null })) } });
                router.push(`/app/${org.id}/purchasing/${o.id}`);
              })}>Черновик заказа на нехватку ({short.length} поз.)</button>
              <p className="small muted">Количество и позиции можно поправить в заказе до отправки.</p>
            </>
          )}
        </div>
      )}

      {x.needs && x.needs.semis.length > 0 && (
        <div className="card">
          <h2>Полуфабрикаты</h2>
          <ul className="list">{x.needs.semis.map((s) => (
            <li key={s.dish_id}>
              <div className="between">
                <div><b>{s.name}</b><div className="small muted">нужно {n(s.need_kg)} кг · готово {n(s.ready_kg)}{s.planned_kg ? ` · в заданиях ${n(s.planned_kg)}` : ''} кг</div></div>
                {s.to_make_kg > 0 ? (can('production.plan') && open
                  ? <button className="btn secondary small" disabled={busy} onClick={() => run(async () => {
                    await api(`/orgs/${org.id}/production`, { body: { siteId: e.site_id, dishId: s.dish_id, plannedKg: s.to_make_kg, plannedFor: dayBefore(e.event_date), planEventId: e.id, note: `мероприятие № ${e.number}` } });
                    await load();
                  })}>В производство {n(s.to_make_kg)} кг</button>
                  : <span className="badge warn">приготовить {n(s.to_make_kg)} кг</span>) : <span className="badge ok">хватает</span>}
              </div>
            </li>))}</ul>
          <p className="small muted">Задание ставится на день до мероприятия; срок партии п/ф — из ТТК, проверьте, что он доживёт до подачи.</p>
        </div>
      )}

      {(x.orders.length > 0 || x.production.length > 0) && (
        <div className="card">
          <h2>Заказы и задания</h2>
          {x.orders.map((o) => <Link key={o.id} className="objrow" href={`/app/${org.id}/purchasing/${o.id}`}><span>Заказ № {o.number} · {o.supplier}</span><span className="badge">{({ draft: 'черновик', sent: 'отправлен', confirmed: 'подтверждён', received: 'принят', cancelled: 'отменён' } as Record<string, string>)[o.status]}</span></Link>)}
          {x.production.map((p) => <Link key={p.id} className="objrow" href={`/app/${org.id}/production/${p.id}`}><span>{p.dish} · {n(Number(p.planned_g) / 1000)} кг</span><span className="badge">{({ planned: 'план', in_progress: 'в работе', done: 'выпущено', cancelled: 'отменено' } as Record<string, string>)[p.status]}</span></Link>)}
        </div>
      )}

      {error && <div className="err" role="alert">{error}</div>}
      {done && <div className="okbox" role="status">{done}</div>}
      {manage && e.status === 'planned' && <button className="btn block" disabled={busy || !x.items.length} onClick={() => step('confirm')}>Подтвердить мероприятие</button>}
      {manage && e.status === 'confirmed' && (
        <div className="card">
          <h2>Проведено</h2>
          <p className="small muted">Укажите фактические порции, если отличались. Сырьё и п/ф спишутся по ТТК (FEFO) с источником «мероприятие № {e.number}». Если остатка не хватает — ничего не спишется.</p>
          {x.items.map((i) => (
            <div key={i.id} className="between" style={{ flexWrap: 'nowrap', marginBottom: 6 }}>
              <span>{i.dish}</span>
              <input aria-label={`Факт: ${i.dish}`} inputMode="decimal" style={{ width: 90, flex: 'none' }} placeholder={String(i.portions)} value={actual[i.dish_id] ?? ''} onChange={(ev) => setActual({ ...actual, [i.dish_id]: ev.target.value })} />
            </div>))}
          <button className="btn block" disabled={busy} onClick={() => run(async () => {
            const r = await api<{ revenue: number | null; cost: number | null; movements: number }>(`/orgs/${org.id}/events/${id}/complete`, { body: { operationId: op.id,
              actual: Object.entries(actual).filter(([, v]) => v.trim()).map(([dishId, v]) => ({ dishId, portions: num(v) })) } });
            op.next(); setDone(`Мероприятие проведено. Списаний: ${r.movements}.`); await load();
          })}>Проведено — списать по ТТК</button>
        </div>
      )}
      {manage && open && (
        <div className="card">
          <h2>Отменить мероприятие</h2>
          <label htmlFor="cr">Причина</label>
          <input id="cr" value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="заказчик отказался" />
          <button className="btn block danger" disabled={busy || reason.trim().length < 3} onClick={() => step('cancel', { reason })}>Отменить</button>
        </div>
      )}
    </>
  );
}
