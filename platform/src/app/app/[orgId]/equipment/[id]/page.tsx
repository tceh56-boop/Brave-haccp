'use client';
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { dt } from '@/lib/fmt';
import { Evidence } from '@/components/Evidence';

/** Карточка оборудования: состояние, поверка, ТО; события — неисправность (любой сотрудник), ТО, поверка, ремонт с допуском. */

interface Ev { id: string; kind: string; kind_label: string; happened_on: string; description: string; safety_impact: string | null; performer: string | null; document: string | null;
  next_due: string | null; admitted: boolean | null; incident_id: string | null; recorded_at: string; recorded_by: string }
interface E { equipment: { id: string; name: string; kind_label: string; model: string | null; serial_no: string | null; inventory_no: string | null; object_name: string | null; control_object_id: string | null;
  measuring: boolean; calibrated_on: string | null; calibration_due: string | null; calibration_doc: string | null; maintenance_days: number | null; maintenance_due: string | null;
  status: string; status_label: string; usable: boolean; reason: string | null; maintenance_overdue: boolean }; events: Ev[] }
const ddmm = (s: string | null) => (s ? s.slice(0, 10).split('-').reverse().join('.') : '—');
const empty = { description: '', safetyImpact: '', performer: '', document: '', nextDue: '', happenedOn: '', admitted: '' };

