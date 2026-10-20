'use client';
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { d, dt, n } from '@/lib/fmt';

interface LotCard { lot: { id: string; product: string; lot_no: string | null; quantity: string; unit: string; status: string; status_label: string; status_reason: string | null;
  expires_at: string | null; expiry_basis: string | null; expiry_state: string; expiry_label: string; received_at: string; manufactured_at: string | null; storage_name: string | null; storage_object_id: string | null; site_name: string; supplier: string | null; document_no: string | null };
  tasks: { id: string; kind: string; title: string }[] }

export default function LotPage({ params }: { params: Promise<{ lotId: string }> }) {
  const { lotId } = use(params);
  const { org, can } = useOrg();
  const [c, setC] = useState<LotCard | null>(null);
  const [exp, setExp] = useState({ date: '', basis: 'маркировка изготовителя' });
  const [reason, setReason] = useState('');
  const { busy, error, run, setError } = useSubmit();
  const load = useCallback(() => api<LotCard>(`/orgs/${org.id}/lots/${lotId}`).then(setC).catch((e) => setError(e.message)), [org.id, lotId, setError]);
  useEffect(() => { load(); }, [load]);
  if (!c) return error ? <div className="err">{error}</div> : <p className="muted">Загрузка…</p>;
  const l = c.lot, tz = org.timezone;
  const tone = l.status !== 'available' ? 'crit' : l.expiry_state === 'ok' ? 'ok' : l.expiry_state === 'expired' ? 'crit' : 'warn';
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/lots`}>← Сроки</Link></p>
      <h1 style={{ marginBottom: 4 }}>{l.product}</h1>
      <p style={{ marginTop: 0 }}><span className={`badge ${tone}`}>{l.status !== 'available' ? l.status_label : l.expiry_label}</span></p>
      <div className="card">
        <dl className="kv">
          <dt>Партия</dt><dd>{l.lot_no || 'без номера'}</dd>
          <dt>Количество</dt><dd>{n(l.quantity)} {l.unit}</dd>
          <dt>Годен до</dt><dd>{l.expires_at ? `${d(l.expires_at, tz)} — ${l.expiry_basis}` : 'не подтверждён'}</dd>
          {l.manufactured_at && <><dt>Изготовлен</dt><dd>{d(l.manufactured_at, tz)}</dd></>}
          <dt>Принят</dt><dd>{dt(l.received_at, tz)}{l.supplier ? ` · ${l.supplier}` : ''}{l.document_no ? ` · ${l.document_no}` : ''}</dd>
          <dt>Хранение</dt><dd>{l.storage_object_id ? <Link href={`/app/${org.id}/objects/${l.storage_object_id}`}>{l.storage_name}</Link> : '—'} · {l.site_name}</dd>
          {l.status_reason && <><dt>Причина</dt><dd>{l.status_reason}</dd></>}
        </dl>
        {l.status !== 'available' && <div className="err">Партию использовать нельзя.</div>}
        {l.status === 'available' && l.expiry_state === 'unconfirmed' && <div className="note">Срок не подтверждён — партию использовать нельзя до подтверждения срока по основанию.</div>}
      </div>

      {l.expiry_state === 'unconfirmed' && l.status === 'available' && can('receipt.decide') && (
        <div className="card">
          <h2>Подтвердить срок</h2>
          <form onSubmit={(e) => { e.preventDefault(); run(async () => {
            await api(`/orgs/${org.id}/lots/${lotId}/expiry`, { body: { expiresAt: new Date(`${exp.date}T23:59:59`).toISOString(), basis: exp.basis } }); await load();
          }); }}>
            <label htmlFor="ed">Годен до</label><input id="ed" type="date" required value={exp.date} onChange={(e) => setExp({ ...exp, date: e.target.value })} />
            <label htmlFor="eb">Основание</label><input id="eb" required value={exp.basis} onChange={(e) => setExp({ ...exp, basis: e.target.value })} />
            {error && <div className="err">{error}</div>}
            <button className="btn block" disabled={busy}>Подтвердить срок</button>
          </form>
        </div>
      )}

      {l.status === 'quarantine' && can('receipt.decide') && (
        <div className="card">
          <h2>Решение по карантину</h2>
          <label htmlFor="rr">Основание решения</label><input id="rr" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="что проверено, кем, по какой процедуре" />
          {error && <div className="err">{error}</div>}
          <div className="grid2">
            <button className="btn block" disabled={busy} onClick={() => run(async () => { await api(`/orgs/${org.id}/lots/${lotId}/decision`, { body: { decision: 'release', reason } }); await load(); })}>Допустить</button>
            <button className="btn block danger" disabled={busy} onClick={() => run(async () => { await api(`/orgs/${org.id}/lots/${lotId}/decision`, { body: { decision: 'reject', reason } }); await load(); })}>Забраковать</button>
          </div>
        </div>
      )}
      {c.tasks.length > 0 && <div className="card"><h3>Открытые задачи</h3><ul className="list">{c.tasks.map((t) => <li key={t.id}>{t.title}</li>)}</ul></div>}
    </>
  );
}
