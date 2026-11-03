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
  label: { id: string; code: string; created_at: string; printed: number } | null;
  recall: { id: string; status: string; hazard: string; root_lot_id: string } | null;
  card: { manufacturer: string | null; supplier: string | null; received_at: string | null; after_opening: { hours: number; basis: string } | null; storage_conditions: string | null;
    storage_place: string | null; receipt: { id: string; date: string | null; document_no: string | null; document_date: string | null } | null; vsd_no: string | null;
    ttk: { dish_id: string; label: string } | null; allergens: string | null; composition: string[] | null; origin: 'production' | 'receipt' | 'unknown' } }

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
  const l = c.lot, k = c.card, tz = org.timezone;
  const tone = l.status !== 'available' ? 'crit' : l.expiry_state === 'ok' ? 'ok' : l.expiry_state === 'expired' ? 'crit' : 'warn';
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/lots`}>← Сроки</Link></p>
      <h1 style={{ marginBottom: 4 }}>{l.product}</h1>
      <p style={{ marginTop: 0 }}><span className={`badge ${tone}`}>{l.status !== 'available' ? l.status_label : l.expiry_label}</span></p>
      <div className="card">
        <dl className="kv">
          <dt>Продукт</dt><dd>{l.product}</dd>
          <dt>Партия</dt><dd>{l.lot_no || 'без номера'}</dd>
          <dt>Изготовитель</dt><dd>{k.manufacturer || <span className="muted">не указан в приёмке</span>}</dd>
          {k.origin !== 'production' && <><dt>Поставщик</dt><dd>{k.supplier || '—'}</dd></>}
          <dt>Дата изготовления</dt><dd>{l.manufactured_at ? d(l.manufactured_at, tz) : <span className="muted">не указана</span>}</dd>
          {k.received_at && <><dt>Дата поступления</dt><dd>{dt(k.received_at, tz)}</dd></>}
          <dt>Годен до</dt><dd>{l.expires_at ? dt(l.expires_at, tz) : 'не подтверждён'}</dd>
          <dt>Основание срока</dt><dd>{l.expiry_basis || '—'}</dd>
          <dt>После вскрытия</dt><dd>{k.after_opening ? `${n(k.after_opening.hours)} ч — ${k.after_opening.basis}` : <span className="muted">правило не задано</span>}</dd>
          {l.opened_at && <><dt>Вскрыто</dt><dd>{dt(l.opened_at, tz)}{c.opened_from && <> · из <Link href={`/app/${org.id}/lots/${c.opened_from.id}`}>исходной тары</Link></>}</dd></>}
          <dt>Условия хранения</dt><dd>{k.storage_conditions || <span className="muted">не указаны</span>}</dd>
          <dt>Количество</dt><dd>{n(l.quantity)} {l.unit}</dd>
          <dt>Место хранения</dt><dd>{l.storage_object_id ? <Link href={`/app/${org.id}/objects/${l.storage_object_id}`}>{l.storage_name}</Link> : '—'} · {l.site_name}</dd>
          <dt>Статус</dt><dd>{l.status_label}</dd>
          {k.receipt && <><dt>Приёмка</dt><dd><Link href={`/app/${org.id}/receipts/${k.receipt.id}`}>{k.receipt.date ? `от ${d(k.receipt.date, tz)}` : 'открыть'}</Link></dd>
            <dt>УПД / накладная</dt><dd>{k.receipt.document_no ? `№ ${k.receipt.document_no}${k.receipt.document_date ? ` от ${d(k.receipt.document_date, tz)}` : ''}` : '—'}</dd>
            <dt>ВСД</dt><dd>{k.vsd_no || <span className="muted">нет (если продукция не подконтрольна — не требуется)</span>}</dd></>}
          {k.ttk && <><dt>ТТК</dt><dd><Link href={`/app/${org.id}/menu/${k.ttk.dish_id}`}>{k.ttk.label}</Link></dd></>}
          {k.composition && <><dt>Состав</dt><dd>{k.composition.join(', ')}</dd></>}
          {k.ttk && k.composition && <><dt>Аллергены</dt><dd>{k.allergens || <span className="muted">не указаны в ТТК</span>}</dd></>}
          {c.label && <><dt>QR-код</dt><dd>этикетка {c.label.code} — в разделе «Этикетка» ниже</dd></>}
          {l.status_reason && <><dt>Причина статуса</dt><dd>{l.status_reason}</dd></>}
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
      {c.recall && <div className={c.recall.status === 'open' ? 'err' : 'note'}>
        {c.recall.status === 'open' ? 'Партия заблокирована по отзыву' : 'Партия была в отзыве'}: {c.recall.hazard}. <Link href={`/app/${org.id}/recalls/${c.recall.id}`}>Открыть отзыв →</Link></div>}
      {can('recall.block') && ['available', 'quarantine', 'blocked'].includes(l.status) && Number(l.quantity) > 0 && c.recall?.status !== 'open' && <BlockLot lotId={lotId} />}
      <Marking c={c} onDone={load} />
      <LotBalance lotId={lotId} reload={c} />
      <LotActions lotId={lotId} status={l.status} quantity={l.quantity} unit={l.unit} onDone={load} />
      {c.tasks.length > 0 && <div className="card"><h3>Открытые задачи</h3><ul className="list">{c.tasks.map((t) => <li key={t.id}>{t.title}</li>)}</ul></div>}
      <Evidence entityType="lot" entityId={lotId} title="Фото маркировки и документы" />
    </>
  );
}

interface Balance { rows: { kind: string; label: string; quantity: number; operations: number; value: number | null }[]; totals: { in: number; out: number; losses: number; adjust: number };
  closing: number; actual: number; mismatch: number | null; losses: { class: string; label: string; quantity: number; value: number | null }[]; value: { remaining: number; losses: number } | null;
  cost_basis: { source: string; formula?: string; method?: string; document_no?: string; unit_price?: number | null; total?: number | null; output?: number; output_unit?: string; receipt_id?: string;
    inputs?: { lot_id: string; lot_no: string | null; product: string; quantity: number; unit: string; unit_price: number | null; amount: number | null }[]; missing_prices?: string[] } | null;
  cost_visible: boolean; lot: { unit: string; unit_price: number | null } }

/** Баланс партии по движениям, потери по классам, себестоимость с раскрытием до исходных партий (ТЗ 3.0 §9.3, §10.3, §13.4). */
function LotBalance({ lotId, reload }: { lotId: string; reload: unknown }) {
  const { org } = useOrg();
  const [b, setB] = useState<Balance | null>(null);
  useEffect(() => { api<Balance>(`/orgs/${org.id}/lots/${lotId}/balance`).then(setB).catch(() => setB(null)); }, [org.id, lotId, reload]);
  if (!b) return null;
  const u = b.lot.unit, money = (v: number | null) => (v === null ? '' : ` · ${n(v)} ₽`);
  const cb = b.cost_basis;
  return (
    <div className="card">
      <h2>Баланс и экономика партии</h2>
      <div className="scroll"><table className="tbl"><thead><tr><th>Движение</th><th>Кол-во, {u}</th>{b.cost_visible && <th>Сумма, ₽</th>}</tr></thead>
        <tbody>{b.rows.map((r) => <tr key={r.label}><td>{r.label}{r.operations > 1 ? <span className="muted"> · {r.operations} опер.</span> : ''}</td><td>{r.quantity > 0 ? '+' : ''}{n(r.quantity)}</td>{b.cost_visible && <td>{r.value === null ? '—' : n(r.value)}</td>}</tr>)}</tbody></table></div>
      <p className="small">Приход {n(b.totals.in)} − расход {n(b.totals.out)} − потери {n(b.totals.losses)}{b.totals.adjust ? ` ± инвентаризация ${n(b.totals.adjust)}` : ''} = <b>{n(b.closing)} {u}</b>;
        остаток партии {n(b.actual)} {u}{b.mismatch === null ? ' — сходится.' : ''}</p>
      {b.mismatch !== null && <div className="err">Баланс не сходится на {n(b.mismatch)} {u} — нужен разбор.</div>}
      {b.losses.length > 0 && <><h3>Потери по классам</h3><ul className="list small">{b.losses.map((x) => <li key={x.class}>{x.label}: {n(x.quantity)} {u}{money(x.value)}</li>)}</ul></>}
      {b.cost_visible && cb && <>
        <h3>Себестоимость</h3>
        {cb.source === 'production' ? <>
          <p className="small">{cb.formula} = {cb.total === null ? 'неизвестно (нет цены у части сырья)' : `${n(cb.total!)} ₽ ÷ ${n(cb.output!)} ${cb.output_unit} = ${n(cb.unit_price ?? 0)} ₽/${cb.output_unit}`} <span className="muted">· метод {cb.method}</span></p>
          <div className="scroll"><table className="tbl"><thead><tr><th>Партия сырья</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr></thead>
            <tbody>{cb.inputs!.map((x) => <tr key={x.lot_id}><td><Link href={`/app/${org.id}/lots/${x.lot_id}`}>{x.product}{x.lot_no ? ` ${x.lot_no}` : ''}</Link></td><td>{n(x.quantity)} {x.unit}</td>
              <td>{x.unit_price === null ? 'нет цены' : `${n(x.unit_price)} ₽`}</td><td>{x.amount === null ? '—' : `${n(x.amount)} ₽`}</td></tr>)}</tbody></table></div>
        </> : <p className="small">Цена {b.lot.unit_price === null ? 'не указана' : `${n(b.lot.unit_price)} ₽/${u}`} — {cb.source === 'receipt' ? 'по строке приёмки' : cb.source}
          {cb.receipt_id && <> (<Link href={`/app/${org.id}/receipts/${cb.receipt_id}`}>{cb.document_no ? `УПД № ${cb.document_no}` : 'приёмка'}</Link>)</>}.</p>}
        {b.value && <p className="small muted">Стоимость остатка {n(b.value.remaining)} ₽ · стоимость потерь {n(b.value.losses)} ₽. Цена партии фиксируется при поступлении или выпуске и не пересчитывается задним числом.</p>}
      </>}
    </div>
  );
}

/** Блокировка при опасности: партия и вся цепочка дочерних партий (ТЗ 3.0 §10.5). */
function BlockLot({ lotId }: { lotId: string }) {
  const { org } = useOrg();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ hazard: '', source: 'internal' });
  const { busy, error, run } = useSubmit();
  if (!open) return <p><button className="btn danger secondary" onClick={() => setOpen(true)}>Заблокировать партию (опасность, отзыв)</button></p>;
  return (
    <div className="card">
      <h2>Заблокировать партию и все дочерние</h2>
      <p className="small muted">Блокируются эта партия и всё, что из неё получено: вскрытая тара, перемещения, полуфабрикаты и блюда с остатком. Система соберёт продажи,
        продукцию и поставщика и поставит задачу ответственному за решение.</p>
      <form onSubmit={(e) => { e.preventDefault(); run(async () => {
        const r = await api<{ id: string }>(`/orgs/${org.id}/lots/${lotId}/block`, { body: f });
        router.push(`/app/${org.id}/recalls/${r.id}`);
      }); }}>
        <label htmlFor="bh">Что обнаружено</label><textarea id="bh" rows={2} value={f.hazard} onChange={(e) => setF({ ...f, hazard: e.target.value })} placeholder="опасность, признаки, номер протокола или письма" />
        <label htmlFor="bs">Источник сведений</label>
        <select id="bs" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
          {[['internal', 'Внутренний контроль'], ['laboratory', 'Лабораторное исследование'], ['supplier', 'Сообщение поставщика или изготовителя'], ['authority', 'Предписание или информация Роспотребнадзора'], ['complaint', 'Жалоба гостя']]
            .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {error && <div className="err">{error}</div>}
        <div className="grid2"><button className="btn danger block" disabled={busy || f.hazard.trim().length < 5}>Заблокировать</button><button type="button" className="btn secondary block" onClick={() => setOpen(false)}>Отмена</button></div>
      </form>
    </div>
  );
}

const REASONS: [string, string][] = [['expired', 'Истёк срок годности'], ['spoiled', 'Порча (признаки порчи)'], ['damaged', 'Повреждение упаковки'], ['quality', 'Несоответствие качества'],
  ['quarantine_reject', 'Забракована по карантину'], ['production_loss', 'Технологические потери (по факту)'], ['recall', 'Отзыв партии (опасность)'], ['other', 'Другое']];
// класс потерь — та же функция, что loss_class в БД (миграция 051)
const LOSS_OF: Record<string, string> = { production_loss: 'технологические', spoiled: 'санитарные', quality: 'санитарные', quarantine_reject: 'санитарные', recall: 'санитарные',
  damaged: 'аварийные', expired: 'коммерческие', other: 'необъяснённые — опишите причину' };
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
            <p className="small muted">Класс потерь: {LOSS_OF[wo.reasonCode]}.</p>
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
