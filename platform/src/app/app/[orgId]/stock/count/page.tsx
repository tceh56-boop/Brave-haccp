'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { SitePicker } from '@/components/OrgNav';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { d, n } from '@/lib/fmt';

interface Line { id: string; lot_id: string; product: string; lot_no: string | null; unit: string; status: string; expires_at: string | null; expected: string; counted: string | null; note: string | null }
interface Count { count: { id: string; status: string; created_at: string; site: string }; lines: Line[] }

/** Инвентаризация: фактическое количество по каждой партии; расхождения — корректирующими движениями. */
export default function CountPage() {
  const { org, siteId } = useOrg();
  const [c, setC] = useState<Count | null | undefined>(undefined);
  const [done, setDone] = useState<{ lines: number; adjusted: number } | null>(null);
  const { busy, error, run } = useSubmit();
  const load = useCallback(async () => {
    if (!siteId) return;
    const open = await api<{ id: string } | null>(`/orgs/${org.id}/sites/${siteId}/counts/open`);
    setC(open ? await api<Count>(`/orgs/${org.id}/counts/${open.id}`) : null);
  }, [org.id, siteId]);
  useEffect(() => { load(); }, [load]);
  const counted = c ? c.lines.filter((l) => l.counted !== null).length : 0;
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/stock`}>← Склад</Link></p>
      <h1>Инвентаризация</h1>
      <SitePicker />
      {error && <div className="err" role="alert">{error}</div>}
      {done && <div className="okbox">Инвентаризация закрыта: строк {done.lines}, расхождений проведено {done.adjusted}.</div>}
      {c === undefined ? <p className="muted">Загрузка…</p> : c === null ? (
        <div className="card">
          <p>Открытой инвентаризации нет. При начале фиксируется ожидаемый остаток по каждой партии.</p>
          <button className="btn block" disabled={busy} onClick={() => run(async () => { setDone(null); await api(`/orgs/${org.id}/counts`, { body: { siteId } }); await load(); })}>Начать инвентаризацию</button>
        </div>
      ) : (
        <>
          <p className="muted small">Начата {d(c.count.created_at, org.timezone)} · посчитано {counted} из {c.lines.length}</p>
          <div className="card">
            <ul className="list">{c.lines.map((l) => <CountLine key={l.id} countId={c.count.id} l={l} onSaved={load} />)}</ul>
          </div>
          <button className="btn block" disabled={busy || counted < c.lines.length} onClick={() => run(async () => { setDone(await api(`/orgs/${org.id}/counts/${c.count.id}/close`, { body: {} })); await load(); })}>Закрыть и провести расхождения</button>
          {counted < c.lines.length && <p className="small muted">Закрыть можно, когда посчитаны все строки (0 — если партии нет).</p>}
        </>
      )}
    </>
  );
}

function CountLine({ countId, l, onSaved }: { countId: string; l: Line; onSaved: () => void }) {
  const { org } = useOrg();
  const [v, setV] = useState(l.counted ?? '');
  const [note, setNote] = useState(l.note || '');
  const { error, run } = useSubmit();
  const diff = l.counted !== null ? Number(l.counted) - Number(l.expected) : null;
  return (
    <li>
      <div className="between">
        <div><b>{l.product}</b> <span className="small muted">{l.lot_no || 'без номера'}{l.expires_at ? ` · до ${d(l.expires_at, org.timezone)}` : ''}</span>
          <div className="small">по учёту: {n(l.expected)} {l.unit}{diff !== null && Math.abs(diff) > 1e-9 && <b style={{ color: 'var(--crit)' }}> · расхождение {diff > 0 ? '+' : ''}{n(diff)}</b>}</div></div>
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <input aria-label={`Факт ${l.product}`} inputMode="decimal" value={String(v)} onChange={(e) => setV(e.target.value)} placeholder="факт" style={{ flex: 1 }} />
        <input aria-label="Примечание" value={note} onChange={(e) => setNote(e.target.value)} placeholder="примечание" style={{ flex: 2 }} />
        <button className="btn secondary small" onClick={() => run(async () => { await api(`/orgs/${org.id}/counts/${countId}/lines/${l.id}`, { body: { counted: String(v).replace(',', '.'), note: note || null } }); onSaved(); })}>{l.counted !== null ? 'Изменить' : 'Сохранить'}</button>
      </div>
      {error && <div className="err">{error}</div>}
    </li>
  );
}
