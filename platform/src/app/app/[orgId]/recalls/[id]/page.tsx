'use client';
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { dt, n } from '@/lib/fmt';

/** Отзыв партии (ТЗ 3.0 §10.5): что заблокировано, что затронуто, перечень действий, решение ответственного. */

interface TreeLot { id: string; parent_id: string | null; link: string | null; depth: number; lot_no: string | null; product: string; quantity: number; unit: string; status: string; site: string }
interface Sale { id: string; name: string; qty: number; sold_at: string; site: string; from_chain: number; unit: string }
interface Recall { id: string; status: string; hazard: string; source_label: string; opened_at: string; opened_by_name: string; decision: string | null; decision_note: string | null;
  decided_by_name: string | null; decided_at: string | null; root_lot_id: string;
  affected: { lots: TreeLot[]; dishes: { id: string; name: string }[]; sales: Sale[]; possible_sales?: { id: string; name: string; qty: number; sold_at: string; site: string }[]; sold_dishes: { id: string; name: string; qty: number }[];
    origin: { receipt_id: string; document_no: string | null; supplier: string | null; supplier_inn: string | null; supplier_phone: string | null; manufacturer: string | null } | null; actions: string[] };
  held: { lot_id: string; prev_status: string; quantity_at_block: number; quantity: number; status: string; unit: string; lot_no: string | null; product: string; site: string }[] }
const LINK: Record<string, string> = { opened: 'вскрытие', transfer: 'перемещение', production: 'производство' };
const STATUS: Record<string, string> = { available: 'доступна', quarantine: 'карантин', blocked: 'заблокирована', consumed: 'израсходована', written_off: 'списана' };

