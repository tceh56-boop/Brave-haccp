'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { SitePicker } from '@/components/OrgNav';
import { api } from '@/lib/api';
import { d, n } from '@/lib/fmt';

interface Lot { id: string; product_id: string; product: string; lot_no: string | null; quantity: string; unit: string; expires_at: string | null; expiry_state: string; expiry_label: string; status: string; status_label: string; storage_name: string | null }
const TONE: Record<string, string> = { ok: 'ok', soon: 'warn', expired: 'crit', unconfirmed: 'warn' };
const FILTERS: [string, string][] = [['', 'Все'], ['soon', 'Скоро истекает'], ['expired', 'Истёк'], ['unconfirmed', 'Не подтверждён'], ['quarantine', 'Карантин']];

/** Сроки годности (ТЗ v2 §3): «В норме», «Скоро истекает», «Истёк», «Срок не подтверждён». */
export default function Page() { return <Suspense><LotsPage /></Suspense>; }

function LotsPage() {
  const { org, siteId } = useOrg();
  const productFilter = useSearchParams().get('product');
  const [state, setState] = useState('');
  const [lots, setLots] = useState<Lot[] | null>(null);
  const load = useCallback(() => { if (siteId) api<Lot[]>(`/orgs/${org.id}/sites/${siteId}/lots${state ? `?state=${state}` : ''}`).then(setLots); }, [org.id, siteId, state]);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <SitePicker />
      <p className="small"><Link href={`/app/${org.id}/stock`}>← Склад</Link></p>
      <h1>Сроки годности</h1>
      {productFilter && <p className="small">Показан один товар · <Link href={`/app/${org.id}/lots`}>все партии</Link></p>}
      <div className="chips">{FILTERS.map(([k, l]) => <button key={k} aria-pressed={state === k} onClick={() => setState(k)}>{l}</button>)}</div>
      <div className="card">
        {!lots ? <p className="muted">Загрузка…</p> : lots.length === 0 ? <p className="muted">Партий нет.</p> : (
          <div>{lots.filter((l) => !productFilter || l.product_id === productFilter).map((l) => (
            <Link key={l.id} className="objrow" href={`/app/${org.id}/lots/${l.id}`}>
              <div><b>{l.product}</b><div className="small muted">{l.lot_no || 'без номера'} · {n(l.quantity)} {l.unit}{l.storage_name ? ` · ${l.storage_name}` : ''}</div>
                <div className="small">{l.expires_at ? `до ${d(l.expires_at, org.timezone)}` : 'срок не указан'}</div></div>
              <div className="row">
                {l.status !== 'available' ? <span className="badge crit">{l.status_label}</span> : <span className={`badge ${TONE[l.expiry_state]}`}>{l.expiry_label}</span>}
                <span aria-hidden>›</span>
              </div>
            </Link>
          ))}</div>
        )}
      </div>
    </>
  );
}
