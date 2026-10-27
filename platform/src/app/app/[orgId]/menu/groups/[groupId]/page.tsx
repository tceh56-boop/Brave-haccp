'use client';
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { MicroPicker } from '@/components/MicroPicker';
import { GroupSelect, type Group } from '@/components/GroupSelect';

type Rules = { physNormed?: { dry?: boolean; fat?: boolean; sugar?: boolean; salt?: boolean }; gerberPct?: number | null; saltMaxPct?: number | null; dryCoef?: number | null; sugarCoef?: number | null;
  physBasis?: string | null; microIndex?: string | null; microNote?: string | null; microGroup?: string | null; microGroupCode?: string | null; micro?: Record<string, string>;
  organoleptic?: { appearance?: string | null; color?: string | null; consistency?: string | null; taste?: string | null } };
interface Data { group: { id: string; name: string; parent_id: string | null; params: Rules }; path: { id: string; name: string }[];
  inherited: { params: Rules; from: Record<string, string> }; dishes: { id: string; name: string; kind: string; approved: number | null }[];
  sto: { id: string; seq: number; title: string }[]; micro_list: { code: string; name: string }[] }

/**
 * Папка блюд: правила (как в группе Шеф Эксперта) — что нормируется, коэффициенты, микробиология, органолептика
 * по умолчанию. Пустое поле — берётся из папки выше (видно, откуда); у блюда своё значение сильнее.
 */
