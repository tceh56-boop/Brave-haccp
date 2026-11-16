'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { Evidence } from '@/components/Evidence';
import { api } from '@/lib/api';
import { dt } from '@/lib/fmt';

interface Step { id: string; position: number; name: string; description: string | null; confirmed_at: string | null; confirmed_by_name: string | null; confirmation_note: string | null }
interface Monitoring { what: string; where_text: string | null; method: string; frequency: string; critical_limit: string | null; device: string | null; responsible_role: string; responsible_label: string;
  record_form: string | null; corrective_action: string; control_rule_id: string | null; rule_status: string | null; object_name: string | null }
interface Hazard { id: string; code: string; step_id: string; step_name: string; hazard_type: string; type_label: string; description: string; requirement_id: string | null; likelihood: number | null; severity: number | null;
  risk: string; score: number | null; control_measures: string | null; answers: Record<string, boolean>; proposal: string | null; proposal_label: string | null; class: string | null; class_label: string | null;
  class_rationale: string | null; classified_by_name: string | null; monitoring: Monitoring | null }
interface Plan { plan: { id: string; version: number; status: string; status_label: string; scope: string; team: string | null; approved_at: string | null; approved_by_name: string | null; change_reason: string | null };
  steps: Step[]; hazards: Hazard[]; blockers: string[] }
interface Data { versions: { id: string; version: number; status: string; status_label: string; approved_at: string | null }[]; current: Plan | null;
  tree: { key: string; text: string; when?: Record<string, boolean> }[] }
interface Rule { id: string; status: string; object_name: string; site_name: string; min_value: string | null; max_value: string | null; unit: string }
interface Req { id: string; label: string }

const TYPES: [string, string][] = [['biological', 'Биологическая'], ['chemical', 'Химическая'], ['physical', 'Физическая'], ['allergen', 'Аллерген'], ['radiological', 'Радиологическая'], ['other', 'Иная']];
const ROLES: [string, string][] = [['line_staff', 'Сотрудник цеха'], ['chef', 'Шеф / су-шеф'], ['haccp_lead', 'Ответственный ХАССП'], ['technologist', 'Технолог'], ['storekeeper', 'Кладовщик'], ['director', 'Директор']];
const LEVELS = ['1 — низкая', '2 — средняя', '3 — высокая'];

/** План ХАССП: этапы с подтверждением на месте, опасности, дерево решений, класс меры, мониторинг, утверждение версии. */
export default function HaccpPage() {
  return <Suspense fallback={<p className="muted">Загрузка…</p>}><Haccp /></Suspense>;
}

