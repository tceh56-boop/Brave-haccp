'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { api } from '@/lib/api';
import { d as day, dt, n } from '@/lib/fmt';

/** Паспорт продукта: всё о партии на одном экране — только зарегистрированные данные; чего нет — так и написано. */

interface Origin { lot_id: string; parent_id: string | null; depth: number; link: string | null; quantity: number | null; unit: string | null; product: string; lot_no: string | null; status: string;
  receipt_id: string | null; document_no: string | null; document_date: string | null; received_at: string | null; supplier: string | null; supplier_inn: string | null; manufacturer: string | null;
  vsd_no: string | null; produced_by_order: string | null }
interface Ver { version: number; approved_at: string; designation?: string; approved_by?: string }
interface Passport {
  lot: { id: string; product: string; lot_no: string | null; quantity: number; unit: string; site: string; status: string; status_label: string; manufactured_at: string | null;
    expires_at: string | null; expiry_basis: string | null; expiry_label: string; opened_at: string | null };
  admission: { allowed: boolean; reasons: string[] };
  card: { manufacturer: string | null; storage_conditions: string | null; composition: string[] | null; allergens: string | null; after_opening: { hours: number; basis: string } | null;
    ttk: { dish_id: string; label: string } | null };
  production: { order_id: string; dish: string; site: string; planned_kg: number; actual_kg: number | null; started_at: string | null; started_by: string | null; completed_at: string; completed_by: string;
    organoleptic: string | null; release_decision: string | null; assessed_by: string | null;
    checks: { name: string; unit: string; min_value: string | null; max_value: string | null; basis: string; value: number; ok: boolean; recorded_at: string; recorded_by: string }[];
    deviation: { product_id: string; name: string; unit: string; norm: number | null; fact: number; diff: number | null; diff_pct: number | null }[] | null } | null;
  documents: { ttk: Ver; tu: Ver | null; ti: Ver | null; ppk: Ver | null; haccp: Ver | null } | null;
  origins: Origin[]; labels: { code: string; kind: string; created_at: string; printed: number }[];
  incidents: { id: string; title: string; severity: string; status: string; created_at: string }[];
  recalls: { id: string; status: string; hazard: string; decision: string | null; opened_at: string }[]; missing: string[]; generated_at: string;
}
const LINK: Record<string, string> = { production: 'сырьё выпуска', opened: 'вскрытая тара', transfer: 'перемещение' };

