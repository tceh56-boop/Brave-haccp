'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { SitePicker } from '@/components/OrgNav';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';

/** Оборудование площадки: состояние, поверка приборов, сроки ТО; добавление в реестр. */

interface Eq { id: string; name: string; kind_label: string; model: string | null; serial_no: string | null; object_name: string | null; measuring: boolean; calibration_due: string | null;
  maintenance_due: string | null; status: string; status_label: string; calibration: string | null; usable: boolean; reason: string | null; maintenance_overdue: boolean }
interface Obj { id: string; name: string }
const KINDS: [string, string][] = [['cold', 'Холодильное'], ['thermal', 'Тепловое'], ['mechanical', 'Механическое'], ['washing', 'Моечное'], ['instrument', 'Средство измерения (термометр, щуп)'], ['scales', 'Весы'], ['other', 'Прочее']];
const ddmm = (s: string) => s.slice(0, 10).split('-').reverse().join('.');
const empty = { name: '', kind: 'cold', model: '', serialNo: '', inventoryNo: '', controlObjectId: '', calibratedOn: '', calibrationDue: '', calibrationDoc: '', maintenanceDays: '' };

export default function Equipment() {
  const { org, siteId, can } = useOrg();
  const [list, setList] = useState<Eq[] | null>(null);
  const [objects, setObjects] = useState<Obj[]>([]);
  const [f, setF] = useState(empty);
  const { busy, error, run, setError } = useSubmit();
  const load = useCallback(() => { if (siteId) api<Eq[]>(`/orgs/${org.id}/equipment?siteId=${siteId}`).then(setList).catch((e) => setError(e.message)); }, [org.id, siteId, setError]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (siteId && can('equipment.manage')) api<Obj[]>(`/orgs/${org.id}/sites/${siteId}/objects`).then(setObjects).catch(() => setObjects([])); }, [org.id, siteId, can]);
  const measuring = f.kind === 'instrument' || f.kind === 'scales';
  const badge = (e: Eq) => e.status !== 'active' ? <span className="badge crit">{e.status_label}</span>
    : e.measuring && !e.usable ? <span className="badge crit">поверка</span>
      : e.maintenance_overdue ? <span className="badge warn">ТО просрочено</span>
        : e.calibration === 'soon' ? <span className="badge warn">поверка скоро</span> : <span className="badge ok">исправно</span>;
  return (
    <>
      <h1>Оборудование</h1>
      <p className="small muted">Реестр площадки: состояние, поверка приборов, ТО, неисправности и ремонт. Термометр с истёкшей поверкой для замеров не принимается.</p>
      <SitePicker />
      {error && <div className="err">{error}</div>}
      {list && list.length === 0 && <div className="card"><p className="muted">Оборудования в реестре нет.</p></div>}
      {list && list.length > 0 && (
        <div className="card">
          {list.map((e) => (
            <Link key={e.id} href={`/app/${org.id}/equipment/${e.id}`} className="objrow">
              <div><b>{e.name}</b>
                <div className="small muted">{e.kind_label}{e.serial_no ? ` · № ${e.serial_no}` : ''}{e.object_name ? ` · замеры: ${e.object_name}` : ''}</div>
                <div className="small">{e.measuring ? (e.calibration_due ? `поверка до ${ddmm(e.calibration_due)}` : 'нет даты поверки') : ''}{e.measuring && e.maintenance_due ? ' · ' : ''}{e.maintenance_due ? `ТО до ${ddmm(e.maintenance_due)}` : ''}{e.reason && e.status === 'active' ? ` · ${e.reason}` : ''}</div></div>
              {badge(e)}
            </Link>))}
        </div>
      )}
      {can('equipment.manage') && (
        <div className="card">
          <h2>Добавить в реестр</h2>
          <form onSubmit={(ev) => { ev.preventDefault(); run(async () => {
            await api(`/orgs/${org.id}/equipment`, { body: { siteId, name: f.name, kind: f.kind, model: f.model || null, serialNo: f.serialNo || null, inventoryNo: f.inventoryNo || null,
              controlObjectId: f.controlObjectId || null, calibratedOn: measuring ? f.calibratedOn || null : null, calibrationDue: measuring ? f.calibrationDue || null : null,
              calibrationDoc: measuring ? f.calibrationDoc || null : null, maintenanceDays: f.maintenanceDays || null } });
            setF({ ...empty, kind: f.kind }); load();
          }); }}>
            <label htmlFor="en">Наименование</label><input id="en" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Холодильник Polair №1, термометр-щуп" />
            <label htmlFor="ek">Вид</label>
            <select id="ek" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <div className="grid2">
              <div><label htmlFor="em">Модель</label><input id="em" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} /></div>
              <div><label htmlFor="es">Заводской №</label><input id="es" value={f.serialNo} onChange={(e) => setF({ ...f, serialNo: e.target.value })} /></div>
              <div><label htmlFor="ei">Инвентарный №</label><input id="ei" value={f.inventoryNo} onChange={(e) => setF({ ...f, inventoryNo: e.target.value })} /></div>
              <div><label htmlFor="et">ТО раз в, дней</label><input id="et" inputMode="numeric" value={f.maintenanceDays} onChange={(e) => setF({ ...f, maintenanceDays: e.target.value })} placeholder="по паспорту" /></div>
            </div>
            {!measuring && objects.length > 0 && <>
              <label htmlFor="eo">Объект контроля (замеры температуры)</label>
              <select id="eo" value={f.controlObjectId} onChange={(e) => setF({ ...f, controlObjectId: e.target.value })}><option value="">—</option>{objects.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
            </>}
            {measuring && (
              <div className="grid2">
                <div><label htmlFor="ec">Поверка проведена</label><input id="ec" type="date" value={f.calibratedOn} onChange={(e) => setF({ ...f, calibratedOn: e.target.value })} /></div>
                <div><label htmlFor="ed">Действует до</label><input id="ed" type="date" value={f.calibrationDue} onChange={(e) => setF({ ...f, calibrationDue: e.target.value })} /></div>
                <div style={{ gridColumn: '1 / -1' }}><label htmlFor="ef">Документ о поверке</label><input id="ef" value={f.calibrationDoc} onChange={(e) => setF({ ...f, calibrationDoc: e.target.value })} placeholder="свидетельство №, запись ФГИС «Аршин»" /></div>
              </div>
            )}
            {measuring && !f.calibrationDue && <p className="small muted">Без срока поверки прибор не принимается для замеров — внесите его по свидетельству.</p>}
            <button className="btn block" disabled={busy || !siteId}>Добавить</button>
          </form>
        </div>
      )}
    </>
  );
}
