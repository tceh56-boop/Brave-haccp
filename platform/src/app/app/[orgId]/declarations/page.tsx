'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { STATUS_BADGE, dmy } from '@/lib/declarations';

/** Декларации о соответствии: проекты, принятые, зарегистрированные; новая — на продукцию с утверждённой ТТК. */

interface Row { id: string; number: number; dish: string; scheme: string | null; status: string; status_label: string; registration: { reg_number: string; reg_date: string; valid_to: string | null } | null }

export default function Declarations() {
  const { org, sites, siteId, can } = useOrg();
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [dishId, setDishId] = useState('');
  const [site, setSite] = useState(siteId || sites[0]?.id || '');
  const { busy, error, run, setError } = useSubmit();
  const load = useCallback(() => api<Row[]>(`/orgs/${org.id}/declarations`).then(setRows).catch((e) => setError(e.message)), [org.id, setError]);
  useEffect(() => { load(); if (can('decl.manage')) api<{ id: string; name: string }[]>(`/orgs/${org.id}/declarations/products`).then(setProducts).catch(() => {}); }, [load, org.id, can]);

  return (
    <>
      <h1>Декларации о соответствии</h1>
      <p className="muted">Проект по единой форме (решение Коллегии ЕЭК N 293), схемы — по ТР ТС 021/2011 и ТР ТС 034/2013, комплект доказательств и сведения для регистрации (приказ Минэкономразвития N 478).
        Принимает декларацию руководитель; регистрирует — Росаккредитация в ФГИС с электронной подписью заявителя. Декларация действует со дня регистрации.</p>
      {error && <div className="err" role="alert">{error}</div>}
      {can('decl.manage') && (
        <div className="card">
          <h2>Новая декларация</h2>
          {!products.length ? <p className="small muted">Нет продукции с утверждённой ТТК.</p> : (
            <form onSubmit={(e) => { e.preventDefault(); run(async () => {
              const r = await api<{ id: string }>(`/orgs/${org.id}/declarations`, { body: { dishId, siteId: site } }); router.push(`/app/${org.id}/declarations/${r.id}`);
            }); }}>
              <div className="grid2">
                <div><label htmlFor="dp">Продукция</label>
                  <select id="dp" required value={dishId} onChange={(e) => setDishId(e.target.value)}><option value="">— выберите —</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
                <div><label htmlFor="ds">Площадка изготовления</label>
                  <select id="ds" value={site} onChange={(e) => setSite(e.target.value)}>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              </div>
              <button className="btn" disabled={busy || !dishId || !site}>Создать проект</button>
            </form>)}
        </div>)}
      <div className="card">
        {!rows ? <p className="muted">Загрузка…</p> : !rows.length ? <p className="muted">Деклараций нет.</p> : (
          <div className="scroll"><table className="tbl">
            <thead><tr><th>№</th><th>Продукция</th><th>Схема</th><th>Статус</th><th>Регистрационный номер</th><th>Действует до</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/app/${org.id}/declarations/${r.id}`}>{r.number}</Link></td>
                <td><Link href={`/app/${org.id}/declarations/${r.id}`}>{r.dish}</Link></td>
                <td>{r.scheme || '—'}</td>
                <td><span className={`badge ${STATUS_BADGE[r.status] || ''}`}>{r.status_label}</span></td>
                <td>{r.registration?.reg_number || '—'}</td>
                <td>{r.registration ? (r.registration.valid_to ? dmy(r.registration.valid_to) : 'срок не установлен') : '—'}</td>
              </tr>))}</tbody>
          </table></div>)}
      </div>
    </>
  );
}
