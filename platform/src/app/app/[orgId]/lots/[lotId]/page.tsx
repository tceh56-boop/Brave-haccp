'use client';
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { d, dt, n } from '@/lib/fmt';
import { useOperationId } from '@/lib/op';
import { Evidence } from '@/components/Evidence';

interface LotCard { lot: { id: string; product: string; lot_no: string | null; quantity: string; unit: string; status: string; status_label: string; status_reason: string | null;
  expires_at: string | null; expiry_basis: string | null; expiry_state: string; expiry_label: string; received_at: string; manufactured_at: string | null; storage_name: string | null; storage_object_id: string | null; site_name: string; supplier: string | null; document_no: string | null;
    opened_at: string | null; opened_shelf_hours: string | null; opened_shelf_basis: string | null };
  tasks: { id: string; kind: string; title: string }[];
  opened_from: { id: string; lot_no: string | null } | null;
  opened: { id: string; quantity: string; unit: string; opened_at: string; expires_at: string; status: string }[];
  label: { id: string; code: string; created_at: string; printed: number } | null }

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
          {l.opened_at && <><dt>Вскрыто</dt><dd>{dt(l.opened_at, tz)}{c.opened_from && <> · из <Link href={`/app/${org.id}/lots/${c.opened_from.id}`}>исходной тары</Link></>}</dd></>}
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
      <Marking c={c} onDone={load} />
      <LotActions lotId={lotId} status={l.status} quantity={l.quantity} unit={l.unit} onDone={load} />
      {c.tasks.length > 0 && <div className="card"><h3>Открытые задачи</h3><ul className="list">{c.tasks.map((t) => <li key={t.id}>{t.title}</li>)}</ul></div>}
      <Evidence entityType="lot" entityId={lotId} title="Фото маркировки и документы" />
    </>
  );
}

const REASONS: [string, string][] = [['expired', 'Истёк срок годности'], ['spoiled', 'Порча (признаки порчи)'], ['damaged', 'Повреждение упаковки'], ['quality', 'Несоответствие качества'],
  ['quarantine_reject', 'Забракована по карантину'], ['production_loss', 'Технологические потери (по факту)'], ['other', 'Другое']];
const KIND: Record<string, string> = { receipt: 'Приход', consume: 'Расход', write_off: 'Списание', transfer_out: 'Перемещено', transfer_in: 'Получено', count_adjust: 'Инвентаризация', return_to_supplier: 'Возврат',
  open_out: 'Вскрыто', open_in: 'Из вскрытой тары' };

/** Этикетка партии и вскрытие тары (новый срок только с основанием). */
function Marking({ c, onDone }: { c: LotCard; onDone: () => void }) {
  const { org, can } = useOrg();
  const router = useRouter();
  const l = c.lot, tz = org.timezone;
  const [f, setF] = useState({ quantity: '', hours: l.opened_shelf_hours ? String(Number(l.opened_shelf_hours)) : '', basis: l.opened_shelf_basis || '' });
  const [showOpen, setShowOpen] = useState(false);
  const op = useOperationId();
  const { busy, error, run } = useSubmit();
  const alive = Number(l.quantity) > 0 && !['consumed', 'written_off'].includes(l.status);
  const canOpen = alive && can('lot.open') && l.status === 'available' && !l.opened_at && ['ok', 'soon'].includes(l.expiry_state);
  const print = (ids: string[]) => router.push(`/app/${org.id}/labels/print?ids=${ids.join(',')}`);
  if (!can('label.print') && !canOpen) return null;
  return (
    <div className="card">
      <div className="between"><h2 style={{ margin: 0 }}>Маркировка</h2>
        {alive && can('label.print') && <button className="btn small" disabled={busy} onClick={() => run(async () => {
          const [lb] = await api<{ id: string }[]>(`/orgs/${org.id}/labels`, { body: { lotIds: [l.id] } }); print([lb.id]);
        })}>Этикетка</button>}
        <Link className="btn small secondary" href={`/app/${org.id}/lots/${l.id}/consumer-label`}>Потребительская этикетка</Link>
      </div>
      <p className="small muted" style={{ marginBottom: 0 }}>{c.label ? `Последняя этикетка ${c.label.code} от ${dt(c.label.created_at, tz)}, напечатано: ${c.label.printed}.` : 'Этикетка ещё не печаталась.'}</p>
      {c.opened.length > 0 && <ul className="list" style={{ marginTop: 8 }}>{c.opened.map((o) => (
        <li key={o.id} className="between"><span>Вскрыто {dt(o.opened_at, tz)} · {n(o.quantity)} {o.unit}</span><Link href={`/app/${org.id}/lots/${o.id}`}>годен до {dt(o.expires_at, tz)} →</Link></li>))}</ul>}
      {canOpen && !showOpen && <button className="btn block secondary" onClick={() => setShowOpen(true)}>Вскрыть тару</button>}
      {canOpen && showOpen && (
        <form onSubmit={(e) => { e.preventDefault(); run(async () => {
          const r = await api<{ label_id: string }>(`/orgs/${org.id}/lots/${l.id}/open`, { body: { quantity: f.quantity ? f.quantity.replace(',', '.') : undefined,
            hours: f.hours ? f.hours.replace(',', '.') : undefined, basis: f.basis || null, operationId: op.id } });
          op.next(); onDone(); print([r.label_id]);
        }); }}>
          <h3 style={{ marginTop: 12 }}>Вскрыть тару</h3>
          <div className="grid2">
            <div><label htmlFor="oq">Сколько вскрыто, {l.unit}</label><input id="oq" inputMode="decimal" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} placeholder={`всё: ${n(l.quantity)}`} /></div>
            <div><label htmlFor="oh">Срок после вскрытия, ч</label><input id="oh" inputMode="decimal" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} required={!l.opened_shelf_hours} placeholder="с маркировки" /></div>
          </div>
          <label htmlFor="ob">Основание срока</label>
          <input id="ob" value={f.basis} onChange={(e) => setF({ ...f, basis: e.target.value })} required={!l.opened_shelf_hours} placeholder="маркировка: «после вскрытия хранить 48 ч при +2…+6 °C»" />
          <p className="small muted">Новый срок — раньше из двух: срок изготовителя или «сейчас + часы после вскрытия». Без основания срок не назначается.</p>
          {error && <div className="err" role="alert">{error}</div>}
          <button className="btn block" disabled={busy}>Вскрыть и напечатать этикетку</button>
        </form>
      )}
      {!showOpen && error && <div className="err" role="alert">{error}</div>}
    </div>
  );
}

