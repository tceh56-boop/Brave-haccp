'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';

/** Групповые ТУ (ГОСТ Р 51740-2016): одни ТУ на несколько наименований — ассортимент, код категории ОКПД2, общие требования. */

interface Row { id: string; seq: number; title: string; items: number; last: { version: number; designation: string; approved_at: string } | null }

export default function GroupTuList() {
  const { org, can } = useOrg();
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [dishes, setDishes] = useState<{ id: string; name: string; kind: string }[]>([]);
  const [title, setTitle] = useState('');
  const [pick, setPick] = useState<string[]>([]);
  const { busy, error, run, setError } = useSubmit();
  const load = useCallback(() => api<Row[]>(`/orgs/${org.id}/group-tu`).then(setRows).catch((e) => setError(e.message)), [org.id, setError]);
  useEffect(() => { load(); if (can('ttk.manage')) api<{ id: string; name: string; kind: string }[]>(`/orgs/${org.id}/declarations/products`).then(setDishes).catch(() => api<{ id: string; name: string; kind: string }[]>(`/orgs/${org.id}/dishes`).then(setDishes).catch(() => {})); }, [load, org.id, can]);
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/menu`}>← Блюда и ТТК</Link></p>
      <h1>Групповые технические условия</h1>
      <p className="muted">Одни ТУ на несколько наименований продукции (ГОСТ Р 51740-2016): обобщённое наименование во множественном числе, ассортимент, код ОКПД2 категории, включающей всю продукцию. Продукцию разных видов ОКПД2 с разными показателями и продукцию разных регламентов (мясо / птица) в одни ТУ не включают.</p>
      {error && <div className="err">{error}</div>}
      {can('ttk.manage') && (
        <div className="card">
          <h2>Новые групповые ТУ</h2>
          <form onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await api<{ id: string }>(`/orgs/${org.id}/group-tu`, { body: { title, dishIds: pick } }); router.push(`/app/${org.id}/menu/group-tu/${r.id}`); }); }}>
            <label htmlFor="gt">Обобщённое наименование (во множественном числе)</label>
            <input id="gt" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Полуфабрикаты мясные рубленые" />
            <p className="small"><b>Ассортимент</b> — продукция с утверждённой ТТК (не менее двух):</p>
            <div style={{ maxHeight: 260, overflow: 'auto' }}>{dishes.map((d) => (
              <label key={d.id} className="check"><input type="checkbox" checked={pick.includes(d.id)} onChange={(e) => setPick(e.target.checked ? [...pick, d.id] : pick.filter((x) => x !== d.id))} /> {d.name}</label>))}</div>
            <button className="btn" disabled={busy || pick.length < 2 || title.length < 3}>Создать</button>
          </form>
        </div>)}
      <div className="card">
        {!rows ? <p className="muted">Загрузка…</p> : !rows.length ? <p className="muted">Групповых ТУ нет.</p> : (
          <ul>{rows.map((r) => <li key={r.id}><Link href={`/app/${org.id}/menu/group-tu/${r.id}`}>{r.title}</Link> — наименований: {r.items}{r.last ? `; утверждены: ${r.last.designation}, версия ${r.last.version}` : '; проект'}</li>)}</ul>)}
      </div>
    </>
  );
}
