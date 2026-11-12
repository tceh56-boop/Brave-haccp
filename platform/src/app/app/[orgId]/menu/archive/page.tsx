'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { n } from '@/lib/fmt';

interface Card { id: string; name: string; category_path: string[]; yield_g: string | null; basis: string | null; format: string; lines: number; issues: number; dish_id: string | null }
interface Full extends Omit<Card, 'lines' | 'issues'> { lines: { name: string; unit: string; brutto: number | null; netto: number | null }[]; issues: string[]; technology: string | null; yield_raw: string | null; source_path: string }

/** Архив ТТК (559 карт): поиск, просмотр карты, импорт выбранных в черновики организации. */
export default function ArchivePage() {
  const { org } = useOrg();
  const [data, setData] = useState<{ cards: Card[]; categories: { name: string; n: number }[] } | null>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Full | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const { busy, error, run } = useSubmit();
  const load = useCallback(() => {
    const p = new URLSearchParams(); if (q.trim().length >= 2) p.set('q', q.trim()); if (cat) p.set('category', cat);
    api<typeof data>(`/orgs/${org.id}/ttk-archive?${p}`).then(setData);
  }, [org.id, q, cat]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  const toggle = (id: string) => { const s = new Set(sel); if (s.has(id)) s.delete(id); else s.add(id); setSel(s); };
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/menu`}>← Блюда и ТТК</Link></p>
      <h1>Архив ТТК</h1>
      <p className="small muted">Карты импортируются черновиками: сырьё нужно сопоставить с товарами, выход и сроки — проверить. Замечания карты сохраняются в блюде.</p>
      <input aria-label="Поиск карты" placeholder="Найти карту (от 2 букв)" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 10 }} />
      {data && <div className="chips">
        <button aria-pressed={!cat} onClick={() => setCat(null)}>Все</button>
        {data.categories.map((c) => <button key={c.name} aria-pressed={cat === c.name} onClick={() => setCat(c.name)}>{c.name.replace(/^\d+\s*/, '')} · {c.n}</button>)}
      </div>}
      {error && <div className="err">{error}</div>}
      {done && <div className="okbox">{done} <Link href={`/app/${org.id}/menu`}>К блюдам →</Link></div>}
      {sel.size > 0 && <button className="btn block" disabled={busy} onClick={() => run(async () => {
        const r = await api<{ dishes: number; skipped: number; lines: number; matched: number }>(`/orgs/${org.id}/ttk-archive/import`, { body: { archiveIds: [...sel] } });
        setDone(`Импортировано блюд: ${r.dishes}${r.skipped ? `, уже были: ${r.skipped}` : ''}. Строк сырья: ${r.lines}, сопоставлено сразу: ${r.matched}.`); setSel(new Set()); load();
      })}>Импортировать выбранные: {sel.size}</button>}
      <div className="card">
        {!data ? <p className="muted">Загрузка…</p> : data.cards.length === 0 ? <p className="muted">Ничего не найдено.</p> : data.cards.map((c) => (
          <div key={c.id} className="objrow">
            <label className="row" style={{ fontWeight: 400, flex: 1, margin: 0 }}>
              <input type="checkbox" style={{ width: 22, minHeight: 22 }} disabled={!!c.dish_id} checked={sel.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Выбрать ${c.name}`} />
              <span><b>{c.name}</b><div className="small muted">{c.category_path.slice(1).join(' / ')} · строк {c.lines}{c.yield_g ? ` · выход ${n(c.yield_g)} г` : ''}{c.basis ? ` · на ${c.basis}` : ''}</div></span>
            </label>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              {c.dish_id ? <Link className="badge ok" href={`/app/${org.id}/menu/${c.dish_id}`}>импортирована</Link> : c.issues > 0 && <span className="badge warn">замечаний: {c.issues}</span>}
              <button className="btn small secondary" onClick={() => api<Full>(`/orgs/${org.id}/ttk-archive/${c.id}`).then(setOpen)}>Карта</button>
            </div>
          </div>
        ))}
      </div>
      {open && (
        <div className="card" id="card">
          <div className="between"><h2 style={{ margin: 0 }}>{open.name}</h2><button className="btn small secondary" onClick={() => setOpen(null)}>Закрыть</button></div>
          <p className="small muted">{open.source_path}{open.yield_raw ? ` · выход в карте: ${open.yield_raw}` : ''}</p>
          {open.issues.length > 0 && <div className="note"><b>Замечания:</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{open.issues.map((i) => <li key={i} className="small">{i}</li>)}</ul></div>}
          <div className="scroll"><table className="tbl"><thead><tr><th>Сырьё</th><th>Ед.</th><th>Брутто</th><th>Нетто</th></tr></thead>
            <tbody>{open.lines.map((l, i) => <tr key={i}><td>{l.name}</td><td>{l.unit}</td><td>{n(l.brutto)}</td><td>{n(l.netto)}</td></tr>)}</tbody></table></div>
          {open.technology && <p className="small" style={{ whiteSpace: 'pre-line' }}>{open.technology}</p>}
        </div>
      )}
    </>
  );
}