/** Журнал движений партии, списание, перемещение, прослеживаемость. */
function LotActions({ lotId, status, quantity, unit, onDone }: { lotId: string; status: string; quantity: string; unit: string; onDone: () => void }) {
  const { org, sites, can } = useOrg();
  const [moves, setMoves] = useState<{ kind: string; quantity: string; unit: string; reason: string | null; created_at: string; who: string | null; fefo_override: boolean }[]>([]);
  const [wo, setWo] = useState({ quantity: '', reasonCode: 'expired', comment: '' });
  const [tr, setTr] = useState({ toSiteId: '', quantity: '' });
  const woOp = useOperationId(), trOp = useOperationId();
  const { busy, error, run } = useSubmit();
  const loadMoves = useCallback(() => api<typeof moves>(`/orgs/${org.id}/lots/${lotId}/movements`).then(setMoves), [org.id, lotId]);
  useEffect(() => { loadMoves(); }, [loadMoves]);
  const open = Number(quantity) > 0 && !['consumed', 'written_off'].includes(status);
  const after = async () => { await loadMoves(); onDone(); };
  return (
    <>
      {error && <div className="err" role="alert">{error}</div>}
      {open && can('stock.write_off') && (
        <div className="card">
          <h2>Списать</h2>
          <form onSubmit={(e) => { e.preventDefault(); run(async () => {
            await api(`/orgs/${org.id}/lots/${lotId}/write-off`, { body: { quantity: wo.quantity ? wo.quantity.replace(',', '.') : undefined, reasonCode: wo.reasonCode, comment: wo.comment || null, operationId: woOp.id } });
            woOp.next(); setWo({ ...wo, quantity: '', comment: '' }); await after();
          }); }}>
            <div className="grid2">
              <div><label htmlFor="wr">Причина</label><select id="wr" value={wo.reasonCode} onChange={(e) => setWo({ ...wo, reasonCode: e.target.value })}>{REASONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
              <div><label htmlFor="wq">Сколько, {unit}</label><input id="wq" inputMode="decimal" value={wo.quantity} onChange={(e) => setWo({ ...wo, quantity: e.target.value })} placeholder={`вся партия: ${n(quantity)}`} /></div>
            </div>
            <label htmlFor="wc">Комментарий</label><input id="wc" value={wo.comment} onChange={(e) => setWo({ ...wo, comment: e.target.value })} required={wo.reasonCode === 'other'} />
            <button className="btn block danger" disabled={busy}>Списать</button>
          </form>
        </div>
      )}
      {open && status === 'available' && can('stock.transfer') && sites.length > 1 && (
        <div className="card">
          <h2>Переместить на другую площадку</h2>
          <form onSubmit={(e) => { e.preventDefault(); run(async () => {
            await api(`/orgs/${org.id}/lots/${lotId}/transfer`, { body: { toSiteId: tr.toSiteId, quantity: tr.quantity ? tr.quantity.replace(',', '.') : undefined, operationId: trOp.id } });
            trOp.next(); setTr({ toSiteId: '', quantity: '' }); await after();
          }); }}>
            <div className="grid2">
              <div><label htmlFor="ts">Куда</label><select id="ts" required value={tr.toSiteId} onChange={(e) => setTr({ ...tr, toSiteId: e.target.value })}><option value="">—</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div><label htmlFor="tq">Сколько, {unit}</label><input id="tq" inputMode="decimal" value={tr.quantity} onChange={(e) => setTr({ ...tr, quantity: e.target.value })} placeholder={`вся партия: ${n(quantity)}`} /></div>
            </div>
            <button className="btn block secondary" disabled={busy}>Переместить</button>
            <p className="small muted">На месте назначения появится партия с тем же сроком и основанием; связь сохраняется для прослеживаемости.</p>
          </form>
        </div>
      )}
      <div className="card">
        <div className="between"><h2 style={{ margin: 0 }}>Движения</h2>{can('trace.read') && <Link className="btn secondary small" href={`/app/${org.id}/lots/${lotId}/trace`}>Прослеживаемость</Link>}</div>
        <ul className="timeline" style={{ marginTop: 10 }}>{moves.map((m, i) => (
          <li key={i}><b>{KIND[m.kind] || m.kind}</b> {Number(m.quantity) > 0 ? '+' : ''}{n(m.quantity)} {m.unit} <span className="small muted">· {dt(m.created_at, org.timezone)}{m.who ? ` · ${m.who}` : ''}</span>
            {m.fefo_override && <span className="badge warn" style={{ marginLeft: 6 }}>не по FEFO</span>}{m.reason && <div className="small">{m.reason}</div>}</li>
        ))}</ul>
      </div>
    </>
  );
}
