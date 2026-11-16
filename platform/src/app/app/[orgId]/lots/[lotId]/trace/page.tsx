'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { api } from '@/lib/api';
import { d, dt, n } from '@/lib/fmt';

interface Mv { kind: string; quantity: string; unit: string; reason: string | null; created_at: string }
interface Node { id: string; lot_no: string | null; product: string; site: string; quantity: string; unit: string; status_label: string; expires_at: string | null; movements: Mv[]; children: Node[] }
interface Trace { origin: { document_no: string | null; document_date: string | null; completed_at: string; supplier: string | null; supplier_inn: string | null; temperature: string | null; decision: string; accepted_by: string | null; checks: Record<string, boolean> } | null;
  ancestry: { id: string; lot_no: string | null; site: string }[]; lot: Node }

const KIND: Record<string, string> = { receipt: 'Приход', consume: 'Расход', write_off: 'Списание', transfer_out: 'Перемещено', transfer_in: 'Получено', count_adjust: 'Инвентаризация', return_to_supplier: 'Возврат поставщику' };

/** Прослеживаемость партии (ТЗ v2 §4): поставщик → документ → партия → место → движения и дочерние партии. */
export default function TracePage({ params }: { params: Promise<{ lotId: string }> }) {
  const { lotId } = use(params);
  const { org } = useOrg();
  const [t, setT] = useState<Trace | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<Trace>(`/orgs/${org.id}/lots/${lotId}/trace`).then(setT).catch((e) => setErr(e.message)); }, [org.id, lotId]);
  if (err) return <div className="err">{err}</div>;
  if (!t) return <p className="muted">Загрузка…</p>;
  const tz = org.timezone;
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/lots/${lotId}`}>← Партия</Link></p>
      <h1>Прослеживаемость</h1>
      <div className="card">
        <h2>Откуда</h2>
        {t.origin ? (
          <dl className="kv">
            <dt>Поставщик</dt><dd>{t.origin.supplier || '—'}{t.origin.supplier_inn ? ` (ИНН ${t.origin.supplier_inn})` : ''}</dd>
            <dt>Документ</dt><dd>{t.origin.document_no || '—'}{t.origin.document_date ? ` от ${d(t.origin.document_date, tz)}` : ''}</dd>
            <dt>Приёмка</dt><dd>{dt(t.origin.completed_at, tz)}{t.origin.accepted_by ? ` · ${t.origin.accepted_by}` : ''}{t.origin.temperature !== null ? ` · ${n(t.origin.temperature)} °C` : ''}</dd>
          </dl>
        ) : <p className="muted">Партия создана не приёмкой.</p>}
        {t.ancestry.length > 0 && <p className="small">Путь: {t.ancestry.map((a, i) => <span key={a.id}>{i ? ' → ' : ''}<Link href={`/app/${org.id}/lots/${a.id}/trace`}>{a.site}</Link></span>)} → эта партия</p>}
      </div>
      <div className="card"><h2>Куда</h2><Tree node={t.lot} tz={tz} orgId={org.id} /></div>
    </>
  );
}

function Tree({ node, tz, orgId }: { node: Node; tz: string; orgId: string }) {
  return (
    <div style={{ marginLeft: 0 }}>
      <div><b>{node.product}</b> · {node.lot_no || 'без номера'} · {node.site} <span className="badge">{node.status_label}</span> <span className="small muted">остаток {n(node.quantity)} {node.unit}</span></div>
      <ul className="timeline" style={{ marginTop: 8 }}>{node.movements.map((m, i) => (
        <li key={i}><b>{KIND[m.kind] || m.kind}</b> {Number(m.quantity) > 0 ? '+' : ''}{n(m.quantity)} {m.unit} <span className="small muted">· {dt(m.created_at, tz)}</span>{m.reason && <div className="small">{m.reason}</div>}</li>
      ))}</ul>
      {node.children.map((c) => <div key={c.id} style={{ marginLeft: 14, paddingLeft: 10, borderLeft: '2px dashed var(--line)' }}><Link className="small" href={`/app/${orgId}/lots/${c.id}`}>дочерняя партия</Link><Tree node={c} tz={tz} orgId={orgId} /></div>)}
    </div>
  );
}