export default function GroupPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = use(params);
  const { org, can } = useOrg();
  const [d, setD] = useState<Data | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const { busy, error, run } = useSubmit();
  const load = useCallback(() => {
    api<Data>(`/orgs/${org.id}/dish-groups/${groupId}`).then(setD);
    api<Group[]>(`/orgs/${org.id}/dish-groups`).then(setGroups).catch(() => setGroups([]));
  }, [org.id, groupId]);
  useEffect(() => { load(); }, [load]);
  if (!d) return error ? <div className="err">{error}</div> : <p className="muted">Загрузка…</p>;
  const manage = can('ttk.manage');
  const g = d.group;
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/menu`}>← Блюда и ТТК</Link>{d.path.slice(0, -1).map((p) => <span key={p.id}> / <Link href={`/app/${org.id}/menu/groups/${p.id}`}>{p.name}</Link></span>)}</p>
      <h1>📁 {g.name}</h1>
      {error && <div className="err" role="alert">{error}</div>}
      {manage && (
        <div className="card row">
          <button className="btn small secondary" disabled={busy} onClick={() => { const name = prompt('Название папки:', g.name); if (name) run(async () => { await api(`/orgs/${org.id}/dish-groups/${g.id}`, { method: 'PATCH', body: { name } }); load(); }); }}>Переименовать</button>
          <button className="btn small secondary" disabled={busy} onClick={() => { const name = prompt('Вложенная папка:'); if (name) run(async () => { await api(`/orgs/${org.id}/dish-groups`, { body: { name, parentId: g.id } }); load(); }); }}>+ вложенная папка</button>
          <span className="row"><label htmlFor="gp" style={{ margin: 0 }}>Перенести в</label>
            <GroupSelect id="gp" groups={groups} exclude={g.id} value={g.parent_id || ''} empty="— верхний уровень —"
              onChange={(v) => run(async () => { await api(`/orgs/${org.id}/dish-groups/${g.id}`, { method: 'PATCH', body: { parentId: v || null } }); load(); })} /></span>
          <button className="btn small secondary" disabled={busy} onClick={() => { if (confirm(`Удалить пустую папку «${g.name}»?`)) run(async () => { await api(`/orgs/${org.id}/dish-groups/${g.id}`, { method: 'DELETE' }); location.assign(`/app/${org.id}/menu`); }); }}>Удалить</button>
        </div>
      )}
      <div className="card">
        <h2>Блюда в папке</h2>
        {d.dishes.length === 0 ? <p className="muted">Блюд нет (вложенные папки — в дереве).</p> : (
          <ul className="list">{d.dishes.map((x) => <li key={x.id}><Link className="between" href={`/app/${org.id}/menu/${x.id}`}><span>{x.name}{x.kind === 'semi' ? ' (п/ф)' : ''}</span>
            {x.approved ? <span className="badge ok">утверждена v{x.approved}</span> : <span className="badge warn">нет утверждённой</span>}</Link></li>)}</ul>
        )}
        <h3>СТО на папку</h3>
        {d.sto.length ? d.sto.map((s) => <p key={s.id}><Link href={`/app/${org.id}/menu/sto/${s.id}`}>СТО № {s.seq} «{s.title}» ›</Link></p>) : <p className="small muted">Нет. В СТО на папку входят все блюда папки и вложенных папок.</p>}
        {manage && !d.sto.length && <button className="btn small secondary" disabled={busy} onClick={() => run(async () => { const s = await api<{ id: string }>(`/orgs/${org.id}/sto`, { body: { title: g.name, groupId: g.id } }); location.assign(`/app/${org.id}/menu/sto/${s.id}`); })}>Составить СТО на папку</button>}
      </div>
      {manage ? <RulesForm key={g.id} d={d} onDone={load} /> : <RulesView d={d} />}
    </>
  );
}

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v).replace('.', ','));

function RulesView({ d }: { d: Data }) {
  const r = { ...d.inherited.params, ...d.group.params };
  return <div className="card"><h2>Правила папки</h2><p className="small">Соль не более: {s(r.saltMaxPct) || '—'} %; коэффициент сухих веществ: {s(r.dryCoef) || '—'}; Гербер: {s(r.gerberPct) || '—'} %; микробиология: {r.microGroupCode ? (r.microGroupCode === 'custom' ? r.microIndex || 'своя группа' : `группа ТР ТС 021 (${r.microGroupCode})`) : r.microIndex || '—'}.</p></div>;
}

function RulesForm({ d, onDone }: { d: Data; onDone: () => void }) {
  const { org } = useOrg();
  const p = d.group.params, inh = d.inherited.params, from = d.inherited.from;
  const [f, setF] = useState({ dry: !!p.physNormed?.dry, fat: !!p.physNormed?.fat, sugar: !!p.physNormed?.sugar, salt: !!p.physNormed?.salt, normedOwn: !!p.physNormed,
    gerberPct: s(p.gerberPct), saltMaxPct: s(p.saltMaxPct), dryCoef: s(p.dryCoef), sugarCoef: s(p.sugarCoef), physBasis: p.physBasis || '', microIndex: p.microIndex || '', microNote: p.microNote || '',
    micro: { ...(p.micro || {}) } as Record<string, string>,
    appearance: p.organoleptic?.appearance || '', color: p.organoleptic?.color || '', consistency: p.organoleptic?.consistency || '', taste: p.organoleptic?.taste || '' });
  const [mv, setMv] = useState({ microGroupCode: p.microGroupCode || '', micro: { ...(p.micro || {}) } as Record<string, string>, microIndex: p.microIndex || '' });
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useSubmit();
  const num = (x: string) => (x.trim() ? Number(x.replace(',', '.')) : null);
  const hint = (key: string, v: unknown) => (v !== null && v !== undefined && v !== '' ? `из папки «${from[key]}»: ${s(v)}` : '');
  const inp = (k: 'gerberPct' | 'saltMaxPct' | 'dryCoef' | 'sugarCoef' | 'physBasis' | 'microIndex' | 'microNote', label: string) => (
    <div><label htmlFor={`gr-${k}`}>{label}</label><input id={`gr-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={hint(k, inh[k])} /></div>);
  const box = (k: 'dry' | 'fat' | 'sugar' | 'salt', label: string) => (
    <label className="row" style={{ fontWeight: 400 }}><input type="checkbox" style={{ width: 22, minHeight: 22 }} checked={f[k]} disabled={!f.normedOwn} onChange={(e) => setF({ ...f, [k]: e.target.checked })} /> <span style={{ flex: 1 }}>{label}</span></label>);
  const org5 = (k: 'appearance' | 'color' | 'consistency' | 'taste', label: string) => (
    <div><label htmlFor={`go-${k}`}>{label}</label><textarea id={`go-${k}`} rows={2} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={hint(`organoleptic.${k}`, inh.organoleptic?.[k])} /></div>);
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => {
      await api(`/orgs/${org.id}/dish-groups/${d.group.id}`, { method: 'PATCH', body: { rules: {
        physNormed: f.normedOwn ? { dry: f.dry, fat: f.fat, sugar: f.sugar, salt: f.salt } : undefined,
        gerberPct: num(f.gerberPct), saltMaxPct: num(f.saltMaxPct), dryCoef: num(f.dryCoef), sugarCoef: num(f.sugarCoef),
        physBasis: f.physBasis || null, microNote: f.microNote || null,
        microGroupCode: mv.microGroupCode || null, micro: mv.microGroupCode === 'custom' ? mv.micro : {}, microIndex: mv.microGroupCode === 'custom' ? mv.microIndex || null : null,
        organoleptic: { appearance: f.appearance || null, color: f.color || null, consistency: f.consistency || null, taste: f.taste || null } } } });
      setSaved(true); onDone();
    }); }}>
      <h2>Правила папки</h2>
      <p className="small muted">Действуют для всех блюд папки и вложенных папок. Пустое поле — значение из папки выше (показано серым); у блюда своё значение сильнее.
        Физико-химия — из Методических указаний по лабораторному контролю (1997), вводит технолог; микробиология — группа ТР ТС 021/2011, значения подставляются из регламента.</p>
      <h3>Нормируемые физико-химические показатели</h3>
      <label className="row" style={{ fontWeight: 400 }}><input type="checkbox" style={{ width: 22, minHeight: 22 }} checked={f.normedOwn} onChange={(e) => setF({ ...f, normedOwn: e.target.checked })} />
        <span style={{ flex: 1 }}>Задать для этой папки{!f.normedOwn && inh.physNormed ? ` (сейчас из папки «${from.physNormed}»: ${Object.entries(inh.physNormed).filter(([, v]) => v).map(([k]) => ({ dry: 'сухие в-ва', fat: 'жир', sugar: 'сахар', salt: 'соль' } as Record<string, string>)[k]).join(', ') || 'ничего'})` : ''}</span></label>
      {box('dry', 'Сухие вещества')}{box('fat', 'Жир')}{box('sugar', 'Сахар')}{box('salt', 'Поваренная соль')}
      <div className="grid2">
        {inp('saltMaxPct', 'Соль, макс. содержание, %')}{inp('dryCoef', 'Коэффициент сухих веществ')}{inp('gerberPct', 'Жир по Герберу, %')}{inp('sugarCoef', 'Коэффициент потерь сахарозы')}
      </div>
      {inp('physBasis', 'Основание')}
      <h3 style={{ marginTop: 10 }}>Микробиология</h3>
      <MicroPicker value={mv} onChange={setMv} inherited={inh.microGroupCode ? { code: inh.microGroupCode, from: from.microGroupCode } : null} />
      {inp('microNote', 'Примечание')}
      <h3 style={{ marginTop: 10 }}>Органолептика по умолчанию</h3>
      <div className="grid2">{org5('appearance', 'Внешний вид')}{org5('color', 'Цвет')}{org5('consistency', 'Консистенция')}{org5('taste', 'Вкус и запах')}</div>
      {error && <div className="err">{error}</div>}
      {saved && !error && <div className="okbox">Правила сохранены — действуют для блюд папки.</div>}
      <button className="btn block secondary" disabled={busy}>Сохранить правила</button>
    </form>
  );
}
