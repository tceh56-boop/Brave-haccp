'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';

interface Row { id: string; seq: number; title: string; dishes: number; last: { version: number; designation: string; approved_at: string; review_due: string } | null }

/** Стандарты организации (СТО) на группы блюд: список и новый стандарт. */
export default function StoListPage() {
  const { org, can } = useOrg();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [title, setTitle] = useState('');
  const { busy, error, run } = useSubmit();
  useEffect(() => { api<Row[]>(`/orgs/${org.id}/sto`).then(setRows).catch(() => setRows([])); }, [org.id]);
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: org.timezone });
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/menu`}>← Блюда и ТТК</Link></p>
      <h1>Стандарты организации (СТО)</h1>
      <p className="small muted">СТО — на группу однородных блюд (ГОСТ Р 1.4, ГОСТ Р 1.5), по утверждённым ТТК. Утверждает руководитель; срок действия не ограничен,
        актуализация — не реже одного раза в год.</p>
      <div className="card">
        {!rows ? <p className="muted">Загрузка…</p> : rows.length === 0 ? <p className="muted">Стандартов пока нет.</p> : (
          <ul className="list">{rows.map((r) => (
            <li key={r.id}><Link className="between" href={`/app/${org.id}/menu/sto/${r.id}`}>
              <span><b>{r.last?.designation || `СТО № ${r.seq} (проект)`}</b> · {r.title}<div className="small muted">блюд: {r.dishes}{r.last ? ` · изм. ${r.last.version}, актуализировать до ${r.last.review_due.split('-').reverse().join('.')}` : ''}</div></span>
              {r.last ? (r.last.review_due < today ? <span className="badge crit">пора актуализировать</span> : <span className="badge ok">утверждён</span>) : <span className="badge warn">проект</span>}
            </Link></li>))}</ul>
        )}
      </div>
      {can('ttk.manage') && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => { const s = await api<{ id: string }>(`/orgs/${org.id}/sto`, { body: { title } }); location.assign(`/app/${org.id}/menu/sto/${s.id}`); }); }}>
          <label htmlFor="st">Новый стандарт — группа блюд</label>
          <input id="st" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Салаты и холодные закуски" />
          {error && <div className="err">{error}</div>}
          <button className="btn block" disabled={busy}>Создать СТО</button>
        </form>
      )}
    </>
  );
}
