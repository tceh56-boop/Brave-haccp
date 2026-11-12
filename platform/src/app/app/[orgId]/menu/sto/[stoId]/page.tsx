'use client';
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { dt } from '@/lib/fmt';
import type { StoCalc } from '@/lib/sto';
import { GroupSelect, type Group } from '@/components/GroupSelect';

interface Data { sto: { id: string; seq: number; title: string; dish_ids: string[]; group_id: string | null; params: Record<string, unknown> & { rawDocs?: Record<string, string> } }; calc: StoCalc;
  versions: { version: number; designation: string; change_note: string; approved_at: string; review_due: string; approved_by_name: string }[]; review_overdue: boolean }
interface Dish { id: string; name: string; kind: string; category: string | null; approved: { version: number } | null }

/** СТО: состав (блюда), разделы, которые вписывает технолог, утверждение руководителем, лист регистрации изменений. */
export default function StoPage({ params }: { params: Promise<{ stoId: string }> }) {
  const { stoId } = use(params);
  const { org, can } = useOrg();
  const [d, setD] = useState<Data | null>(null);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  useEffect(() => { api<Group[]>(`/orgs/${org.id}/dish-groups`).then(setGroups).catch(() => setGroups([])); }, [org.id]);
  const load = useCallback(() => api<Data>(`/orgs/${org.id}/sto/${stoId}`).then(setD), [org.id, stoId]);
  useEffect(() => { load(); api<Dish[]>(`/orgs/${org.id}/dishes`).then(setDishes).catch(() => setDishes([])); }, [load, org.id]);
  if (!d) return <p className="muted">Загрузка…</p>;
  const c = d.calc;
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/menu/sto`}>← Стандарты организации</Link></p>
      <h1>{c.designation}</h1>
      <p><b>{c.title}</b> <span className={`badge ${c.status === 'ready' ? 'ok' : 'warn'}`}>{c.status === 'ready' ? 'готов к утверждению' : 'проект'}</span>
        {d.review_overdue && <span className="badge crit">пора актуализировать</span>}</p>
      <Link className="btn block secondary" href={`/app/${org.id}/menu/sto/${stoId}/print`}>Документ СТО (текущий расчёт)</Link>
      {c.warnings.length > 0 && <div className="note"><b>Чтобы утвердить, осталось:</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{c.warnings.map((w) => <li key={w} className="small">{w}</li>)}</ul></div>}
      {can('ttk.manage') && <Edit d={d} dishes={dishes} groups={groups} onDone={load} />}
      <Approve d={d} onDone={load} />
      <div className="card">
        <h2>Лист регистрации изменений</h2>
        {d.versions.length === 0 ? <p className="muted">Утверждённых версий нет.</p> : (
          <ul className="list">{d.versions.map((v) => (
            <li key={v.version}><Link className="between" href={`/app/${org.id}/menu/sto/${stoId}/print?v=${v.version}`}>
              <span><b>Изм. {v.version}</b> · {v.change_note}<div className="small muted">{v.designation} · {v.approved_by_name}, {dt(v.approved_at, org.timezone)} · актуализировать до {v.review_due.split('-').reverse().join('.')}</div></span><span aria-hidden>›</span>
            </Link></li>))}</ul>
        )}
      </div>
    </>
  );
}

function Edit({ d, dishes, groups, onDone }: { d: Data; dishes: Dish[]; groups: Group[]; onDone: () => void }) {
  const { org } = useOrg();
  const p = d.sto.params;
  const s = (k: string) => (p[k] === null || p[k] === undefined ? '' : String(p[k]));
  const [f, setF] = useState({ title: d.sto.title, dishIds: d.sto.dish_ids, groupId: d.sto.group_id || '', okpo: s('okpo'), scope: s('scope'), packaging: s('packaging'), transport: s('transport'), controlMethods: s('controlMethods'),
    rawDocs: { ...(p.rawDocs || {}) } as Record<string, string> });
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useSubmit();
  const toggle = (id: string) => setF({ ...f, dishIds: f.dishIds.includes(id) ? f.dishIds.filter((x) => x !== id) : [...f.dishIds, id] });
  const ta = (k: 'scope' | 'packaging' | 'transport' | 'controlMethods', label: string, ph: string) => (
    <><label htmlFor={`sto-${k}`}>{label}</label><textarea id={`sto-${k}`} rows={3} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={ph} /></>);
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => {
      await api(`/orgs/${org.id}/sto/${d.sto.id}`, { method: 'PATCH', body: { ...f, groupId: f.groupId || null, okpo: f.okpo || null, scope: f.scope || null, packaging: f.packaging || null, transport: f.transport || null,
        controlMethods: f.controlMethods || null, rawDocs: Object.fromEntries(Object.entries(f.rawDocs).filter(([, x]) => x.trim())) } });
      setSaved(true); onDone();
    }); }}>
      <h2>Состав и разделы</h2>
      <div className="grid2">
        <div><label htmlFor="sto-title">Наименование (группа блюд)</label><input id="sto-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
        <div><label htmlFor="sto-okpo">ОКПО предприятия</label><input id="sto-okpo" inputMode="numeric" value={f.okpo} onChange={(e) => setF({ ...f, okpo: e.target.value })} /></div>
      </div>
      <h3>Блюда стандарта</h3>
      <label htmlFor="sto-group">Папка (в стандарт войдут все блюда папки и вложенных папок)</label>
      <GroupSelect id="sto-group" groups={groups} value={f.groupId} onChange={(groupId) => setF({ ...f, groupId })} empty="— выбрать блюда вручную —" />
      {f.groupId ? <p className="small muted">Состав: {d.calc.dishes.map((x) => x.name).join(', ') || '—'}{d.sto.group_id !== f.groupId ? ' (обновится после сохранения)' : ''}</p> : <div className="chips">{dishes.map((x) => <button type="button" key={x.id} aria-pressed={f.dishIds.includes(x.id)} onClick={() => toggle(x.id)} title={x.approved ? '' : 'нет утверждённой ТТК'}>{x.name}{x.approved ? '' : ' ⚠'}</button>)}</div>}
      {ta('scope', 'Область применения', 'на какие блюда распространяется стандарт, где изготавливаются и реализуются')}
      {c(d).raw.length > 0 && <><h3 style={{ marginTop: 10 }}>Нормативные документы на сырьё</h3>
        <p className="small muted">Пусто — берётся из ТИ блюда, если там указано.</p>
        {c(d).raw.map((r) => (
          <div key={r.product_id}><label htmlFor={`sr-${r.product_id}`}>{r.name}</label>
            <input id={`sr-${r.product_id}`} value={f.rawDocs[r.product_id] ?? ''} onChange={(e) => setF({ ...f, rawDocs: { ...f.rawDocs, [r.product_id]: e.target.value } })} placeholder={r.doc || 'ГОСТ, ТУ, спецификация'} /></div>))}</>}
      {ta('packaging', 'Упаковка и маркировка', 'тара, упаковочные материалы, сведения на маркировке по ТР ТС 022/2011')}
      {ta('transport', 'Транспортирование (дополнительно)', 'если продукция перевозится')}
      {ta('controlMethods', 'Методы контроля (дополнительно)', 'отбор проб, методики лаборатории')}
      {error && <div className="err">{error}</div>}
      {saved && !error && <div className="okbox">Сохранено.</div>}
      <button className="btn block secondary" disabled={busy}>Сохранить</button>
    </form>
  );
}
const c = (d: Data) => d.calc;

function Approve({ d, onDone }: { d: Data; onDone: () => void }) {
  const { org, can } = useOrg();
  const [note, setNote] = useState(d.versions.length ? 'Актуализация' : 'Введён впервые');
  const { busy, error, run } = useSubmit();
  if (!can('sto.approve')) return <p className="small muted">Утверждает руководитель предприятия.</p>;
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/orgs/${org.id}/sto/${d.sto.id}/approve`, { body: { changeNote: note } }); onDone(); }); }}>
      <h2>Утверждение (руководитель)</h2>
      <label htmlFor="sn">Что введено или изменено</label><input id="sn" required value={note} onChange={(e) => setNote(e.target.value)} />
      {error && <div className="err">{error}</div>}
      <button className="btn block" disabled={busy || d.calc.status !== 'ready'}>Утвердить СТО (изм. {d.versions.length + 1})</button>
      <p className="small muted">После утверждения технологу ставится задача актуализировать стандарт через год.</p>
    </form>
  );
}
