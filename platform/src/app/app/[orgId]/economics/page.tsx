'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { api } from '@/lib/api';
import { dt, n } from '@/lib/fmt';

interface Econ { revenue: number; refunds: number; orders: number; avg_check: number | null; payments: Record<string, number>; cogs: number; margin_costed: number; food_cost_pct: number | null;
  complete: boolean; uncosted: { lines: number; amount: number }; write_off: { value: number; unpriced: number };
  top: { name: string; qty: number; revenue: number; cost: number | null; incomplete: boolean }[];
  shifts: { id: string; opened_at: string; closed_at: string | null; status: string; site_name: string; opened_by_name: string; revenue: number | null; cash_diff: number | null }[] }

const ymd = (d: Date, tz: string) => d.toLocaleDateString('sv-SE', { timeZone: tz });

/** Экономика: выручка (касса и импорт), себестоимость фактически списанного, маржа, списания, смены. */
export default function EconomicsPage() {
  const { org, sites } = useOrg();
  const today = ymd(new Date(), org.timezone);
  const [p, setP] = useState({ from: `${today.slice(0, 8)}01`, to: today, siteId: '' });
  const [e, setE] = useState<Econ | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<Econ>(`/orgs/${org.id}/economics?from=${p.from}&to=${p.to}${p.siteId ? `&siteId=${p.siteId}` : ''}`).then((r) => { setE(r); setErr(null); }).catch((x) => setErr(x.message));
  }, [org.id, p]);
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}`}>← Управление</Link></p>
      <h1>Экономика</h1>
      <div className="card">
        <div className="grid2">
          <div><label htmlFor="ef">С</label><input id="ef" type="date" value={p.from} max={p.to} onChange={(x) => x.target.value && setP({ ...p, from: x.target.value })} /></div>
          <div><label htmlFor="et">По</label><input id="et" type="date" value={p.to} min={p.from} onChange={(x) => x.target.value && setP({ ...p, to: x.target.value })} /></div>
        </div>
        {sites.length > 1 && <select aria-label="Площадка" value={p.siteId} onChange={(x) => setP({ ...p, siteId: x.target.value })} style={{ marginTop: 8 }}><option value="">Все площадки</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
      </div>
      {err && <div className="err">{err}</div>}
      {e && (
        <>
          <div className="tiles">
            <div className="tile">{n(e.revenue)} ₽<span className="sub">выручка{e.refunds ? `, возвраты ${n(e.refunds)} ₽` : ''}</span></div>
            <div className="tile">{e.orders}<span className="sub">заказов кассы{e.avg_check ? ` · ср. чек ${n(e.avg_check)} ₽` : ''}</span></div>
            <div className="tile">{n(e.cogs)} ₽<span className="sub">себестоимость списанного</span></div>
            <div className="tile">{e.food_cost_pct !== null ? `${n(e.food_cost_pct)} %` : '—'}<span className="sub">фудкост по списанному</span></div>
          </div>
          {!e.complete && <div className="note">Маржа неполная: {e.uncosted.lines} продаж на {n(e.uncosted.amount)} ₽ без списания по ТТК или без цены партий — <Link href={`/app/${org.id}/sales`}>очередь продаж</Link>. Маржа по списанным: {n(e.margin_costed)} ₽.</div>}
          {e.complete && <div className="okbox">Маржа: <b>{n(e.margin_costed)} ₽</b> — все продажи списаны по ТТК с ценами партий.</div>}
          <div className="card">
            <h2>Оплаты кассы</h2>
            <dl className="kv"><dt>Наличные</dt><dd>{n(e.payments.cash || 0)} ₽</dd><dt>Карта</dt><dd>{n(e.payments.card || 0)} ₽</dd><dt>Прочее</dt><dd>{n(e.payments.other || 0)} ₽</dd>
              <dt>Списания сырья</dt><dd>{n(e.write_off.value)} ₽{e.write_off.unpriced ? ` (без цены: ${e.write_off.unpriced})` : ''}</dd></dl>
          </div>
          <div className="card">
            <h2>Блюда</h2>
            <div className="scroll"><table className="tbl"><thead><tr><th>Блюдо</th><th>Порций</th><th>Выручка</th><th>Себест.</th></tr></thead>
              <tbody>{e.top.map((t) => <tr key={t.name}><td>{t.name}</td><td>{n(t.qty)}</td><td>{n(t.revenue)}</td><td>{t.cost === null ? '—' : n(t.cost)}{t.incomplete ? ' *' : ''}</td></tr>)}</tbody></table></div>
            {e.top.some((t) => t.incomplete) && <p className="small muted">* часть продаж не списана по ТТК — себестоимость неполная.</p>}
          </div>
          <div className="card">
            <h2>Смены</h2>
            {e.shifts.length === 0 ? <p className="small muted">Смен за период нет.</p> : <ul className="list">{e.shifts.map((s) => (
              <li key={s.id} className="between"><span>{dt(s.opened_at, org.timezone)} · {s.site_name}<div className="small muted">{s.opened_by_name}{s.status === 'open' ? ' · открыта' : ''}</div></span>
                <span>{s.revenue !== null ? `${n(s.revenue)} ₽` : ''}{s.cash_diff ? <span className={`badge ${s.cash_diff < 0 ? 'crit' : 'warn'}`}> нал. {n(s.cash_diff)} ₽</span> : null}</span></li>
            ))}</ul>}
          </div>
        </>
      )}
    </>
  );
}
