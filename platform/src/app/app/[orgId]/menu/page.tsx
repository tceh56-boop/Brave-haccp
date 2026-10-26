'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { n } from '@/lib/fmt';

interface Dish { id: string; name: string; kind: string; category: string | null; sale_price: string | null; approved: { version: number } | null; open: { version: number; status: string } | null; unmatched: number }

/** Блюда и полуфабрикаты с состоянием ТТК: утверждена, черновик, на согласовании; несопоставленное сырьё. */
export default function MenuPage() {
  const { org, can } = useOrg();
  const [rows, setRows] = useState<Dish[] | null>(null);
  const [q, setQ] = useState('');
  const [f, setF] = useState<{ name: string; kind: string; category: string } | null>(null);
  const { busy, error, run } = useSubmit();
  useEffect(() => { api<Dish[]>(`/orgs/${org.id}/dishes`).then(setRows); }, [org.id]);
  const shown = (rows || []).filter((d) => !q || d.name.toLowerCase().includes(q.toLowerCase()));
  const group = (kind: string) => shown.filter((d) => d.kind === kind);
  const unmatched = (rows || []).reduce((s, d) => s + d.unmatched, 0);
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}`}>← Управление</Link></p>
      <h1>Блюда и ТТК</h1>
      <p className="small muted">Списание при продаже и производстве — только по утверждённой ТТК. Утверждает человек; изменения — новой версией.</p>
      {can('ttk.manage') && (
        <div className="tiles">
          <Link className="tile" href={`/app/${org.id}/menu/archive`}>Архив ТТК<span className="sub">559 карт — импорт черновиками</span></Link>
          <Link className="tile" href={`/app/${org.id}/menu/processing`}>Обработка сырья<span className="sub">нормы отходов и потерь</span></Link>
          <Link className={`tile ${unmatched ? 'alert' : ''}`} href={`/app/${org.id}/menu/match`}>Сопоставить сырьё<span className="sub">{unmatched ? `строк без товара: ${unmatched}` : 'всё сопоставлено'}</span></Link>
        </div>
      )}
      <input aria-label="Поиск блюда" placeholder="Найти блюдо" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12 }} />
      {!rows ? <p className="muted">Загрузка…</p> : rows.length === 0 ? <div className="card"><p className="muted">Блюд пока нет. Создайте блюдо или импортируйте карты из архива.</p></div> : (
        ['dish', 'semi'].map((kind) => group(kind).length > 0 && (
          <div className="card" key={kind}>
            <h2>{kind === 'dish' ? 'Блюда' : 'Полуфабрикаты'}</h2>
            {group(kind).map((d) => (
              <Link key={d.id} className="objrow" href={`/app/${org.id}/menu/${d.id}`}>
                <div><b>{d.name}</b><div className="small muted">{[d.category, d.sale_price ? `${n(d.sale_price)} ₽` : ''].filter(Boolean).join(' · ')}</div></div>
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  {d.approved ? <span className="badge ok">утверждена v{d.approved.version}</span> : <span className="badge warn">нет утверждённой</span>}
                  {d.open && <span className="badge">{d.open.status === 'review' ? 'на согласовании' : 'черновик'} v{d.open.version}</span>}
                  {d.unmatched > 0 && <span className="badge crit">без товара: {d.unmatched}</span>}
                  <span aria-hidden>›</span>
                </div>
              </Link>
            ))}
          </div>
        ))
      )}
      {can('ttk.manage') && (
        <div className="card">
          {error && <div className="err">{error}</div>}
          {!f ? <button className="btn block secondary" onClick={() => setF({ name: '', kind: 'dish', category: '' })}>Новое блюдо или полуфабрикат</button> : (
            <form onSubmit={(e) => { e.preventDefault(); run(async () => {
              const d = await api<{ id: string }>(`/orgs/${org.id}/dishes`, { body: { name: f.name, kind: f.kind, category: f.category || null } });
              location.assign(`/app/${org.id}/menu/${d.id}`);
            }); }}>
              <label htmlFor="dn">Название</label><input id="dn" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
              <div className="grid2">
                <div><label htmlFor="dk">Вид</label><select id="dk" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="dish">Блюдо</option><option value="semi">Полуфабрикат</option></select></div>
                <div><label htmlFor="dc">Категория</label><input id="dc" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></div>
              </div>
              <button className="btn block" disabled={busy}>Создать</button>
            </form>
          )}
        </div>
      )}
    </>
  );
}
