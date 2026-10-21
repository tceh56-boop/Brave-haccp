'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useOrg } from '@/lib/org';
import { SitePicker } from '@/components/OrgNav';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { n } from '@/lib/fmt';

/** Производство п/ф: задания на день по статусам (в работе, план, выпущено), новое задание. */

interface Order { id: string; status: string; status_label: string; planned_g: string; actual_g: string | null; planned_for: string; note: string | null; dish_name: string; ttk_version: number; started_by_name: string | null }
interface Semi { id: string; name: string; version: number; yield_g: string; shelf_life_hours: string | null }
const TONE: Record<string, string> = { in_progress: 'warn', planned: '', done: 'ok', cancelled: '' };
const today = () => new Date().toLocaleDateString('sv-SE');

function Production() {
  const { org, siteId, can } = useOrg();
  const preset = useSearchParams().get('dish') || '';
  const [date, setDate] = useState(today);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [semis, setSemis] = useState<Semi[]>([]);
  const [f, setF] = useState({ dishId: preset, kg: '', note: '' });
  const { busy, error, run, setError } = useSubmit();
  const load = useCallback(() => { if (siteId) api<Order[]>(`/orgs/${org.id}/production?siteId=${siteId}&date=${date}`).then(setOrders).catch((e) => setError(e.message)); }, [org.id, siteId, date, setError]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (can('production.plan')) api<Semi[]>(`/orgs/${org.id}/production/dishes`).then(setSemis).catch(() => setSemis([])); }, [org.id, can]);
  const groups: [string, Order[]][] = [['В работе', (orders || []).filter((o) => o.status === 'in_progress')], ['План', (orders || []).filter((o) => o.status === 'planned')],
    ['Выпущено', (orders || []).filter((o) => o.status === 'done')], ['Отменено', (orders || []).filter((o) => o.status === 'cancelled')]];
  return (
    <>
      <h1>Производство</h1>
      <p className="small muted">Задание на полуфабрикат: «Начать» → замеры при выпуске → «Выпустить партию». Сырьё и готовые п/ф списываются по утверждённой ТТК (FEFO), партия п/ф получает срок из ТТК и этикетку.</p>
      <SitePicker />
      <label htmlFor="pd">Дата</label><input id="pd" type="date" value={date} onChange={(e) => setDate(e.target.value || today())} />
      {error && <div className="err">{error}</div>}
      {orders && orders.length === 0 && <div className="card"><p className="muted">На этот день заданий нет.</p></div>}
      {groups.filter(([, list]) => list.length).map(([title, list]) => (
        <div className="card" key={title}>
          <h2>{title} · {list.length}</h2>
          {list.map((o) => (
            <Link key={o.id} href={`/app/${org.id}/production/${o.id}`} className="objrow">
              <div><b>{o.dish_name}</b>
                <div className="small muted">план {n(Number(o.planned_g) / 1000)} кг{o.actual_g ? ` · выпущено ${n(Number(o.actual_g) / 1000)} кг` : ''} · ТТК v{o.ttk_version}{o.planned_for < date ? ' · с прошлых дней' : ''}{o.started_by_name ? ` · ${o.started_by_name}` : ''}{o.note ? ` · ${o.note}` : ''}</div></div>
              <span className={`badge ${TONE[o.status]}`}>{o.status_label}</span>
            </Link>))}
        </div>
      ))}
      {can('production.plan') && (
        <div className="card">
          <h2>Новое задание</h2>
          {semis.length === 0 ? <p className="small muted">Нет полуфабрикатов с утверждённой ТТК. Создайте п/ф в «Блюда и ТТК» и утвердите карту.</p> : (
            <form onSubmit={(e) => { e.preventDefault(); run(async () => {
              await api(`/orgs/${org.id}/production`, { body: { siteId, dishId: f.dishId, plannedKg: f.kg, plannedFor: date, note: f.note || null } });
              setF({ dishId: '', kg: '', note: '' }); load();
            }); }}>
              <label htmlFor="ps">Полуфабрикат</label>
              <select id="ps" required value={f.dishId} onChange={(e) => setF({ ...f, dishId: e.target.value })}>
                <option value="">— выберите —</option>{semis.map((s) => <option key={s.id} value={s.id}>{s.name} (ТТК v{s.version}{s.shelf_life_hours ? `, срок ${n(s.shelf_life_hours)} ч` : ''})</option>)}
              </select>
              <div className="grid2">
                <div><label htmlFor="pk">Выход, кг</label><input id="pk" required inputMode="decimal" value={f.kg} onChange={(e) => setF({ ...f, kg: e.target.value })} placeholder="2,5" /></div>
                <div><label htmlFor="pn">Комментарий</label><input id="pn" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="к обеду, на банкет" /></div>
              </div>
              <button className="btn block" disabled={busy || !siteId}>Создать задание на {date.split('-').reverse().join('.')}</button>
            </form>
          )}
        </div>
      )}
    </>
  );
}

export default function Page() { return <Suspense><Production /></Suspense>; }