function Haccp() {
  const { org, can } = useOrg();
  const router = useRouter();
  const planId = useSearchParams().get('planId');
  const [data, setData] = useState<Data | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [reqs, setReqs] = useState<Req[]>([]);
  const { busy, error, run, setError } = useSubmit();
  const load = useCallback(() => api<Data>(`/orgs/${org.id}/haccp${planId ? `?planId=${planId}` : ''}`).then(setData).catch((e) => setError(e.message)), [org.id, planId, setError]);
  useEffect(() => { load(); }, [load]);
  const manage = can('haccp.manage');
  const regRead = can('reg.read');
  useEffect(() => {
    if (!manage) return;
    api<Rule[]>(`/orgs/${org.id}/haccp/rules`).then(setRules).catch(() => setRules([]));
    if (regRead) api<Req[]>(`/orgs/${org.id}/regulatory/linkable`).then(setReqs).catch(() => setReqs([]));
  }, [org.id, manage, regRead]);
  if (!data) return error ? <div className="err">{error}</div> : <p className="muted">Загрузка…</p>;
  const cur = data.current;
  const draft = cur?.plan.status === 'draft';
  const canEdit = manage && draft;
  const act = (fn: () => Promise<unknown>) => run(async () => { await fn(); await load(); });

  return (
    <>
      <p className="small"><Link href={`/app/${org.id}`}>← Управление</Link></p>
      <h1>План ХАССП</h1>
      <p className="small muted">Система предлагает по дереву решений, но класс меры (ПРП, ОПРП, ККТ) назначает группа ХАССП с обоснованием. Утверждённая версия не меняется — изменения вносятся новой версией.</p>
      {data.versions.length > 1 && (
        <div className="chips">{data.versions.map((v) => (
          <button key={v.id} aria-pressed={cur?.plan.id === v.id} onClick={() => router.replace(`/app/${org.id}/haccp?planId=${v.id}`)}>v{v.version} · {v.status_label}</button>
        ))}</div>
      )}
      {error && <div className="err" role="alert">{error}</div>}
      {!cur ? (manage ? <CreatePlan onDone={load} /> : <div className="card"><p className="muted">План ХАССП ещё не разработан.</p></div>) : (
        <>
          <PlanHead cur={cur} canEdit={canEdit} onDone={load} />
          {draft && <Approve cur={cur} onDone={load} />}
          {!draft && cur.plan.status === 'approved' && manage && !data.versions.some((v) => v.status === 'draft') && <NewVersion onDone={() => router.replace(`/app/${org.id}/haccp`)} reload={load} />}

          <div className="card">
            <h2>1. Этапы процесса</h2>
            {cur.steps.length === 0 && <p className="small muted">Опишите технологическую схему по порядку: приёмка, хранение, подготовка, тепловая обработка, охлаждение, выдача.</p>}
            <ul className="list">{cur.steps.map((s) => <StepRow key={s.id} s={s} canEdit={canEdit} act={act} busy={busy} />)}</ul>
            {canEdit && <AddStep planId={cur.plan.id} act={act} busy={busy} />}
          </div>

          <div className="card">
            <h2>2. Опасности и меры управления</h2>
            {cur.hazards.length === 0 && <p className="small muted">По каждому этапу — биологические, химические, физические опасности и аллергены. Вероятность и тяжесть оценивает группа ХАССП; «не оценено» не равно нулю.</p>}
            {cur.hazards.map((h) => <HazardCard key={h.id} h={h} steps={cur.steps} tree={data.tree} canEdit={canEdit} rules={rules} reqs={reqs} act={act} busy={busy} />)}
            {canEdit && cur.steps.length > 0 && <AddHazard planId={cur.plan.id} steps={cur.steps} reqs={reqs} act={act} busy={busy} />}
          </div>

          <Matrix hazards={cur.hazards} />
          {cur.plan.status !== 'draft' && <p className="small"><Link href={`/app/${org.id}/journals/J31`}>Реестр анализа опасностей J31 →</Link> · <Link href={`/app/${org.id}/journals/J32`}>Реестр плана ХАССП J32 →</Link></p>}
        </>
      )}
    </>
  );
}

function CreatePlan({ onDone }: { onDone: () => void }) {
  const { org } = useOrg();
  const [f, setF] = useState({ scope: '', team: '' });
  const { busy, error, run } = useSubmit();
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/orgs/${org.id}/haccp`, { body: { scope: f.scope, team: f.team || null } }); onDone(); }); }}>
      <h2>Начать план ХАССП</h2>
      {error && <div className="err">{error}</div>}
      <label htmlFor="ps">Область применения</label>
      <textarea id="ps" rows={3} required value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })} placeholder="Какая продукция и процессы, на каких площадках" />
      <label htmlFor="pt">Группа ХАССП</label>
      <input id="pt" value={f.team} onChange={(e) => setF({ ...f, team: e.target.value })} placeholder="ФИО и должности" />
      <button className="btn block" disabled={busy}>Создать проект плана</button>
    </form>
  );
}

function PlanHead({ cur, canEdit, onDone }: { cur: Plan; canEdit: boolean; onDone: () => void }) {
  const { org } = useOrg();
  const p = cur.plan;
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ scope: p.scope, team: p.team || '' });
  const { busy, error, run } = useSubmit();
  return (
    <div className="card">
      <div className="between"><b>Версия {p.version}</b><span className={`badge ${p.status === 'approved' ? 'ok' : p.status === 'draft' ? 'warn' : ''}`}>{p.status_label}</span></div>
      {p.approved_at && <p className="small">Утверждён {dt(p.approved_at, org.timezone)}{p.approved_by_name ? `, ${p.approved_by_name}` : ''}</p>}
      {p.change_reason && <p className="small muted">Причина версии: {p.change_reason}</p>}
      {!edit ? (
        <>
          <p className="small" style={{ whiteSpace: 'pre-line' }}><b>Область:</b> {p.scope}</p>
          {p.team && <p className="small"><b>Группа:</b> {p.team}</p>}
          {canEdit && <button className="btn small secondary" onClick={() => setEdit(true)}>Изменить</button>}
        </>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/orgs/${org.id}/haccp/plans/${p.id}`, { method: 'PATCH', body: { scope: f.scope, team: f.team || null } }); setEdit(false); onDone(); }); }}>
          {error && <div className="err">{error}</div>}
          <label htmlFor="es">Область применения</label><textarea id="es" rows={3} value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })} />
          <label htmlFor="et">Группа ХАССП</label><input id="et" value={f.team} onChange={(e) => setF({ ...f, team: e.target.value })} />
          <div className="row" style={{ marginTop: 10 }}><button className="btn small" disabled={busy}>Сохранить</button><button type="button" className="btn small secondary" onClick={() => setEdit(false)}>Отмена</button></div>
        </form>
      )}
    </div>
  );
}

