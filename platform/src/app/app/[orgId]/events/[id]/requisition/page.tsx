'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { api } from '@/lib/api';

interface Req { event: { number: number; title: string; event_date: string; site_name: string; guests: number }; org: { name: string; legal_form: string | null };
  lines: { product_id: string; name: string; unit: string; qty: number; price: number | null; sum: number | null }[]; total: number | null; see_cost: boolean;
  missing: { dish: string; reason: string }[]; no_price: string[] }

/** Требование в кладовую по плану-меню: сырьё на все порции по утверждённым ТТК, п/ф разложены до сырья. */
const ddmm = (s: string) => s.slice(0, 10).split('-').reverse().join('.');
const money = (v: number | null) => (v === null ? '—' : v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export default function RequisitionPrint({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { org } = useOrg();
  const [x, setX] = useState<Req | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<Req>(`/orgs/${org.id}/events/${id}/requisition`).then(setX).catch((e) => setErr(e.message)); }, [org.id, id]);
  if (err) return <div className="err">{err}</div>;
  if (!x) return <p className="muted">Загрузка…</p>;
  const e = x.event;
  return (
    <>
      <div className="noprint">
        <p className="small"><Link href={`/app/${org.id}/events/${id}`}>← Мероприятие</Link></p>
        <button className="btn block" onClick={() => window.print()}>Печать / сохранить PDF</button>
      </div>
      <article className="tu-doc">
        <div style={{ borderBottom: '1px solid #111' }}>{x.org.name}</div>
        <div style={{ borderBottom: '1px solid #111' }}>{e.site_name}</div>
        <h1>Требование в кладовую № {e.number} от {ddmm(e.event_date)}</h1>
        <p className="tu-center">к плану-меню «{e.title}», {e.guests} гостей</p>
        <div className="scroll">
        <table>
          <thead><tr><th>№</th><th>Наименование</th><th>Ед. изм.</th><th>Кол-во</th>{x.see_cost && <><th>Цена</th><th>Сумма</th></>}</tr></thead>
          <tbody>{x.lines.map((l, k) => (
            <tr key={l.product_id}><td>{k + 1}</td><td>{l.name}</td><td>{l.unit}</td><td style={{ textAlign: 'right' }}>{l.qty.toLocaleString('ru-RU', { maximumFractionDigits: 3 })}</td>
              {x.see_cost && <><td style={{ textAlign: 'right' }}>{money(l.price)}</td><td style={{ textAlign: 'right' }}>{money(l.sum)}</td></>}</tr>))}
            {x.see_cost && <tr><td colSpan={5} style={{ border: 0, textAlign: 'right' }}><b>Итого</b></td><td style={{ textAlign: 'right' }}><b>{money(x.total)}</b></td></tr>}
          </tbody>
        </table>
        </div>
        {x.see_cost && x.no_price.length > 0 && <p className="tu-warn">Нет цены закупки: {x.no_price.join(', ')} — итог неполный.</p>}
        {x.missing.length > 0 && <div className="tu-warn"><b>Не включено:</b><ul>{x.missing.map((m) => <li key={m.dish}>{m.dish} — {m.reason}</li>)}</ul></div>}
        <table style={{ border: 0, marginTop: 20 }}><tbody>
          <tr><td style={{ border: 0 }}>Затребовал (шеф-повар)</td><td style={{ border: 0, borderBottom: '1px solid #111', width: '40%' }} /></tr>
          <tr><td style={{ border: 0, paddingTop: 14 }}>Отпустил (кладовщик)</td><td style={{ border: 0, borderBottom: '1px solid #111' }} /></tr>
          <tr><td style={{ border: 0, paddingTop: 14 }}>Получил</td><td style={{ border: 0, borderBottom: '1px solid #111' }} /></tr>
        </tbody></table>
      </article>
    </>
  );
}
