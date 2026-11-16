'use client';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { InstrumentPicker } from '@/components/InstrumentPicker';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { dt, n } from '@/lib/fmt';

interface Rule { id: string; criterion: string; frequency_hours: string | null; source_ref: string; reaction: string | null; version: number; status: string; allow_isolation: boolean; created_by_name?: string; approved_by_name?: string }
interface Hist { id: string; value: string; unit: string; measured_at: string; entered_at: string; is_late: boolean; result: string; author: string; comment: string | null; corrects_id: string | null; correction_reason: string | null }
interface ObjCard {
  object: { id: string; name: string; kind_label: string; site_id: string; site_name: string; code: string; location: string | null };
  rule: Rule | null; due: { state: string; due_at: string | null }; history: Hist[];
  lots: { id: string; product: string; lot_no: string | null; quantity: string; unit: string; status: string }[];
  incident: { id: string; title: string; status: string } | null;
}
const RESULT: Record<string, [string, string]> = { ok: ['в пределе', 'ok'], deviation: ['вне предела', 'crit'], no_criterion: ['критерий не задан', ''] };

/** Карточка объекта (ТЗ v2 §2 пример, §3 «Температура»): последний замер и кнопки действий. */
export default function ObjectPage({ params }: { params: Promise<{ objectId: string }> }) {
  const { objectId } = use(params);
  const { org, can } = useOrg();
  const [c, setC] = useState<ObjCard | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [earlier, setEarlier] = useState(false);
  const [measuredAt, setMeasuredAt] = useState('');
  const [comment, setComment] = useState('');
  const [instrumentId, setInstrumentId] = useState('');
  const [result, setResult] = useState<{ result: string; incidentId: string | null; criterion: string | null } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const { busy, error, run } = useSubmit();
  const load = useCallback(() => api<ObjCard>(`/orgs/${org.id}/objects/${objectId}`).then(setC).catch((e) => setErr(e.message)), [org.id, objectId]);
  useEffect(() => { load(); }, [load]);
  if (err) return <div className="err">{err}</div>;
  if (!c) return <p className="muted">Загрузка…</p>;
  const tz = org.timezone;
  const shown = c.history.filter((h) => !c.history.some((x) => x.corrects_id === h.id));

  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/shift`}>← Смена</Link></p>
      <h1 style={{ marginBottom: 4 }}>{c.object.name}</h1>
      <p className="muted small" style={{ marginTop: 0 }}>{c.object.kind_label} · {c.object.site_name}{c.object.location ? ` · ${c.object.location}` : ''}</p>

      {c.incident && (
        <div className="err">Открыто отклонение: <Link href={`/app/${org.id}/incidents/${c.incident.id}`}><b>{c.incident.title}</b></Link></div>
      )}

      <div className="card">
        <dl className="kv">
          <dt>Предел</dt><dd>{c.rule ? <b>{c.rule.criterion}</b> : <span className="badge warn">не утверждён — замер сохранится без оценки</span>}</dd>
          {c.rule?.frequency_hours && <><dt>Частота</dt><dd>каждые {n(c.rule.frequency_hours)} ч{c.due.due_at ? `, следующий к ${dt(c.due.due_at, tz)}` : ''}</dd></>}
          {c.rule && <><dt>Основание</dt><dd className="small">{c.rule.source_ref}</dd></>}
          {shown[0] && <><dt>Последний</dt><dd>{n(shown[0].value)} {shown[0].unit} · {dt(shown[0].measured_at, tz)} · {shown[0].author}</dd></>}
        </dl>
      </div>

      {can('measure.record') && (
        <div className="card">
          <h2>Замер</h2>
          <form onSubmit={(e) => { e.preventDefault(); run(async () => {
            const body: Record<string, unknown> = { controlObjectId: objectId, value: value.replace(',', '.'), comment: comment || undefined, instrumentId: instrumentId || null };
            if (earlier && measuredAt) body.measuredAt = new Date(measuredAt).toISOString();
            setResult(await api(`/orgs/${org.id}/measurements`, { body }));
            setValue(''); setComment(''); setEarlier(false); await load();
          }); }}>
            <label htmlFor="v">Показание, °C</label>
            <input id="v" ref={input} className="big-input" inputMode="decimal" required autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="4,0" />
            <InstrumentPicker siteId={c.object.site_id} value={instrumentId} onChange={setInstrumentId} />
            <label className="row" style={{ fontWeight: 400 }}>
              <input type="checkbox" style={{ width: 22, minHeight: 22 }} checked={earlier} onChange={(e) => setEarlier(e.target.checked)} /> Замер сделан раньше (вношу позже)
            </label>
            {earlier && <>
              <label htmlFor="mt">Когда измерено</label>
              <input id="mt" type="datetime-local" required value={measuredAt} onChange={(e) => setMeasuredAt(e.target.value)} />
              <p className="small muted">Время внесения сохранится отдельно, замер будет отмечен как поздний. Старше суток внести нельзя.</p>
            </>}
            <label htmlFor="cm">Комментарий {earlier ? '(обязательно)' : ''}</label>
            <input id="cm" value={comment} onChange={(e) => setComment(e.target.value)} required={earlier} />
            {error && <div className="err" role="alert">{error}</div>}
            <button className="btn block" disabled={busy}>Сохранить замер</button>
          </form>
          {result && (
            result.result === 'deviation'
              ? <div className="err" role="alert"><b>Вне предела ({result.criterion?.split(' (')[0]}).</b> Ответственный уведомлён.
                  {c.rule?.reaction && <div style={{ marginTop: 6 }}>{c.rule.reaction}</div>}
                  <div className="row" style={{ marginTop: 10 }}>
                    <button className="btn small secondary" type="button" onClick={() => { setResult(null); input.current?.focus(); }}>Повторить замер</button>
                    {result.incidentId && <Link className="btn small" href={`/app/${org.id}/incidents/${result.incidentId}`}>Открыть отклонение</Link>}
                  </div>
                </div>
              : result.result === 'ok' ? <div className="okbox" role="status">Сохранено: в пределе.</div>
              : <div className="note" role="status">Сохранено. Критерий не утверждён — оценки нет.</div>
          )}
          <div className="row" style={{ marginTop: 10 }}>
            <Link className="btn secondary small" href={`/app/${org.id}/report?entityType=control_object&entityId=${objectId}`}>Сообщить ответственному</Link>
          </div>
        </div>
      )}

      {c.lots.length > 0 && (
        <div className="card">
          <h2>Хранится здесь</h2>
          <ul className="list">{c.lots.map((l) => (
            <li key={l.id} className="between"><Link href={`/app/${org.id}/lots/${l.id}`}>{l.product}{l.lot_no ? ` · ${l.lot_no}` : ''}</Link>
              <span className="row"><span className="small">{n(l.quantity)} {l.unit}</span>{l.status === 'quarantine' && <span className="badge crit">карантин</span>}</span></li>
          ))}</ul>
        </div>
      )}

      <div className="card">
        <h2>История</h2>
        {shown.length === 0 ? <p className="muted">Замеров ещё нет.</p> : (
          <ul className="list">{shown.map((h) => <HistoryRow key={h.id} h={h} tz={tz} onFixed={load} canFix={can('measure.record')} />)}</ul>
        )}
      </div>

      {(can('control.manage') || can('control.approve')) && <Rules objectId={objectId} onChanged={load} />}
    </>
  );
}

function HistoryRow({ h, tz, onFixed, canFix }: { h: Hist; tz: string; onFixed: () => void; canFix: boolean }) {
  const { org } = useOrg();
  const { error, run } = useSubmit();
  return (
    <li>
      <div className="between">
        <div><b>{n(h.value)} {h.unit}</b> <span className="small muted">{dt(h.measured_at, tz)} · {h.author}</span>
          {h.is_late && <div className="small muted">внесено позже: {dt(h.entered_at, tz)}</div>}
          {h.corrects_id && <div className="small muted">исправление: {h.correction_reason}</div>}
          {h.comment && <div className="small">{h.comment}</div>}
        </div>
        <div className="row">
          <span className={`badge ${RESULT[h.result][1]}`}>{RESULT[h.result][0]}</span>
          {canFix && <button className="btn secondary small" onClick={() => {
            const v = prompt('Исправленное значение, °C:'); if (!v) return;
            const reason = prompt('Причина исправления (исходная запись сохранится):'); if (!reason) return;
            run(async () => { await api(`/orgs/${org.id}/measurements/${h.id}/correct`, { body: { value: v.replace(',', '.'), reason } }); onFixed(); });
          }}>Исправить</button>}
        </div>
      </div>
      {error && <div className="err">{error}</div>}
    </li>
  );
}

function Rules({ objectId, onChanged }: { objectId: string; onChanged: () => void }) {
  const { org, can } = useOrg();
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [f, setF] = useState({ minValue: '', maxValue: '', frequencyHours: '', sourceRef: '', reaction: '', allowIsolation: false, requirementId: '' });
  const [linkable, setLinkable] = useState<{ id: string; label: string; state_label: string }[]>([]);
  const { busy, error, run } = useSubmit();
  const load = useCallback(() => api<Rule[]>(`/orgs/${org.id}/objects/${objectId}/rules`).then(setRules), [org.id, objectId]);
  useEffect(() => { load(); if (can('reg.read')) api<typeof linkable>(`/orgs/${org.id}/regulatory/linkable`).then(setLinkable).catch(() => undefined); }, [load, org.id, can]);
  const STATUS: Record<string, string> = { draft: 'проект', approved: 'действует', retired: 'выведено' };
  return (
    <div className="card">
      <h2>Правило контроля</h2>
      <p className="small muted">Пределы и частота — только из подтверждённого требования и утверждённой процедуры. Проект вступает в силу после утверждения ответственным.</p>
      {rules?.map((r) => (
        <div key={r.id} className="between" style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
          <div><b>v{r.version}: {r.criterion}</b>{r.frequency_hours && `, каждые ${n(r.frequency_hours)} ч`}<div className="small muted">{r.source_ref}</div>
            {r.approved_by_name && <div className="small muted">утвердил: {r.approved_by_name}</div>}</div>
          <div className="row"><span className={`badge ${r.status === 'approved' ? 'ok' : r.status === 'draft' ? 'warn' : ''}`}>{STATUS[r.status]}</span>
            {r.status === 'draft' && can('control.approve') && <button className="btn small" onClick={() => run(async () => { await api(`/orgs/${org.id}/rules/${r.id}/approve`, { body: {} }); await load(); onChanged(); })}>Утвердить</button>}</div>
        </div>
      ))}
      {can('control.manage') && (
        <form onSubmit={(e) => { e.preventDefault(); run(async () => {
          await api(`/orgs/${org.id}/objects/${objectId}/rules`, { body: { minValue: f.minValue || null, maxValue: f.maxValue || null, frequencyHours: f.frequencyHours || null, sourceRef: f.sourceRef || null, reaction: f.reaction || null, allowIsolation: f.allowIsolation, requirementId: f.requirementId || null } });
          setF({ minValue: '', maxValue: '', frequencyHours: '', sourceRef: '', reaction: '', allowIsolation: false, requirementId: '' }); await load();
        }); }}>
          <h3 style={{ marginTop: 14 }}>Новый проект правила</h3>
          <div className="grid2">
            <div><label htmlFor="rmin">Не ниже, °C</label><input id="rmin" inputMode="decimal" value={f.minValue} onChange={(e) => setF({ ...f, minValue: e.target.value })} /></div>
            <div><label htmlFor="rmax">Не выше, °C</label><input id="rmax" inputMode="decimal" value={f.maxValue} onChange={(e) => setF({ ...f, maxValue: e.target.value })} /></div>
            <div><label htmlFor="rfr">Замер каждые, ч</label><input id="rfr" inputMode="decimal" value={f.frequencyHours} onChange={(e) => setF({ ...f, frequencyHours: e.target.value })} /></div>
          </div>
          <label htmlFor="rreq">Требование из нормативного реестра</label>
          <select id="rreq" value={f.requirementId} onChange={(e) => setF({ ...f, requirementId: e.target.value })}>
            <option value="">— не из реестра —</option>{linkable.map((r) => <option key={r.id} value={r.id}>{r.label} · {r.state_label}</option>)}
          </select>
          <label htmlFor="rsrc">{f.requirementId ? 'Дополнительно: процедура предприятия (необязательно)' : 'Основание (документ, пункт, утверждённая процедура)'}</label>
          <input id="rsrc" required={!f.requirementId} value={f.sourceRef} onChange={(e) => setF({ ...f, sourceRef: e.target.value })} />
          {linkable.length === 0 && <p className="small muted">В реестре нет применимых требований действующих редакций — укажите основание вручную.</p>}
          <label htmlFor="rre">Реакция на отклонение (утверждённые шаги)</label><textarea id="rre" rows={3} value={f.reaction} onChange={(e) => setF({ ...f, reaction: e.target.value })} />
          <label className="row" style={{ fontWeight: 400 }}><input type="checkbox" style={{ width: 22, minHeight: 22 }} checked={f.allowIsolation} onChange={(e) => setF({ ...f, allowIsolation: e.target.checked })} /> Процедура разрешает изолировать продукцию при отклонении</label>
          {error && <div className="err">{error}</div>}
          <button className="btn block secondary" disabled={busy}>Сохранить проект</button>
        </form>
      )}
    </div>
  );
}
