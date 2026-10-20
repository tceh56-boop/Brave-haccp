'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { d } from '@/lib/fmt';
import { STATE_TONE } from './states';

interface Src { id: string; code: string; kind: string; title: string; binding_label: string; check_overdue: boolean; versions: number;
  current: { id: string; edition: string; state: string; state_label: string; effective_from: string | null; effective_to: string | null; requirements: number; next_check_at: string | null } | null }
interface Item { id: string; source_code: string; clause: string; text: string; scope: string; edition: string; state_label: string; applicable: boolean | null; rationale: string | null; rules: number; gap: boolean; proposal: { proposed: boolean | null; reason: string } }
interface Overview { items: Item[]; counts: { total: number; applicable: number; not_applicable: number; undecided: number; without_control: number } }

/** Нормативный реестр (ТЗ v2 §7): источники с редакциями и статусами; нормативный профиль предприятия. */
export default function RegulatoryPage() {
  const { org, can } = useOrg();
  const [tab, setTab] = useState<'registry' | 'profile'>('registry');
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}`}>← Управление</Link></p>
      <h1>Нормативный реестр</h1>
      <p className="small muted">Требование применяется только после проверки официального текста специалистом и утверждения. Ссылка на статью или ответ AI статус «Действует» не присваивают.</p>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'registry'} onClick={() => setTab('registry')}>Источники</button>
        <button role="tab" aria-selected={tab === 'profile'} onClick={() => setTab('profile')}>Профиль предприятия</button>
      </div>
      {tab === 'registry' ? <Registry canManage={can('reg.manage')} /> : <Profile canManage={can('reg.manage')} canVerify={can('reg.verify')} />}
    </>
  );
}

function Registry({ canManage }: { canManage: boolean }) {
  const { org } = useOrg();
  const [list, setList] = useState<Src[] | null>(null);
  const [f, setF] = useState({ code: '', kind: 'Внутренний', title: '', issuer: '', officialUrl: '', binding: 'mandatory', edition: '', effectiveFrom: '' });
  const [open, setOpen] = useState(false);
  const { busy, error, run } = useSubmit();
  const load = useCallback(() => api<Src[]>(`/orgs/${org.id}/regulatory/sources`).then(setList), [org.id]);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      {error && <div className="err">{error}</div>}
      {list && list.length === 0 && canManage && (
        <div className="card">
          <p>Реестр пуст. Можно загрузить стартовый перечень из ТЗ (СанПиН 2.3/2.4.4282-26, ТР ТС 021/022/005, 52-, 152-, 402-, 54-, 162-ФЗ, ГОСТ Р 51740-2016). Все записи придут со статусом «Требует проверки»; пункты и даты, которых нет в ТЗ, вносит специалист.</p>
          <button className="btn block" disabled={busy} onClick={() => run(async () => { await api(`/orgs/${org.id}/regulatory/seed`, { body: {} }); await load(); })}>Загрузить стартовый перечень</button>
        </div>
      )}
      <div className="card">
        {!list ? <p className="muted">Загрузка…</p> : list.map((s) => (
          <Link key={s.id} className="objrow" href={`/app/${org.id}/regulatory/${s.id}`}>
            <div><b>{s.code}</b><div className="small muted">{s.title}</div>
              {s.current && <div className="small">{s.current.edition}{s.current.effective_from ? ` · с ${d(s.current.effective_from, org.timezone)}` : ' · дата начала не указана'}{s.current.effective_to ? ` по ${d(s.current.effective_to, org.timezone)}` : ''} · пунктов: {s.current.requirements}</div>}</div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              {s.current && <span className={`badge ${STATE_TONE[s.current.state]}`}>{s.current.state_label}</span>}
              {s.check_overdue && <span className="badge warn">пора проверить</span>}
              <span aria-hidden>›</span>
            </div>
          </Link>
        ))}
      </div>
      {canManage && (
        <div className="card">
          {!open ? <button className="btn block secondary" onClick={() => setOpen(true)}>Добавить источник</button> : (
            <form onSubmit={(e) => { e.preventDefault(); run(async () => {
              await api(`/orgs/${org.id}/regulatory/sources`, { body: { ...f, issuer: f.issuer || null, officialUrl: f.officialUrl || null, effectiveFrom: f.effectiveFrom || null } });
              setOpen(false); setF({ code: '', kind: 'Внутренний', title: '', issuer: '', officialUrl: '', binding: 'mandatory', edition: '', effectiveFrom: '' }); await load();
            }); }}>
              <h2>Новый источник</h2>
              <div className="grid2">
                <div><label htmlFor="sc">Обозначение</label><input id="sc" required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="ПК-03 или МУК 4.2.1847-04" /></div>
                <div><label htmlFor="sk">Вид</label><select id="sk" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{['СанПиН', 'ТР ТС', 'ФЗ', 'ГОСТ', 'МУК', 'Постановление', 'Приказ', 'Внутренний', 'Другое'].map((k) => <option key={k}>{k}</option>)}</select></div>
              </div>
              <label htmlFor="st">Официальное название</label><input id="st" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
              <div className="grid2">
                <div><label htmlFor="si">Издатель</label><input id="si" value={f.issuer} onChange={(e) => setF({ ...f, issuer: e.target.value })} /></div>
                <div><label htmlFor="sb">Обязательность</label><select id="sb" value={f.binding} onChange={(e) => setF({ ...f, binding: e.target.value })}><option value="mandatory">обязательный</option><option value="voluntary">добровольный</option><option value="methodological">методический</option><option value="unknown">не определено</option></select></div>
                <div><label htmlFor="se">Редакция</label><input id="se" required value={f.edition} onChange={(e) => setF({ ...f, edition: e.target.value })} placeholder="ред. от …" /></div>
                <div><label htmlFor="sf">Действует с</label><input id="sf" type="date" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} /></div>
              </div>
              <label htmlFor="su">Официальный URL</label><input id="su" type="url" value={f.officialUrl} onChange={(e) => setF({ ...f, officialUrl: e.target.value })} />
              <button className="btn block" disabled={busy}>Создать</button>
            </form>
          )}
        </div>
      )}
    </>
  );
}

function Profile({ canManage, canVerify }: { canManage: boolean; canVerify: boolean }) {
  const { org } = useOrg();
  const [meta, setMeta] = useState<{ profile: { object_types: string[]; processes: string[] }; objectTypes: Record<string, string>; processes: Record<string, string> } | null>(null);
  const [sel, setSel] = useState<{ objectTypes: string[]; processes: string[] }>({ objectTypes: [], processes: [] });
  const [ov, setOv] = useState<Overview | null>(null);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useSubmit();
  const loadOv = useCallback(() => api<Overview>(`/orgs/${org.id}/regulatory/overview`).then(setOv), [org.id]);
  useEffect(() => {
    api<NonNullable<typeof meta>>(`/orgs/${org.id}/regulatory/profile`).then((m) => { setMeta(m); setSel({ objectTypes: m.profile.object_types, processes: m.profile.processes }); });
    loadOv();
  }, [org.id, loadOv]);
  const toggle = (k: 'objectTypes' | 'processes', v: string) => { setSaved(false); setSel({ ...sel, [k]: sel[k].includes(v) ? sel[k].filter((x) => x !== v) : [...sel[k], v] }); };
  if (!meta) return <p className="muted">Загрузка…</p>;
  return (
    <>
      <div className="card">
        <h2>Тип объекта и процессы</h2>
        <p className="small muted">По профилю система предлагает, какие требования применимы. Решение принимает специалист.</p>
        <fieldset disabled={!canManage} style={{ border: 0, padding: 0, margin: 0 }}>
          <div className="chips">{Object.entries(meta.objectTypes).map(([k, l]) => <button key={k} type="button" aria-pressed={sel.objectTypes.includes(k)} onClick={() => toggle('objectTypes', k)}>{l}</button>)}</div>
          <div className="chips">{Object.entries(meta.processes).map(([k, l]) => <button key={k} type="button" aria-pressed={sel.processes.includes(k)} onClick={() => toggle('processes', k)}>{l}</button>)}</div>
        </fieldset>
        {saved && <div className="okbox">Профиль сохранён.</div>}
        {error && <div className="err">{error}</div>}
        {canManage && <button className="btn block secondary" disabled={busy} onClick={() => run(async () => { await api(`/orgs/${org.id}/regulatory/profile`, { method: 'PUT', body: sel }); setSaved(true); await loadOv(); })}>Сохранить профиль</button>}
      </div>
      {ov && (
        <div className="card">
          <h2>Требования действующих редакций</h2>
          <p className="small">Всего {ov.counts.total} · применимо {ov.counts.applicable} · неприменимо {ov.counts.not_applicable} · не решено {ov.counts.undecided}
            {ov.counts.without_control > 0 && <b style={{ color: 'var(--crit)' }}> · применимо, но нет процедуры контроля: {ov.counts.without_control}</b>}</p>
          {ov.items.length === 0 ? <p className="muted">Нет утверждённых действующих или вступающих редакций.</p> : (
            <ul className="list">{ov.items.map((i) => <Requirement key={i.id} i={i} canVerify={canVerify} onSaved={loadOv} />)}</ul>
          )}
        </div>
      )}
    </>
  );
}

function Requirement({ i, canVerify, onSaved }: { i: Item; canVerify: boolean; onSaved: () => void }) {
  const { org } = useOrg();
  const { busy, error, run } = useSubmit();
  const decide = (applicable: boolean) => { const r = prompt(applicable ? 'Почему требование применимо?' : 'Почему не применимо?', i.proposal.reason); if (r) run(async () => { await api(`/orgs/${org.id}/regulatory/requirements/${i.id}/applicability`, { body: { applicable, rationale: r } }); onSaved(); }); };
  return (
    <li>
      <div className="between"><b>{i.source_code}, {i.clause}</b>
        {i.applicable === true ? <span className="badge ok">применимо</span> : i.applicable === false ? <span className="badge">не применимо</span> : <span className="badge warn">не решено</span>}</div>
      <div className="small">{i.text}</div>
      <div className="small muted">Область: {i.scope} · ред. {i.edition} · {i.state_label}</div>
      {i.applicable == null && <div className="small">Предложение системы: <b>{i.proposal.proposed === true ? 'применимо' : i.proposal.proposed === false ? 'не применимо' : 'нет данных'}</b> — {i.proposal.reason}</div>}
      {i.rationale && <div className="small muted">Обоснование: {i.rationale}</div>}
      {i.applicable === true && <div className="small">{i.rules ? `Процедур контроля: ${i.rules}` : <b style={{ color: 'var(--crit)' }}>Нет процедуры контроля — задайте правило на объекте со ссылкой на это требование</b>}</div>}
      {canVerify && <div className="row" style={{ marginTop: 6 }}>
        <button className="btn secondary small" disabled={busy} onClick={() => decide(true)}>Применимо</button>
        <button className="btn secondary small" disabled={busy} onClick={() => decide(false)}>Не применимо</button></div>}
      {error && <div className="err">{error}</div>}
    </li>
  );
}
