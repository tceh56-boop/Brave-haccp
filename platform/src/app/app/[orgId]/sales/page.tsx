'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { SitePicker } from '@/components/OrgNav';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { dt, n } from '@/lib/fmt';

interface Queue { unmatched: { source: string; name: string; count: number; qty: number }[];
  waiting: { id: string; source: string; name: string; qty: string; sold_at: string; status_label: string; fulfil_error: string | null; dish_id: string | null; site_name: string }[] }
interface Dish { id: string; name: string; kind: string }

const SOURCE: Record<string, string> = { pos: 'Касса ЦЕХ', iiko: 'iiko', r_keeper: 'r_keeper', other: 'Другая касса' };

/** Продажи: очередь несписанного (нет ТТК, не хватает сырья, не сопоставлено), импорт продаж внешней кассы. */
export default function SalesPage() {
  const { org, siteId } = useOrg();
  const [q, setQ] = useState<Queue | null>(null);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const { busy, error, run } = useSubmit();
  const load = useCallback(async () => {
    setQ(await api<Queue>(`/orgs/${org.id}/sales/queue`));
    setDishes((await api<Dish[]>(`/orgs/${org.id}/dishes`)).filter((d) => d.kind === 'dish'));
  }, [org.id]);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}`}>← Управление</Link></p>
      <SitePicker />
      <h1>Продажи и списание</h1>
      <p className="small muted">Каждая продажа списывает сырьё по утверждённой ТТК (FEFO). Если списать нельзя, продажа ждёт здесь — оплата при этом не срывается.</p>
      {error && <div className="err">{error}</div>}
      {msg && <div className="okbox">{msg}</div>}
      {!q ? <p className="muted">Загрузка…</p> : (
        <>
          <div className="card">
            <div className="between"><h2 style={{ margin: 0 }}>Ждут списания: {q.waiting.length}</h2>
              <button className="btn small" disabled={busy || !q.waiting.length} onClick={() => run(async () => {
                const r = await api<{ processed: number; done: number }>(`/orgs/${org.id}/sales/retry`, { body: {} });
                setMsg(`Обработано ${r.processed}, списано ${r.done}.`); await load();
              })}>Повторить списание</button></div>
            {q.waiting.length === 0 ? <p className="small muted">Очередь пуста.</p> : (
              <ul className="list">{q.waiting.slice(0, 100).map((w) => (
                <li key={w.id}><b>{w.name}</b> × {n(w.qty)} <span className="badge warn">{w.status_label}</span>
                  <div className="small muted">{SOURCE[w.source] || w.source} · {w.site_name} · {dt(w.sold_at, org.timezone)}</div>
                  {w.fulfil_error && <div className="small">{w.fulfil_error}</div>}
                  {w.dish_id && <Link className="small" href={`/app/${org.id}/menu/${w.dish_id}`}>ТТК блюда →</Link>}</li>
              ))}</ul>
            )}
          </div>
          {q.unmatched.length > 0 && (
            <div className="card">
              <h2>Не сопоставлено с блюдом</h2>
              <p className="small muted">Сопоставьте название из внешней кассы с блюдом один раз — все такие продажи сразу уйдут на списание.</p>
              {q.unmatched.map((u) => <MapRow key={`${u.source}|${u.name}`} u={u} dishes={dishes} onDone={(m) => { setMsg(m); load(); }} />)}
            </div>
          )}
        </>
      )}
      {siteId && <Import siteId={siteId} onDone={(m) => { setMsg(m); load(); }} />}
    </>
  );
}

function MapRow({ u, dishes, onDone }: { u: Queue['unmatched'][number]; dishes: Dish[]; onDone: (m: string) => void }) {
  const { org } = useOrg();
  const [dishId, setDishId] = useState('');
  const { busy, error, run } = useSubmit();
  return (
    <div className="objrow">
      <div><b>{u.name}</b><div className="small muted">{SOURCE[u.source] || u.source} · продаж {u.count}, порций {n(u.qty)}</div>{error && <div className="err">{error}</div>}</div>
      <div className="row">
        <select aria-label={`Блюдо для ${u.name}`} value={dishId} onChange={(e) => setDishId(e.target.value)} style={{ maxWidth: 180 }}><option value="">— блюдо —</option>{dishes.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <button className="btn small" disabled={busy || !dishId} onClick={() => run(async () => {
          const r = await api<{ matched: number; done?: number }>(`/orgs/${org.id}/sales/map`, { body: { source: u.source, name: u.name, dishId } });
          onDone(`«${u.name}»: сопоставлено продаж ${r.matched}, списано ${r.done || 0}.`);
        })}>OK</button>
      </div>
    </div>
  );
}

/** CSV из внешней кассы: ID;дата;наименование;количество;цена — разделитель «;» или «,», первая строка может быть заголовком. */
function Import({ siteId, onDone }: { siteId: string; onDone: (m: string) => void }) {
  const { org } = useOrg();
  const [source, setSource] = useState('iiko');
  const [text, setText] = useState('');
  const { busy, error, setError, run } = useSubmit();
  const parse = () => {
    const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(l.includes(';') ? ';' : ',').map((c) => c.trim().replace(/^"|"$/g, '')));
    const data = rows.filter((r) => r.length >= 5 && !isNaN(Number(r[3].replace(',', '.'))));
    return data.map((r) => {
      const [dd, tt] = r[1].split(/[ T]/);
      const iso = /^\d{2}\.\d{2}\.\d{4}$/.test(dd) ? `${dd.split('.').reverse().join('-')}` : dd;
      return { externalId: r[0], soldAt: tt ? new Date(`${iso}T${tt.length === 5 ? `${tt}:00` : tt}`).toISOString() : iso, name: r[2], qty: Number(r[3].replace(',', '.')), price: Number(r[4].replace(',', '.')) };
    });
  };
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => {
      const rows = parse();
      if (!rows.length) { setError('Не найдено строк формата: ID;дата;наименование;количество;цена'); return; }
      const r = await api<Record<string, number>>(`/orgs/${org.id}/sales/import`, { body: { siteId, source, rows } });
      setText(''); onDone(`Загружено ${r.inserted}, повторов пропущено ${r.duplicates}. Списано ${r.done || 0}, без ТТК ${r.no_ttk || 0}, не сопоставлено ${r.unmatched || 0}, не хватило сырья ${r.failed || 0}.`);
    }); }}>
      <h2>Импорт продаж внешней кассы</h2>
      {error && <div className="err">{error}</div>}
      <label htmlFor="src">Касса</label>
      <select id="src" value={source} onChange={(e) => setSource(e.target.value)}><option value="iiko">iiko</option><option value="r_keeper">r_keeper</option><option value="other">другая</option></select>
      <label htmlFor="csv">Строки продаж (CSV)</label>
      <textarea id="csv" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={'ID;дата;наименование;количество;цена\n10045;21.10.2026 13:05;Бефстроганов;1;450'} />
      <p className="small muted">Повторная загрузка того же файла не дублирует продажи — ID строки уникален. Возвраты — с отрицательным количеством.</p>
      <button className="btn block" disabled={busy || !text.trim()}>Загрузить</button>
    </form>
  );
}