function Approve({ cur, onDone }: { cur: Plan; onDone: () => void }) {
  const { org, can } = useOrg();
  const { busy, error, run } = useSubmit();
  return (
    <div className="card">
      <h2>Утверждение</h2>
      {error && <div className="err">{error}</div>}
      {cur.blockers.length ? (
        <div className="note"><b>Чтобы утвердить, осталось:</b><ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{cur.blockers.map((b) => <li key={b} className="small">{b}</li>)}</ul></div>
      ) : <div className="okbox">Всё заполнено — план можно утверждать.</div>}
      {can('haccp.approve') ? (
        <button className="btn block" disabled={busy || cur.blockers.length > 0} onClick={() => run(async () => { await api(`/orgs/${org.id}/haccp/plans/${cur.plan.id}/approve`, { body: {} }); onDone(); })}>Утвердить версию {cur.plan.version}</button>
      ) : <p className="small muted">Утверждает владелец, администратор или директор.</p>}
    </div>
  );
}

function NewVersion({ onDone, reload }: { onDone: () => void; reload: () => void }) {
  const { org } = useOrg();
  const [reason, setReason] = useState<string | null>(null);
  const { busy, error, run } = useSubmit();
  return (
    <div className="card">
      {error && <div className="err">{error}</div>}
      {reason === null ? <button className="btn block secondary" onClick={() => setReason('')}>Изменить план — новая версия</button> : (
        <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/orgs/${org.id}/haccp`, { body: { changeReason: reason } }); onDone(); reload(); }); }}>
          <label htmlFor="cr">Причина изменения</label>
          <input id="cr" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Например: новое блюдо, новое оборудование, итог верификации" />
          <button className="btn block" disabled={busy}>Создать проект новой версии</button>
          <p className="small muted">Проект копирует утверждённую версию; она действует, пока новая не утверждена.</p>
        </form>
      )}
    </div>
  );
}

type Act = (fn: () => Promise<unknown>) => void;

function StepRow({ s, canEdit, act, busy }: { s: Step; canEdit: boolean; act: Act; busy: boolean }) {
  const { org } = useOrg();
  const [note, setNote] = useState<string | null>(null);
  const [files, setFiles] = useState(false);
  return (
    <li>
      <div className="between"><span><b>{s.position}. {s.name}</b>{s.description && <div className="small muted">{s.description}</div>}</span>
        {s.confirmed_at ? <span className="badge ok">подтверждён на месте</span> : <span className="badge warn">не подтверждён</span>}</div>
      {s.confirmed_at && <div className="small muted">{s.confirmed_by_name}, {dt(s.confirmed_at, org.timezone)}: {s.confirmation_note}</div>}
      <div className="row" style={{ marginTop: 6 }}>
        {canEdit && !s.confirmed_at && note === null && <button className="btn small secondary" onClick={() => setNote('')}>Подтвердить на месте</button>}
        {canEdit && <button className="btn small secondary" disabled={busy} onClick={() => { if (confirm(`Удалить этап «${s.name}»?`)) act(() => api(`/orgs/${org.id}/haccp/steps/${s.id}`, { method: 'DELETE' })); }}>Удалить</button>}
        <button className="btn small secondary" onClick={() => setFiles(!files)}>{files ? 'Скрыть файлы' : 'Схема, фото'}</button>
      </div>
      {note !== null && (
        <form onSubmit={(e) => { e.preventDefault(); act(() => api(`/orgs/${org.id}/haccp/steps/${s.id}/confirm`, { body: { note } })); setNote(null); }}>
          <label htmlFor={`sn-${s.id}`}>Как подтверждено</label>
          <input id={`sn-${s.id}`} required value={note} onChange={(e) => setNote(e.target.value)} placeholder="Например: проверено на месте с шеф-поваром, схема совпадает" />
          <button className="btn small" disabled={busy} style={{ marginTop: 8 }}>Подтвердить</button>
        </form>
      )}
      {files && <Evidence entityType="haccp_step" entityId={s.id} title="Схема и фото этапа" />}
    </li>
  );
}

function AddStep({ planId, act, busy }: { planId: string; act: Act; busy: boolean }) {
  const { org } = useOrg();
  const [f, setF] = useState({ name: '', description: '' });
  return (
    <form onSubmit={(e) => { e.preventDefault(); act(() => api(`/orgs/${org.id}/haccp/plans/${planId}/steps`, { body: { name: f.name, description: f.description || null } })); setF({ name: '', description: '' }); }}>
      <div className="grid2">
        <div><label htmlFor="stn">Новый этап</label><input id="stn" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Например: Тепловая обработка" /></div>
        <div><label htmlFor="std">Описание</label><input id="std" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
      </div>
      <button className="btn block secondary" disabled={busy}>Добавить этап</button>
    </form>
  );
}

interface HForm { stepId: string; hazardType: string; description: string; requirementId: string; likelihood: string; severity: string; controlMeasures: string }
function HazardFields({ f, setF, steps, reqs, id }: { f: HForm; setF: (f: HForm) => void; steps: Step[]; reqs: Req[]; id: string }) {
  return (
    <>
      <div className="grid2">
        <div><label htmlFor={`hs-${id}`}>Этап</label><select id={`hs-${id}`} value={f.stepId} onChange={(e) => setF({ ...f, stepId: e.target.value })}>{steps.map((s) => <option key={s.id} value={s.id}>{s.position}. {s.name}</option>)}</select></div>
        <div><label htmlFor={`ht-${id}`}>Тип опасности</label><select id={`ht-${id}`} value={f.hazardType} onChange={(e) => setF({ ...f, hazardType: e.target.value })}>{TYPES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      </div>
      <label htmlFor={`hd-${id}`}>Опасность</label>
      <textarea id={`hd-${id}`} rows={2} required value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Что и почему может сделать продукцию небезопасной" />
      <div className="grid2">
        <div><label htmlFor={`hl-${id}`}>Вероятность</label><select id={`hl-${id}`} value={f.likelihood} onChange={(e) => setF({ ...f, likelihood: e.target.value })}><option value="">не оценено</option>{LEVELS.map((l, i) => <option key={l} value={i + 1}>{l}</option>)}</select></div>
        <div><label htmlFor={`hv-${id}`}>Тяжесть</label><select id={`hv-${id}`} value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}><option value="">не оценено</option>{LEVELS.map((l, i) => <option key={l} value={i + 1}>{l}</option>)}</select></div>
      </div>
      <label htmlFor={`hm-${id}`}>Меры управления</label>
      <textarea id={`hm-${id}`} rows={2} value={f.controlMeasures} onChange={(e) => setF({ ...f, controlMeasures: e.target.value })} placeholder="Чем опасность предотвращается или снижается" />
      {reqs.length > 0 && <><label htmlFor={`hr-${id}`}>Требование (из нормативного профиля)</label>
        <select id={`hr-${id}`} value={f.requirementId} onChange={(e) => setF({ ...f, requirementId: e.target.value })}><option value="">— без ссылки —</option>{reqs.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></>}
    </>
  );
}
const hBody = (f: HForm) => ({ ...f, requirementId: f.requirementId || null, likelihood: f.likelihood ? Number(f.likelihood) : null, severity: f.severity ? Number(f.severity) : null, controlMeasures: f.controlMeasures || null });

function AddHazard({ planId, steps, reqs, act, busy }: { planId: string; steps: Step[]; reqs: Req[]; act: Act; busy: boolean }) {
  const { org } = useOrg();
  const empty: HForm = { stepId: steps[0].id, hazardType: 'biological', description: '', requirementId: '', likelihood: '', severity: '', controlMeasures: '' };
  const [f, setF] = useState<HForm | null>(null);
  if (!f) return <button className="btn block secondary" onClick={() => setF(empty)}>Добавить опасность</button>;
  return (
    <form onSubmit={(e) => { e.preventDefault(); act(() => api(`/orgs/${org.id}/haccp/plans/${planId}/hazards`, { body: hBody(f) })); setF(null); }}>
      <h3>Новая опасность</h3>
      <HazardFields f={f} setF={setF} steps={steps} reqs={reqs} id="new" />
      <div className="row" style={{ marginTop: 10 }}><button className="btn small" disabled={busy}>Добавить</button><button type="button" className="btn small secondary" onClick={() => setF(null)}>Отмена</button></div>
    </form>
  );
}

function HazardCard({ h, steps, tree, canEdit, rules, reqs, act, busy }: { h: Hazard; steps: Step[]; tree: Data['tree']; canEdit: boolean; rules: Rule[]; reqs: Req[]; act: Act; busy: boolean }) {
  const { org } = useOrg();
  const [edit, setEdit] = useState<HForm | null>(null);
  const [cls, setCls] = useState({ class: h.class || '', rationale: h.class_rationale || '' });
  const answers = h.answers || {};
  const visible = tree.filter((q) => Object.entries(q.when || {}).every(([k, v]) => answers[k] === v));
  const answer = (key: string, v: boolean) => {
    const next: Record<string, boolean> = {};
    for (const q of tree) { if (q.key === key) { next[key] = v; break; } if (answers[q.key] !== undefined) next[q.key] = answers[q.key]; }
    act(() => api(`/orgs/${org.id}/haccp/hazards/${h.id}/tree`, { body: next }));
  };
  const tone = h.class === 'ccp' ? 'crit' : h.class === 'oprp' ? 'warn' : h.class ? 'ok' : '';
  return (
    <div className="card prob" style={{ marginTop: 10 }}>
      <div className="between"><b>{h.code} · {h.step_name}</b>{h.class_label ? <span className={`badge ${tone}`}>{h.class_label}</span> : <span className="badge">класс не назначен</span>}</div>
      {!edit ? (
        <>
          <p style={{ margin: '6px 0' }}>{h.description}</p>
          <dl className="kv">
            <dt>Тип</dt><dd>{h.type_label}</dd>
            <dt>Риск</dt><dd>{h.risk}</dd>
            <dt>Меры</dt><dd>{h.control_measures || <span className="muted">не указаны</span>}</dd>
          </dl>
          {canEdit && <button className="btn small secondary" onClick={() => setEdit({ stepId: h.step_id, hazardType: h.hazard_type, description: h.description, requirementId: h.requirement_id || '',
            likelihood: h.likelihood ? String(h.likelihood) : '', severity: h.severity ? String(h.severity) : '', controlMeasures: h.control_measures || '' })}>Изменить</button>}
        </>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); act(() => api(`/orgs/${org.id}/haccp/hazards/${h.id}`, { method: 'PATCH', body: hBody(edit) })); setEdit(null); }}>
          <HazardFields f={edit} setF={setEdit} steps={steps} reqs={reqs} id={h.id} />
          <p className="small muted">Изменение сути, оценки или мер снимает назначенный класс — решение принимается заново.</p>
          <div className="row"><button className="btn small" disabled={busy}>Сохранить</button><button type="button" className="btn small secondary" onClick={() => setEdit(null)}>Отмена</button>
            <button type="button" className="btn small danger" disabled={busy} onClick={() => { if (confirm(`Удалить опасность ${h.code}?`)) act(() => api(`/orgs/${org.id}/haccp/hazards/${h.id}`, { method: 'DELETE' })); }}>Удалить</button></div>
        </form>
      )}

      <h3>Дерево решений</h3>
      {visible.map((q) => (
        <div key={q.key} style={{ marginBottom: 8 }}>
          <div className="small">{q.text}</div>
          <div className="seg" role="group" aria-label={q.text}>
            <button type="button" className="yes" aria-pressed={answers[q.key] === true} disabled={!canEdit || busy} onClick={() => answer(q.key, true)}>Да</button>
            <button type="button" className="no" aria-pressed={answers[q.key] === false} disabled={!canEdit || busy} onClick={() => answer(q.key, false)}>Нет</button>
          </div>
        </div>
      ))}
      <p className="small">Предложение системы: <b>{h.proposal_label || 'ответьте на вопросы'}</b></p>

      <h3>Решение группы ХАССП</h3>
      {h.class && <p className="small">{h.class_label}: {h.class_rationale} <span className="muted">({h.classified_by_name})</span></p>}
      {canEdit && (
        <form onSubmit={(e) => { e.preventDefault(); act(() => api(`/orgs/${org.id}/haccp/hazards/${h.id}/classify`, { body: cls })); }}>
          <div className="seg" style={{ gridTemplateColumns: '1fr 1fr 1fr' }} role="group" aria-label="Класс меры">
            {[['prp', 'ПРП'], ['oprp', 'ОПРП'], ['ccp', 'ККТ']].map(([k, v]) => <button key={k} type="button" aria-pressed={cls.class === k} className="yes" onClick={() => setCls({ ...cls, class: k })}>{v}</button>)}
          </div>
          <label htmlFor={`cr-${h.id}`}>Обоснование</label>
          <textarea id={`cr-${h.id}`} rows={2} value={cls.rationale} onChange={(e) => setCls({ ...cls, rationale: e.target.value })} placeholder="Почему именно этот класс" />
          <button className="btn small" disabled={busy || !cls.class}>Назначить</button>
        </form>
      )}

      {(h.class === 'ccp' || h.class === 'oprp') && <MonitoringForm h={h} canEdit={canEdit} rules={rules} act={act} busy={busy} />}
    </div>
  );
}

function MonitoringForm({ h, canEdit, rules, act, busy }: { h: Hazard; canEdit: boolean; rules: Rule[]; act: Act; busy: boolean }) {
  const { org } = useOrg();
  const m = h.monitoring;
  const [f, setF] = useState({ what: m?.what || '', where: m?.where_text || '', method: m?.method || '', frequency: m?.frequency || '', criticalLimit: m?.critical_limit || '', device: m?.device || '',
    responsibleRole: m?.responsible_role || 'line_staff', recordForm: m?.record_form || '', correctiveAction: m?.corrective_action || '', controlRuleId: m?.control_rule_id || '' });
  const [open, setOpen] = useState(!m);
  if (!canEdit || !open) {
    return (
      <>
        <h3>Мониторинг</h3>
        {m ? (
          <dl className="kv small">
            <dt>Что</dt><dd>{m.what}{m.where_text ? `, ${m.where_text}` : ''}</dd>
            <dt>Как</dt><dd>{m.method}{m.device ? `; прибор: ${m.device}` : ''}</dd>
            <dt>Частота</dt><dd>{m.frequency}</dd>
            <dt>Предел</dt><dd>{m.critical_limit || (m.control_rule_id ? `по правилу объекта «${m.object_name}»${m.rule_status !== 'approved' ? ' (не утверждено)' : ''}` : '—')}</dd>
            <dt>Ответственный</dt><dd>{m.responsible_label}</dd>
            <dt>Запись</dt><dd>{m.record_form ? <Link href={`/app/${org.id}/journals/${m.record_form}`}>{m.record_form}</Link> : '—'}</dd>
            <dt>Реакция</dt><dd>{m.corrective_action}</dd>
          </dl>
        ) : <p className="small muted">План мониторинга не задан.</p>}
        {canEdit && <button className="btn small secondary" onClick={() => setOpen(true)}>Изменить мониторинг</button>}
      </>
    );
  }
  const inp = (k: keyof typeof f, label: string, ph?: string) => <div><label htmlFor={`${k}-${h.id}`}>{label}</label><input id={`${k}-${h.id}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={ph} /></div>;
  return (
    <form onSubmit={(e) => { e.preventDefault(); act(() => api(`/orgs/${org.id}/haccp/hazards/${h.id}/monitoring`, { body: { ...f, where: f.where || null, criticalLimit: f.criticalLimit || null, device: f.device || null,
      recordForm: f.recordForm || null, controlRuleId: f.controlRuleId || null } })); setOpen(false); }}>
      <h3>Мониторинг</h3>
      <div className="grid2">
        {inp('what', 'Что контролируем', 'Температура в толще продукта')}
        {inp('where', 'Где')}
        {inp('method', 'Как', 'Щуп-термометр')}
        {inp('frequency', 'Как часто', 'Каждая партия')}
        {inp('criticalLimit', h.class === 'ccp' ? 'Критический предел' : 'Предел (если есть)', 'Из утверждённой ТТК или процедуры')}
        {inp('device', 'Прибор')}
        <div><label htmlFor={`rr-${h.id}`}>Ответственный</label><select id={`rr-${h.id}`} value={f.responsibleRole} onChange={(e) => setF({ ...f, responsibleRole: e.target.value })}>{ROLES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        {inp('recordForm', 'Журнал записи', 'J22')}
      </div>
      {rules.length > 0 && <><label htmlFor={`rl-${h.id}`}>Правило контроля объекта (предел и частота — из него)</label>
        <select id={`rl-${h.id}`} value={f.controlRuleId} onChange={(e) => setF({ ...f, controlRuleId: e.target.value })}><option value="">— без правила —</option>
          {rules.map((r) => <option key={r.id} value={r.id}>{r.object_name} · {r.site_name}{r.status !== 'approved' ? ' (проект)' : ''}</option>)}</select></>}
      <label htmlFor={`ca-${h.id}`}>Реакция на отклонение</label>
      <textarea id={`ca-${h.id}`} rows={2} value={f.correctiveAction} onChange={(e) => setF({ ...f, correctiveAction: e.target.value })} />
      <div className="row" style={{ marginTop: 8 }}><button className="btn small" disabled={busy}>Сохранить мониторинг</button>{m && <button type="button" className="btn small secondary" onClick={() => setOpen(false)}>Отмена</button>}</div>
    </form>
  );
}

/** Матрица рисков 3×3: сколько опасностей в каждой клетке. Границы значимости решает группа ХАССП. */
function Matrix({ hazards }: { hazards: Hazard[] }) {
  if (!hazards.length) return null;
  const cell = (l: number, s: number) => hazards.filter((h) => h.likelihood === l && h.severity === s);
  const unrated = hazards.filter((h) => !h.score).length;
  return (
    <div className="card">
      <h2>Матрица рисков</h2>
      <div className="scroll"><table className="tbl">
        <thead><tr><th>Вероятность \ Тяжесть</th><th>1</th><th>2</th><th>3</th></tr></thead>
        <tbody>{[3, 2, 1].map((l) => <tr key={l}><th>{l}</th>{[1, 2, 3].map((s) => <td key={s}>{cell(l, s).map((h) => h.code).join(', ') || '—'}</td>)}</tr>)}</tbody>
      </table></div>
      {unrated > 0 && <p className="small muted">Не оценено: {unrated}.</p>}
    </div>
  );
}

