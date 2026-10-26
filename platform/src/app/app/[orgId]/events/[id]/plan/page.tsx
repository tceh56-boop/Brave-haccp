'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { api } from '@/lib/api';
import type { EventData } from '../page';

/**
 * План-меню (как печатная форма Шеф Эксперта): кол-во, себестоимость единицы и всего (по утверждённым ТТК), цена,
 * сумма, прибыль; итоги. Без цены или с неполной себестоимостью — прочерк, итоги помечаются неполными (не ноль).
 */
const ddmm = (s: string) => s.slice(0, 10).split('-').reverse().join('.');
const money = (v: number | null) => (v === null ? '—' : v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const r2 = (v: number) => Math.round(v * 100) / 100;

export default function PlanMenuPrint({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { org } = useOrg();
  const [x, setX] = useState<EventData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<EventData>(`/orgs/${org.id}/events/${id}`).then(setX).catch((e) => setErr(e.message)); }, [org.id, id]);
  if (err) return <div className="err">{err}</div>;
  if (!x) return <p className="muted">Загрузка…</p>;
  const e = x.event;
  const rows = x.items.map((i) => {
    const costAll = i.unit_cost === null ? null : r2(i.unit_cost * i.portions), sum = i.price === null ? null : r2(i.price * i.portions);
    return { ...i, costAll, sum, profit: costAll === null || sum === null ? null : r2(sum - costAll) };
  });
  const total = (f: (r: typeof rows[number]) => number | null) => (rows.every((r) => f(r) !== null) ? r2(rows.reduce((s, r) => s + f(r)!, 0)) : null);
  const tCost = total((r) => r.costAll), tSum = total((r) => r.sum), tProfit = total((r) => r.profit);
  return (
    <>
      <div className="noprint">
        <p className="small"><Link href={`/app/${org.id}/events/${id}`}>← Мероприятие</Link></p>
        <button className="btn block" onClick={() => window.print()}>Печать / сохранить PDF</button>
        {!e.can_see_money && <p className="small muted">Цены и себестоимость вам не показываются.</p>}
      </div>
      <article className="tu-doc">
        <div style={{ borderBottom: '1px solid #111' }}>{org.name}</div>
        <div style={{ borderBottom: '1px solid #111' }}>{e.site_name}</div>
        <h1>План-меню № {e.number} от {ddmm(e.event_date)}</h1>
        <p className="tu-center">{e.title} · {e.guests} гостей</p>
        <div className="scroll">
        <table>
          <thead><tr><th>№</th><th>Наименование</th><th>Кол-во</th><th>С-сть единицы</th><th>С-сть всего</th><th>Цена</th><th>Сумма</th><th>Прибыль</th></tr></thead>
          <tbody>{rows.map((r, k) => (
            <tr key={r.id}><td>{k + 1}</td><td>{r.dish}{!r.ttk_version && <div className="tu-small">нет утверждённой ТТК</div>}</td><td style={{ textAlign: 'right' }}>{r.portions}</td>
              <td style={{ textAlign: 'right' }}>{money(r.unit_cost)}</td><td style={{ textAlign: 'right' }}>{money(r.costAll)}</td><td style={{ textAlign: 'right' }}>{money(r.price)}</td>
              <td style={{ textAlign: 'right' }}>{money(r.sum)}</td><td style={{ textAlign: 'right' }}>{money(r.profit)}</td></tr>))}
            <tr><td colSpan={4} style={{ border: 0 }}><b>Итого</b></td><td style={{ textAlign: 'right' }}><b>{money(tCost)}</b></td><td style={{ border: 0 }} /><td style={{ textAlign: 'right' }}><b>{money(tSum)}</b></td><td style={{ textAlign: 'right' }}><b>{money(tProfit)}</b></td></tr>
          </tbody>
        </table>
        </div>
        {(tCost === null || tSum === null) && <p className="tu-warn">Итоги неполные: у части блюд нет цены продажи или себестоимость неполная (нет цены закупки сырья). Неизвестное не считается нулём.</p>}
        <table style={{ border: 0, marginTop: 20 }}><tbody>
          <tr><td style={{ border: 0 }}>Шеф-повар</td><td style={{ border: 0, borderBottom: '1px solid #111', width: '40%' }} /></tr>
          <tr><td style={{ border: 0, paddingTop: 14 }}>Бухгалтер</td><td style={{ border: 0, borderBottom: '1px solid #111' }} /></tr>
        </tbody></table>
      </article>
    </>
  );
}
