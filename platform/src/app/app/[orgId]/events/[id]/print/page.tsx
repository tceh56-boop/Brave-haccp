'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { api } from '@/lib/api';
import { n } from '@/lib/fmt';
import type { EventData } from '../page';

/** Лист мероприятия для кухни: шапка, меню с порциями и примечаниями, сырьё и п/ф по ТТК. Цены не печатаются. */

const ddmm = (s: string) => s.slice(0, 10).split('-').reverse().join('.');

export default function EventPrint({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { org } = useOrg();
  const [x, setX] = useState<EventData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<EventData>(`/orgs/${org.id}/events/${id}`).then(setX).catch((e) => setErr(e.message)); }, [org.id, id]);
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
        <h1>{e.title}</h1>
        <div className="tu-center">Мероприятие № {e.number} · {ddmm(e.event_date)}{e.event_time ? ` ${e.event_time}` : ''} · {e.guests} гостей{e.format ? ` · ${e.format}` : ''}<br />{org.name}, {e.site_name} · <span className="tu-stamp">{e.status_label.toUpperCase()}</span></div>
        <h2>Меню</h2>
        <table><thead><tr><th>№</th><th>Блюдо</th><th>Порций</th><th>На гостя</th><th>Примечание</th></tr></thead>
          <tbody>{x.items.map((i, k) => <tr key={i.id}><td>{k + 1}</td><td>{i.dish}{i.ttk_version ? ` (ТТК v${i.ttk_version})` : ' — нет утверждённой ТТК'}</td><td>{n(i.portions)}</td><td>{n(i.per_guest ?? Math.round(i.portions / e.guests * 100) / 100)}</td><td>{i.note || ''}</td></tr>)}</tbody></table>
        {x.needs && x.needs.semis.length > 0 && <>
          <h2>Полуфабрикаты</h2>
          <table><thead><tr><th>П/ф</th><th>Нужно, кг</th><th>Готово, кг</th><th>Приготовить, кг</th></tr></thead>
            <tbody>{x.needs.semis.map((s) => <tr key={s.dish_id}><td>{s.name}</td><td>{n(s.need_kg)}</td><td>{n(s.ready_kg)}</td><td>{n(s.to_make_kg)}</td></tr>)}</tbody></table>
        </>}
        {x.needs && x.needs.lines.length > 0 && <>
          <h2>Сырьё по ТТК</h2>
          <table><thead><tr><th>Позиция</th><th>Нужно</th><th>Есть</th><th>Не хватает</th></tr></thead>
            <tbody>{x.needs.lines.map((l) => <tr key={l.product_id}><td>{l.name}</td><td>{n(l.need)} {l.unit}</td><td>{n(l.stock)}</td><td>{l.shortage ? n(l.shortage) : '—'}</td></tr>)}</tbody></table>
        </>}
        {x.needs && x.needs.missing.length > 0 && <div className="tu-warn"><b>Не рассчитано:</b><ul>{x.needs.missing.map((m) => <li key={m.dish}>{m.dish} — {m.reason}</li>)}</ul></div>}
        {e.note && <p>Примечание: {e.note}</p>}
        <p className="tu-small">Сформировано системой «ЦЕХ» по утверждённым ТТК. Ответственный: ____________ / ____________</p>
      </article>
    </>
  );
}