export default function PassportPage({ params }: { params: Promise<{ lotId: string }> }) {
  const { lotId } = use(params);
  const { org } = useOrg();
  const [p, setP] = useState<Passport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<Passport>(`/orgs/${org.id}/lots/${lotId}/passport`).then(setP).catch((e) => setErr(e.message)); }, [org.id, lotId]);
  if (!p) return err ? <div className="err">{err}</div> : <p className="muted">Загрузка…</p>;
  const tz = org.timezone, l = p.lot, pr = p.production, dc = p.documents;
  const ver = (v: Ver | null, what: string) => (v ? `${what} версия ${v.version}${v.designation ? ` (${v.designation})` : ''}, утв. ${day(v.approved_at, tz)}` : <span className="muted">{what}: нет утверждённой версии на дату выпуска</span>);
  const raw = p.origins.filter((o) => o.receipt_id);
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/lots/${lotId}`}>← Партия</Link> · <button className="btn small secondary" onClick={() => window.print()}>Печать</button></p>
      <h1 style={{ marginBottom: 4 }}>Паспорт продукта: {l.product}{l.lot_no ? `, партия ${l.lot_no}` : ''}</h1>
      <p style={{ marginTop: 0 }}><span className={`badge ${p.admission.allowed ? 'ok' : 'crit'}`}>{p.admission.allowed ? 'допущено' : 'не допущено'}</span>
        <span className="small muted"> · сформирован {dt(p.generated_at, tz)}</span></p>
      {!p.admission.allowed && <div className="err">Причины: {p.admission.reasons.join('; ')}.</div>}

      <div className="card">
        <h2>Продукт и партия</h2>
        <dl className="kv">
          <dt>Количество</dt><dd>{n(l.quantity)} {l.unit} · {l.site} · {l.status_label}</dd>
          <dt>Изготовлено</dt><dd>{l.manufactured_at ? day(l.manufactured_at, tz) : '—'}{p.card.manufacturer ? ` · ${p.card.manufacturer}` : ''}</dd>
          <dt>Годен до</dt><dd>{l.expires_at ? `${dt(l.expires_at, tz)} (${l.expiry_label.toLowerCase()})` : 'не подтверждён'}{l.expiry_basis ? ` — ${l.expiry_basis}` : ''}</dd>
          <dt>Хранение</dt><dd>{p.card.storage_conditions || <span className="muted">не указано</span>}</dd>
          <dt>После вскрытия</dt><dd>{p.card.after_opening ? `${n(p.card.after_opening.hours)} ч — ${p.card.after_opening.basis}` : <span className="muted">правило не задано</span>}</dd>
          {p.card.composition && <><dt>Состав</dt><dd>{p.card.composition.join(', ')}</dd></>}
          {p.card.ttk && <><dt>Аллергены</dt><dd>{p.card.allergens || <span className="muted">не указаны в ТТК</span>}</dd></>}
        </dl>
      </div>

      {dc && <div className="card">
        <h2>Документы на дату выпуска</h2>
        <ul className="list small">
          <li>{p.card.ttk ? <Link href={`/app/${org.id}/menu/${p.card.ttk.dish_id}`}>ТТК версия {dc.ttk.version}</Link> : `ТТК версия ${dc.ttk.version}`}, утв. {day(dc.ttk.approved_at, tz)}{dc.ttk.approved_by ? `, ${dc.ttk.approved_by}` : ''}</li>
          <li>{ver(dc.tu, 'ТУ')}</li><li>{ver(dc.ti, 'ТИ')}</li><li>{ver(dc.ppk, 'ППК')}</li><li>{ver(dc.haccp, 'План ХАССП')}</li>
        </ul>
      </div>}

      {pr && <div className="card">
        <h2>Выпуск и контроль</h2>
        <dl className="kv">
          <dt>Задание</dt><dd><Link href={`/app/${org.id}/production/${pr.order_id}`}>{pr.dish}</Link> · {pr.site}</dd>
          <dt>Выход</dt><dd>план {n(pr.planned_kg)} кг · факт {pr.actual_kg === null ? '—' : `${n(pr.actual_kg)} кг`}</dd>
          <dt>Выполнил</dt><dd>{pr.started_by ? `начал ${pr.started_by} ${dt(pr.started_at!, tz)}; ` : ''}выпустил {pr.completed_by} {dt(pr.completed_at, tz)}</dd>
          {pr.organoleptic && <><dt>Бракераж</dt><dd>{pr.organoleptic} — {pr.release_decision === 'allowed' ? 'допущено' : 'не допущено'}{pr.assessed_by ? ` (${pr.assessed_by})` : ''}</dd></>}
          <dt>Оборудование, участок</dt><dd className="muted">не регистрируются — нет данных</dd>
        </dl>
        {pr.checks.length > 0 && <><h3>Замеры при выпуске (ККТ)</h3><ul className="list small">{pr.checks.map((c, i) => (
          <li key={i}><span className={`badge ${c.ok ? 'ok' : 'crit'}`}>{n(c.value)} {c.unit}</span> {c.name} ({[c.min_value !== null ? `не ниже ${n(c.min_value)}` : '', c.max_value !== null ? `не выше ${n(c.max_value)}` : ''].filter(Boolean).join(', ')} — {c.basis}) · {c.recorded_by}, {dt(c.recorded_at, tz)}</li>))}</ul></>}
        {pr.deviation && <><h3>Расход: факт против нормы ТТК</h3><ul className="list small">{pr.deviation.map((x) => (
          <li key={x.product_id}>{x.name}: факт {n(x.fact)} {x.unit}{x.norm !== null ? `, норма ${n(x.norm)} ${x.unit} (расчёт)` : ''}{x.diff !== null ? `, отклонение ${x.diff > 0 ? '+' : ''}${n(x.diff)}${x.diff_pct !== null ? ` (${n(x.diff_pct)} %)` : ''}` : ''}</li>))}</ul></>}
      </div>}

      <div className="card">
        <h2>Происхождение сырья</h2>
        {raw.length === 0 && <p className="small muted">Нет партий с приёмкой в цепочке.</p>}
        <div className="scroll"><table className="tbl"><thead><tr><th>Партия</th><th>Связь</th><th>Поставщик</th><th>Документ</th><th>ВСД</th></tr></thead>
          <tbody>{p.origins.filter((o) => o.depth > 0 || o.receipt_id).map((o) => (
            <tr key={`${o.lot_id}-${o.parent_id}`}><td style={{ paddingLeft: 8 + o.depth * 12 }}><Link href={`/app/${org.id}/lots/${o.lot_id}`}>{o.product}{o.lot_no ? ` ${o.lot_no}` : ''}</Link>{o.quantity !== null ? ` · ${n(o.quantity)} ${o.unit}` : ''}</td>
              <td>{o.link ? LINK[o.link] || o.link : 'эта партия'}</td><td>{o.supplier ? `${o.supplier}${o.supplier_inn ? `, ИНН ${o.supplier_inn}` : ''}` : o.produced_by_order ? 'собственный выпуск' : '—'}</td>
              <td>{o.receipt_id ? <Link href={`/app/${org.id}/receipts/${o.receipt_id}`}>{o.document_no ? `№ ${o.document_no}` : 'приёмка'}{o.document_date ? ` от ${day(o.document_date, tz)}` : ''}</Link> : '—'}</td>
              <td>{o.vsd_no || '—'}</td></tr>))}</tbody></table></div>
        <p className="small"><Link href={`/app/${org.id}/lots/${lotId}/trace`}>Куда ушла партия (прослеживаемость вперёд) →</Link></p>
      </div>

      <div className="card">
        <h2>Маркировка, отклонения, отзывы</h2>
        <ul className="list small">
          {p.labels.map((x) => <li key={x.code}>Этикетка {x.code} ({x.kind}) от {dt(x.created_at, tz)} · напечатано {x.printed}</li>)}
          {p.labels.length === 0 && <li className="muted">Этикеток нет.</li>}
          {p.incidents.map((x) => <li key={x.id}><Link href={`/app/${org.id}/incidents/${x.id}`}>{x.title}</Link> · {x.status} · {dt(x.created_at, tz)}</li>)}
          {p.recalls.map((x) => <li key={x.id}><Link href={`/app/${org.id}/recalls/${x.id}`}>Отзыв: {x.hazard}</Link> · {x.status === 'open' ? 'ждёт решения' : x.decision === 'release' ? 'возвращено' : 'списано'}</li>)}
        </ul>
      </div>

      <div className="card">
        <h2>Нет данных</h2>
        <ul className="small">{p.missing.map((x) => <li key={x}>{x}</li>)}</ul>
        <p className="small muted">Паспорт собирается только из зарегистрированных записей. Себестоимость и баланс — в карточке партии (при праве «себестоимость»).</p>
      </div>
    </>
  );
}