export default function RecallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { org, can } = useOrg();
  const [r, setR] = useState<Recall | null>(null);
  const [note, setNote] = useState('');
  const { busy, error, run, setError } = useSubmit();
  const load = useCallback(() => api<Recall>(`/orgs/${org.id}/recalls/${id}`).then(setR).catch((e) => setError(e.message)), [org.id, id, setError]);
  useEffect(() => { load(); }, [load]);
  if (!r) return error ? <div className="err">{error}</div> : <p className="muted">Загрузка…</p>;
  const a = r.affected, tz = org.timezone, root = a.lots[0];
  const decide = (decision: string) => run(async () => { await api(`/orgs/${org.id}/recalls/${id}/decide`, { body: { decision, note } }); await load(); });
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/recalls`}>← Отзывы</Link></p>
      <h1 style={{ marginBottom: 4 }}>Отзыв: {root.product}{root.lot_no ? `, партия ${root.lot_no}` : ''}</h1>
      <p style={{ marginTop: 0 }}><span className={`badge ${r.status === 'open' ? 'crit' : 'ok'}`}>{r.status === 'open' ? 'ждёт решения' : r.decision === 'release' ? 'возвращено в оборот' : 'остатки списаны'}</span></p>
      <div className="card">
        <dl className="kv">
          <dt>Опасность</dt><dd>{r.hazard}</dd>
          <dt>Источник сведений</dt><dd>{r.source_label}</dd>
          <dt>Заблокировал(а)</dt><dd>{r.opened_by_name}, {dt(r.opened_at, tz)}</dd>
          {a.origin && <><dt>Поставщик</dt><dd>{a.origin.supplier || '—'}{a.origin.supplier_inn ? `, ИНН ${a.origin.supplier_inn}` : ''}{a.origin.supplier_phone ? `, ${a.origin.supplier_phone}` : ''}</dd>
            <dt>Изготовитель</dt><dd>{a.origin.manufacturer || <span className="muted">не указан в приёмке</span>}</dd>
            <dt>Приёмка</dt><dd><Link href={`/app/${org.id}/receipts/${a.origin.receipt_id}`}>{a.origin.document_no ? `УПД № ${a.origin.document_no}` : 'открыть'}</Link></dd></>}
          {r.decision && <><dt>Решение</dt><dd>{r.decision === 'release' ? 'вернуть в оборот' : 'списать остатки'} — {r.decision_note} ({r.decided_by_name}, {dt(r.decided_at!, tz)})</dd></>}
        </dl>
      </div>

      <div className="card">
        <h2>Перечень действий</h2>
        <ol className="small">{a.actions.map((x) => <li key={x}>{x}</li>)}</ol>
        <p className="small muted">Перечень построен по данным системы на момент блокировки. Незарегистрированные перемещения и расход система не видит — проверьте места хранения физически.</p>
      </div>

      <div className="card">
        <h2>Партии цепочки · {a.lots.length}</h2>
        <div className="tablewrap"><table className="table small">
          <thead><tr><th>Партия</th><th>Как получена</th><th>Площадка</th><th>При блокировке</th><th>Сейчас</th></tr></thead>
          <tbody>{a.lots.map((l) => {
            const h = r.held.find((x) => x.lot_id === l.id);
            return (
              <tr key={l.id}><td style={{ paddingLeft: 8 + l.depth * 16 }}><Link href={`/app/${org.id}/lots/${l.id}`}>{l.product}{l.lot_no ? ` ${l.lot_no}` : ''}</Link></td>
                <td>{l.link ? LINK[l.link] || l.link : 'исходная'}</td><td>{l.site}</td><td>{n(l.quantity)} {l.unit}, {STATUS[l.status] || l.status}</td>
                <td>{h ? `${n(h.quantity)} ${h.unit}, ${STATUS[h.status] || h.status}` : <span className="muted">не блокировалась (нет остатка)</span>}</td></tr>);
          })}</tbody>
        </table></div>
      </div>

      <div className="card">
        <h2>Продукция и продажи</h2>
        <p className="small">Продукция из партий цепочки: {a.dishes.length ? a.dishes.map((d, i) => <span key={d.id}>{i ? ', ' : ''}<Link href={`/app/${org.id}/menu/${d.id}`}>{d.name}</Link></span>) : <span className="muted">нет</span>}</p>
        {a.sales.length === 0 ? <p className="small muted">Продаж, при которых списывались партии цепочки, в системе нет.</p> : (
          <div className="tablewrap"><table className="table small">
            <thead><tr><th>Дата</th><th>Блюдо</th><th>Кол-во</th><th>Списано из цепочки</th><th>Площадка</th></tr></thead>
            <tbody>{a.sales.map((s) => <tr key={s.id}><td>{dt(s.sold_at, tz)}</td><td>{s.name}</td><td>{n(s.qty)}</td><td>{n(s.from_chain)} {s.unit}</td><td>{s.site}</td></tr>)}</tbody>
          </table></div>)}
        {(a.possible_sales?.length ?? 0) > 0 && <>
          <h3>Возможно затронутые продажи (расчёт)</h3>
          <p className="small muted">Продажи по ТТК со списанием не связаны (учёт «только расчёт»): здесь продажи блюд, в ТТК которых есть позиции цепочки, на той же площадке после поступления партии.
            Использовалась ли именно эта партия, система не знает.</p>
          <div className="tablewrap"><table className="table small"><thead><tr><th>Дата</th><th>Блюдо</th><th>Кол-во</th><th>Площадка</th></tr></thead>
            <tbody>{a.possible_sales!.map((s) => <tr key={s.id}><td>{dt(s.sold_at, tz)}</td><td>{s.name}</td><td>{n(s.qty)}</td><td>{s.site}</td></tr>)}</tbody></table></div>
        </>}
      </div>

      {r.status === 'open' && (can('recall.decide') ? (
        <div className="card">
          <h2>Решение</h2>
          <label htmlFor="dn">Обоснование</label>
          <textarea id="dn" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="протокол исследования №…, письмо поставщика №…, заключение" />
          {error && <div className="err">{error}</div>}
          <div className="grid2">
            <button className="btn block" disabled={busy || note.trim().length < 10} onClick={() => { if (confirm('Вернуть все партии цепочки в оборот?')) decide('release'); }}>Вернуть в оборот</button>
            <button className="btn block danger" disabled={busy || note.trim().length < 10} onClick={() => { if (confirm('Списать остатки всех заблокированных партий?')) decide('write_off'); }}>Списать остатки</button>
          </div>
        </div>
      ) : <p className="small muted">Решение принимает ответственный за ХАССП или управляющий.</p>)}
    </>
  );
}
