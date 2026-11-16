'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { SitePicker } from '@/components/OrgNav';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { dt } from '@/lib/fmt';

interface Stop { id: string; dish_id: string; dish: string; reason: string; source: string; created_at: string; who: string | null }
interface Dish { id: string; name: string; kind: string; sale_price: string | null }

/** Стоп-лист площадки: автоматический — по годному остатку и утверждённой ТТК, ручной — с причиной. */
export default function StopListPage() {
  const { org, siteId, can } = useOrg();
  const [stops, setStops] = useState<Stop[] | null>(null);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [f, setF] = useState({ dishId: '', reason: '' });
  const { busy, error, run } = useSubmit();
  const load = useCallback(async () => {
    if (!siteId) return;
    setStops(await api<Stop[]>(`/orgs/${org.id}/sites/${siteId}/stop-list`));
    setDishes((await api<Dish[]>(`/orgs/${org.id}/dishes`)).filter((d) => d.kind === 'dish'));
  }, [org.id, siteId]);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}`}>← Управление</Link></p>
      <SitePicker />
      <h1>Стоп-лист</h1>
      <p className="small muted">Блюдо попадает в стоп само, если по утверждённой ТТК из годного остатка не собрать ни одной порции; снимается само, когда сырьё пришло. Без утверждённой ТТК автоматический стоп не ставится.</p>
      {error && <div className="err">{error}</div>}
      <div className="card">
        {!stops ? <p className="muted">Загрузка…</p> : stops.length === 0 ? <p className="muted">Стоп-лист пуст.</p> : (
          <ul className="list">{stops.map((s) => (
            <li key={s.id} className="between">
              <span><b>{s.dish}</b><div className="small">{s.reason}</div>
                <div className="small muted">{s.source === 'auto' ? 'автоматически' : s.who}, {dt(s.created_at, org.timezone)}</div></span>
              {can('pos.stop') && <button className="btn small secondary" disabled={busy} onClick={() => run(async () => { await api(`/orgs/${org.id}/stop-list/${s.id}`, { method: 'DELETE' }); await load(); })}>Снять</button>}
            </li>
          ))}</ul>
        )}
      </div>
      {can('pos.stop') && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/orgs/${org.id}/stop-list`, { body: { siteId, ...f } }); setF({ dishId: '', reason: '' }); await load(); }); }}>
          <h2>Поставить в стоп</h2>
          <label htmlFor="sd">Блюдо</label>
          <select id="sd" required value={f.dishId} onChange={(e) => setF({ ...f, dishId: e.target.value })}><option value="">— выберите —</option>{dishes.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          <label htmlFor="sr">Причина</label>
          <input id="sr" required value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="например, сломалась фритюрница" />
          <button className="btn block" disabled={busy}>В стоп</button>
        </form>
      )}
    </>
  );
}