export default function EquipmentCard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { org, can } = useOrg();
  const [x, setX] = useState<E | null>(null);
  const [kind, setKind] = useState('');
  const [f, setF] = useState(empty);
  const [reason, setReason] = useState('');
  const { busy, error, run, setError } = useSubmit();
  const load = useCallback(() => api<E>(`/orgs/${org.id}/equipment/${id}`).then(setX).catch((e) => setError(e.message)), [org.id, id, setError]);
  useEffect(() => { load(); }, [load]);
  if (!x) return error ? <div className="err">{error}</div> : <p className="muted">Загрузка…</p>;
  const e = x.equipment, manage = can('equipment.manage');
  const kinds: [string, string][] = [
    ...(can('equipment.report') && e.status === 'active' ? [['breakdown', 'Неисправность'] as [string, string]] : []),
    ...(manage ? [['maintenance', 'ТО'], ...(e.measuring ? [['calibration', 'Поверка']] : []), ...(e.status === 'broken' ? [['repair', 'Ремонт']] : [])] as [string, string][] : []),
  ];
  const save = () => run(async () => {
    await api(`/orgs/${org.id}/equipment/${id}/events`, { body: { kind, description: f.description, happenedOn: f.happenedOn || null, safetyImpact: f.safetyImpact || null, performer: f.performer || null,
      document: f.document || null, nextDue: f.nextDue || null, admitted: f.admitted === '' ? null : f.admitted === 'yes' } });
    setF(empty); setKind(''); await load();
  });
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/equipment`}>← Оборудование</Link></p>
      <div className="between"><h1 style={{ margin: 0 }}>{e.name}</h1>
        <span className={`badge ${e.status !== 'active' || !e.usable ? 'crit' : e.maintenance_overdue ? 'warn' : 'ok'}`}>{e.status !== 'active' ? e.status_label : e.usable ? 'исправно' : 'не пригоден'}</span></div>
      <p className="muted">{e.kind_label}{e.model ? ` · ${e.model}` : ''}</p>
      {e.reason && e.status === 'active' && <div className="err">Замеры этим прибором не принимаются: {e.reason}.</div>}
      <div className="card">
        <div className="kv">
          {e.serial_no && <><span>Заводской №</span><b>{e.serial_no}</b></>}
          {e.inventory_no && <><span>Инвентарный №</span><b>{e.inventory_no}</b></>}
          {e.object_name && <><span>Замеры</span><b><Link href={`/app/${org.id}/objects/${e.control_object_id}`}>{e.object_name}</Link></b></>}
          {e.measuring && <><span>Поверка</span><b>{e.calibrated_on ? `${ddmm(e.calibrated_on)} → ` : ''}до {ddmm(e.calibration_due)}{e.calibration_doc ? ` · ${e.calibration_doc}` : ''}</b></>}
          {e.maintenance_days && <><span>ТО</span><b>раз в {e.maintenance_days} дн., следующее до {ddmm(e.maintenance_due)}</b></>}
        </div>
      </div>

      {kinds.length > 0 && (
        <div className="card">
          <h2>Записать событие</h2>
          <div className="chips">{kinds.map(([k, l]) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>)}</div>
          {kind && <>
            <label htmlFor="vd">{kind === 'breakdown' ? 'Что случилось' : 'Что сделано'}</label>
            <input id="vd" value={f.description} onChange={(ev) => setF({ ...f, description: ev.target.value })} placeholder={kind === 'breakdown' ? 'не держит температуру, +12 °C' : kind === 'calibration' ? 'поверка в ЦСМ' : 'чистка конденсатора'} />
            {kind === 'breakdown' && <><label htmlFor="vs">Влияние на безопасность продукции</label>
              <input id="vs" value={f.safetyImpact} onChange={(ev) => setF({ ...f, safetyImpact: ev.target.value })} placeholder="в камере мясо — оценить партии (если нет — оставьте пустым)" /></>}
            {kind !== 'breakdown' && <div className="grid2">
              <div><label htmlFor="vh">Дата</label><input id="vh" type="date" value={f.happenedOn} onChange={(ev) => setF({ ...f, happenedOn: ev.target.value })} /></div>
              <div><label htmlFor="vp">Исполнитель</label><input id="vp" value={f.performer} onChange={(ev) => setF({ ...f, performer: ev.target.value })} placeholder="сотрудник или сервис" /></div>
            </div>}
            {kind === 'calibration' && <div className="grid2">
              <div><label htmlFor="vc">Документ</label><input id="vc" value={f.document} onChange={(ev) => setF({ ...f, document: ev.target.value })} placeholder="свидетельство №" /></div>
              <div><label htmlFor="vn">Действует до</label><input id="vn" type="date" value={f.nextDue} onChange={(ev) => setF({ ...f, nextDue: ev.target.value })} /></div>
            </div>}
            {kind === 'repair' && <div className="seg" style={{ marginTop: 10 }}>
              <button type="button" className="yes" aria-pressed={f.admitted === 'yes'} onClick={() => setF({ ...f, admitted: 'yes' })}>Допущено к работе</button>
              <button type="button" className="no" aria-pressed={f.admitted === 'no'} onClick={() => setF({ ...f, admitted: 'no' })}>Не допущено</button>
            </div>}
            {error && <div className="err" role="alert">{error}</div>}
            <button className="btn block" disabled={busy || f.description.trim().length < 3} onClick={save}>Записать</button>
            {kind === 'breakdown' && <p className="small muted">Оборудование станет «неисправно», ответственный получит отклонение.</p>}
          </>}
        </div>
      )}

      <div className="card">
        <h2>История · {x.events.length}</h2>
        {x.events.length === 0 && <p className="small muted">Событий пока нет.</p>}
        <ul className="list">{x.events.map((v) => (
          <li key={v.id}>
            <div className="between"><b>{v.kind_label} · {ddmm(v.happened_on)}</b>
              {v.kind === 'repair' && <span className={`badge ${v.admitted ? 'ok' : 'crit'}`}>{v.admitted ? 'допущено' : 'не допущено'}</span>}</div>
            <div className="small">{v.description}{v.safety_impact ? ` · влияние: ${v.safety_impact}` : ''}{v.document ? ` · ${v.document}, до ${ddmm(v.next_due)}` : ''}</div>
            <div className="small muted">{v.performer ? `${v.performer} · ` : ''}записал(а) {v.recorded_by}, {dt(v.recorded_at, org.timezone)}
              {v.incident_id && <> · <Link href={`/app/${org.id}/incidents/${v.incident_id}`}>отклонение</Link></>}</div>
          </li>))}</ul>
      </div>
      <Evidence entityType="equipment" entityId={e.id} title="Паспорт, свидетельства о поверке, акты" />
      {manage && e.status !== 'retired' && (
        <div className="card">
          <h2>Списать</h2>
          <input aria-label="Причина списания" value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="причина: износ, замена" />
          <button className="btn block danger" disabled={busy || reason.trim().length < 5} onClick={() => run(async () => { await api(`/orgs/${org.id}/equipment/${id}/retire`, { body: { reason } }); await load(); })}>Списать оборудование</button>
        </div>
      )}
    </>
  );
}
