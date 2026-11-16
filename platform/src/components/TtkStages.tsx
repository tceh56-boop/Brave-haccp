'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';

/** Этапы ТТК: операция → место на 2D-плане → состояние продукта; параметры и контроль — из технологии ТТК. */

interface Stage { operation: string; plan_object_id: string | null; state: string; params: string | null; control: string | null; ccp_code?: string | null; place?: string | null; place_missing?: boolean; plan_id?: string | null }
interface Data { version: { id: string; version: number; status: string; dish: string }; stages: Stage[]; places: { id: string; plan_id: string; label: string }[];
  ccps: { code: string; class: string; description: string; what: string; record_form: string | null }[] }
const STATES: [string, string][] = [['raw', 'сырьё'], ['semi', 'полуфабрикат'], ['ready', 'готовая продукция']];

export function TtkStages({ versionId, editable }: { versionId: string; editable: boolean }) {
  const { org, can } = useOrg();
  const [d, setD] = useState<Data | null>(null);
  const [rows, setRows] = useState<Stage[]>([]);
  const [dirty, setDirty] = useState(false);
  const { busy, error, run, setError } = useSubmit();
  const load = useCallback(() => api<Data>(`/orgs/${org.id}/ttk/${versionId}/stages`).then((x) => { setD(x); setRows(x.stages); setDirty(false); }).catch((e) => setError(e.message)), [org.id, versionId, setError]);
  useEffect(() => { load(); }, [load]);
  if (!d) return null;
  const edit = editable && can('ttk.manage');
  const set = (i: number, p: Partial<Stage>) => { setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r))); setDirty(true); };
  const move = (i: number, k: number) => { const r = [...rows]; [r[i], r[i + k]] = [r[i + k], r[i]]; setRows(r); setDirty(true); };
  const planOf = (id: string | null) => d.places.find((p) => p.id === id)?.plan_id;
  return (
    <div className="card">
      <h2>Этапы и места на плане</h2>
      <p className="small muted">Где выполняется каждая операция: стол, оборудование или зона на 2D-плане. По утверждённой ТТК строится схема движения продукта по плану
        и проверяется поточность (сырьё и готовое не пересекаются). Параметры и контроль — только из технологии ТТК. Этап — ККТ плана ХАССП: при выпуске партии нужен замер по её мониторингу.</p>
      {d.places.length === 0 && <p className="small">На планах пока нет мест. <Link href={`/app/${org.id}/plan`}>Начертить план →</Link></p>}
      {rows.length === 0 && <p className="small muted">Этапы не заданы.</p>}
      <ol style={{ paddingLeft: 18 }}>{rows.map((s, i) => (
        <li key={i} style={{ marginBottom: 10 }}>
          {edit ? <>
            <input aria-label={`Операция ${i + 1}`} value={s.operation} onChange={(e) => set(i, { operation: e.target.value })} placeholder="операция: зачистка, нарезка, обжарка, охлаждение…" />
            <div className="grid2" style={{ marginTop: 4 }}>
              <select aria-label={`Место ${i + 1}`} value={s.plan_object_id || ''} onChange={(e) => set(i, { plan_object_id: e.target.value || null })}>
                <option value="">— место не указано —</option>{d.places.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
              <select aria-label={`Состояние ${i + 1}`} value={s.state} onChange={(e) => set(i, { state: e.target.value })}>{STATES.map(([k, l]) => <option key={k} value={k}>после этапа: {l}</option>)}</select>
              <input aria-label={`Параметры ${i + 1}`} value={s.params || ''} onChange={(e) => set(i, { params: e.target.value })} placeholder="режим из ТТК (температура, время)" />
              <input aria-label={`Контроль ${i + 1}`} value={s.control || ''} onChange={(e) => set(i, { control: e.target.value })} placeholder="что контролируется" />
              <select aria-label={`ККТ плана ХАССП ${i + 1}`} value={s.ccp_code || ''} onChange={(e) => set(i, { ccp_code: e.target.value || null })}>
                <option value="">— не ККТ —</option>
                {d.ccps.map((c) => <option key={c.code} value={c.code}>{c.code} {c.class === 'ccp' ? 'ККТ' : 'ОПП'}: {c.what}{c.record_form ? ` (${c.record_form})` : ''}</option>)}
                {s.ccp_code && !d.ccps.some((c) => c.code === s.ccp_code) && <option value={s.ccp_code}>{s.ccp_code} — нет в утверждённом плане</option>}
              </select>
            </div>
            <div className="row" style={{ marginTop: 4 }}>
              {i > 0 && <button type="button" className="btn small secondary" onClick={() => move(i, -1)}>↑</button>}
              {i < rows.length - 1 && <button type="button" className="btn small secondary" onClick={() => move(i, 1)}>↓</button>}
              <button type="button" className="btn small secondary" onClick={() => { setRows(rows.filter((_, j) => j !== i)); setDirty(true); }}>Удалить</button>
            </div>
          </> : <div className="small"><b>{s.operation}</b> · {s.place || (s.place_missing ? <span className="err">место удалено с плана</span> : <span className="muted">место не указано</span>)}
            {' · '}после этапа: {STATES.find(([k]) => k === s.state)?.[1]}{s.params ? ` · ${s.params}` : ''}{s.control ? ` · контроль: ${s.control}` : ''}
            {s.ccp_code && <> · <span className="badge warn">{s.ccp_code}: замер при выпуске</span></>}
            {s.plan_object_id && planOf(s.plan_object_id) && <> · <Link href={`/app/${org.id}/plan/${planOf(s.plan_object_id)}`}>на плане</Link></>}</div>}
        </li>))}</ol>
      {error && <div className="err">{error}</div>}
      {edit && <div className="row">
        <button type="button" className="btn small secondary" onClick={() => { setRows([...rows, { operation: '', plan_object_id: null, state: rows.at(-1)?.state || 'raw', params: null, control: null }]); setDirty(true); }}>Добавить этап</button>
        <button type="button" className="btn small" disabled={busy || !dirty} onClick={() => run(async () => {
          await api(`/orgs/${org.id}/ttk/${versionId}/stages`, { method: 'PUT', body: { stages: rows.map(({ operation, plan_object_id, state, params, control, ccp_code }) => ({ operation, plan_object_id, state, params, control, ccp_code: ccp_code || null })) } }); await load();
        })}>Сохранить этапы</button>
      </div>}
      {!edit && editable === false && d.version.status !== 'draft' && <p className="small muted">Этапы меняются в новой версии ТТК.</p>}
    </div>
  );
}
