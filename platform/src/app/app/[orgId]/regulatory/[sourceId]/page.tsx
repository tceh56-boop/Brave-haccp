'use client';
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { d, dt } from '@/lib/fmt';
import { STATE_TONE } from '../states';

interface Version { id: string; edition: string; state: string; state_label: string; workflow_status: string; published_at: string | null; effective_from: string | null; effective_to: string | null;
  transitional: string | null; check_evidence: string | null; last_checked_at: string | null; checked_by_name: string | null; next_check_at: string | null; approved_at: string | null;
  approved_by_name: string | null; owner_name: string | null; data_origin: string | null; requirements: number; supersedes_version_id: string | null }
interface Req { id: string; version_id: string; clause: string; text: string; scope: string; processes: string[]; applicable: boolean | null; rules: number }
interface Review { id: string; created_at: string; affected_rules: number; diff: { added: { clause: string }[]; removed: { clause: string }[]; changed: { clause: string; before: string; after: string }[] } }
interface Card { source: { id: string; code: string; title: string; issuer: string | null; official_url: string | null; jurisdiction: string; binding_label: string; note: string | null }; versions: Version[]; requirements: Req[]; reviews: Review[] }

export default function SourcePage({ params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = use(params);
  const { org, can, me } = useOrg();
  const [c, setC] = useState<Card | null>(null);
  const [vid, setVid] = useState<string | null>(null);
  const [members, setMembers] = useState<{ user_id: string; full_name: string }[]>([]);
  const { busy, error, run, setError } = useSubmit();
  const load = useCallback(async () => {
    const x = await api<Card>(`/orgs/${org.id}/regulatory/sources/${sourceId}`); setC(x);
    setVid((cur) => (cur && x.versions.some((v) => v.id === cur) ? cur : x.versions[x.versions.length - 1]?.id || null));
  }, [org.id, sourceId]);
  useEffect(() => { load().catch((e) => setError(e.message)); api<typeof members>(`/orgs/${org.id}/members`).then(setMembers).catch(() => setMembers([{ user_id: me.id, full_name: me.full_name }])); }, [load, org.id, me, setError]);
  if (!c) return error ? <div className="err">{error}</div> : <p className="muted">Загрузка…</p>;
  const v = c.versions.find((x) => x.id === vid)!;
  const reqs = c.requirements.filter((r) => r.version_id === vid);
  const editable = v && ['draft', 'needs_review', 'checked'].includes(v.workflow_status);
  const tz = org.timezone;
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/regulatory`}>← Реестр</Link></p>
      <h1 style={{ marginBottom: 4 }}>{c.source.code}</h1>
      <p className="muted" style={{ marginTop: 0 }}>{c.source.title}</p>
      <div className="card">
        <dl className="kv">
          <dt>Издатель</dt><dd>{c.source.issuer || '—'}</dd>
          <dt>Юрисдикция</dt><dd>{c.source.jurisdiction} · {c.source.binding_label}</dd>
          <dt>Официальный текст</dt><dd>{c.source.official_url ? <a href={c.source.official_url} target="_blank" rel="noreferrer">{c.source.official_url}</a> : 'не указан'}</dd>
        </dl>
        {c.source.note && <div className="note small">{c.source.note}</div>}
      </div>

      <div className="chips">{c.versions.map((x) => <button key={x.id} aria-pressed={x.id === vid} onClick={() => setVid(x.id)}>{x.edition} · {x.state_label}</button>)}</div>
      {error && <div className="err" role="alert">{error}</div>}
      {v && (
        <div className="card">
          <div className="between"><h2 style={{ margin: 0 }}>Редакция «{v.edition}»</h2><span className={`badge ${STATE_TONE[v.state]}`}>{v.state_label}</span></div>
          <dl className="kv">
            <dt>Опубликована</dt><dd>{v.published_at ? d(v.published_at, tz) : '—'}</dd>
            <dt>Действует</dt><dd>{v.effective_from ? `с ${d(v.effective_from, tz)}` : <b style={{ color: 'var(--crit)' }}>дата начала не указана</b>}{v.effective_to ? ` по ${d(v.effective_to, tz)}` : ''}</dd>
            {v.transitional && <><dt>Переходные положения</dt><dd>{v.transitional}</dd></>}
            <dt>Источник данных</dt><dd className="small">{v.data_origin || '—'}</dd>
            <dt>Проверка</dt><dd>{v.last_checked_at ? `${dt(v.last_checked_at, tz)} · ${v.checked_by_name}` : 'не проверено'}{v.check_evidence ? <div className="small muted">{v.check_evidence}</div> : null}</dd>
            {v.next_check_at && <><dt>Следующая проверка</dt><dd>{d(v.next_check_at, tz)}{v.owner_name ? ` · владелец: ${v.owner_name}` : ''}</dd></>}
            {v.approved_at && <><dt>Утверждено</dt><dd>{dt(v.approved_at, tz)} · {v.approved_by_name}</dd></>}
          </dl>
          {editable && can('reg.manage') && <VersionDates v={v} onSaved={load} />}
          {['draft', 'needs_review'].includes(v.workflow_status) && can('reg.verify') && <CheckForm v={v} members={members} onSaved={load} />}
          {v.workflow_status === 'checked' && can('reg.approve') && (
            <button className="btn block" disabled={busy} onClick={() => run(async () => { await api(`/orgs/${org.id}/regulatory/versions/${v.id}/approve`, { body: {} }); await load(); })}>Утвердить для применения</button>
          )}
          {v.workflow_status === 'approved' && can('reg.approve') && (
            <button className="btn block secondary" disabled={busy} onClick={() => { const r = prompt('Основание приостановки (оспаривание, письмо и т.п.):'); if (r) run(async () => { await api(`/orgs/${org.id}/regulatory/versions/${v.id}/suspend`, { body: { suspended: true, reason: r } }); await load(); }); }}>Приостановить</button>
          )}
        </div>
      )}

      <div className="card">
        <h2>Пункты редакции</h2>
        {reqs.length === 0 ? <p className="muted">Пункты не внесены. Без них редакцию утвердить нельзя.</p> : (
          <ul className="list">{reqs.map((r) => (
            <li key={r.id}><div className="between"><b>{r.clause}</b>{r.applicable === true ? <span className="badge ok">применимо</span> : r.applicable === false ? <span className="badge">не применимо</span> : <span className="badge warn">применимость не решена</span>}</div>
              <div className="small">{r.text}</div><div className="small muted">Область: {r.scope}{r.rules ? ` · правил контроля: ${r.rules}` : ''}</div></li>
          ))}</ul>
        )}
        {editable && can('reg.manage') && <AddRequirement versionId={v.id} onSaved={load} />}
      </div>

      {c.reviews.length > 0 && (
        <div className="card">
          <h2>Сравнение редакций</h2>
          {c.reviews.map((r) => (
            <div key={r.id} className="small" style={{ marginBottom: 10 }}>
              <div className="muted">{dt(r.created_at, tz)} · задач пересмотра: {r.affected_rules}</div>
              {r.diff.added.length > 0 && <div>Добавлены: {r.diff.added.map((x) => x.clause).join(', ')}</div>}
              {r.diff.removed.length > 0 && <div>Исключены: {r.diff.removed.map((x) => x.clause).join(', ')}</div>}
              {r.diff.changed.map((x) => <div key={x.clause}><b>Изменён {x.clause}:</b> <s className="muted">{x.before}</s> → {x.after}</div>)}
            </div>
          ))}
        </div>
      )}

      {can('reg.manage') && <NewVersion sourceId={sourceId} onSaved={load} />}
    </>
  );
}

function VersionDates({ v, onSaved }: { v: Version; onSaved: () => void }) {
  const { org } = useOrg();
  const [f, setF] = useState({ effectiveFrom: v.effective_from?.slice(0, 10) || '', effectiveTo: v.effective_to?.slice(0, 10) || '', publishedAt: v.published_at?.slice(0, 10) || '', transitional: v.transitional || '' });
  const { busy, error, run } = useSubmit();
  return (
    <details style={{ marginBottom: 10 }}><summary className="small">Изменить даты и переходные положения</summary>
      <div className="grid2">
        <div><label htmlFor="vp">Опубликована</label><input id="vp" type="date" value={f.publishedAt} onChange={(e) => setF({ ...f, publishedAt: e.target.value })} /></div>
        <div><label htmlFor="vf">Действует с</label><input id="vf" type="date" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} /></div>
        <div><label htmlFor="vt">Действует по</label><input id="vt" type="date" value={f.effectiveTo} onChange={(e) => setF({ ...f, effectiveTo: e.target.value })} /></div>
      </div>
      <label htmlFor="vtr">Переходные положения</label><textarea id="vtr" rows={2} value={f.transitional} onChange={(e) => setF({ ...f, transitional: e.target.value })} />
      {error && <div className="err">{error}</div>}
      <button className="btn secondary block" disabled={busy} onClick={() => run(async () => { await api(`/orgs/${org.id}/regulatory/versions/${v.id}`, { method: 'PATCH', body: { publishedAt: f.publishedAt || null, effectiveFrom: f.effectiveFrom || null, effectiveTo: f.effectiveTo || null, transitional: f.transitional || null } }); onSaved(); })}>Сохранить</button>
      {v.workflow_status === 'checked' && <p className="small muted">После правки редакция снова потребует проверки.</p>}
    </details>
  );
}

function CheckForm({ v, members, onSaved }: { v: Version; members: { user_id: string; full_name: string }[]; onSaved: () => void }) {
  const { org, me } = useOrg();
  const [f, setF] = useState({ evidence: '', nextCheckAt: '', ownerUserId: me.id });
  const { busy, error, run } = useSubmit();
  return (
    <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/orgs/${org.id}/regulatory/versions/${v.id}/check`, { body: f }); onSaved(); }); }}>
      <h3>Проверка специалистом</h3>
      <label htmlFor="ce">Чем подтверждено (официальная публикация, номер, дата)</label><textarea id="ce" rows={2} required value={f.evidence} onChange={(e) => setF({ ...f, evidence: e.target.value })} />
      <div className="grid2">
        <div><label htmlFor="cn">Следующая проверка</label><input id="cn" type="date" required value={f.nextCheckAt} onChange={(e) => setF({ ...f, nextCheckAt: e.target.value })} /></div>
        <div><label htmlFor="co">Владелец актуализации</label><select id="co" value={f.ownerUserId} onChange={(e) => setF({ ...f, ownerUserId: e.target.value })}>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}</select></div>
      </div>
      {error && <div className="err">{error}</div>}
      <button className="btn block" disabled={busy}>Отметить «Проверен специалистом»</button>
    </form>
  );
}

function AddRequirement({ versionId, onSaved }: { versionId: string; onSaved: () => void }) {
  const { org } = useOrg();
  const [f, setF] = useState({ clause: '', text: '', scope: '' });
  const { busy, error, run } = useSubmit();
  return (
    <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/orgs/${org.id}/regulatory/versions/${versionId}/requirements`, { body: f }); setF({ clause: '', text: '', scope: '' }); onSaved(); }); }}>
      <h3 style={{ marginTop: 14 }}>Внести пункт</h3>
      <div className="grid2">
        <div><label htmlFor="rc">Пункт</label><input id="rc" required value={f.clause} onChange={(e) => setF({ ...f, clause: e.target.value })} placeholder="п. 2.5" /></div>
        <div><label htmlFor="rs">Область применения</label><input id="rs" required value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })} placeholder="хранение скоропортящегося сырья" /></div>
      </div>
      <label htmlFor="rt">Формулировка из официального текста</label><textarea id="rt" rows={3} required value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
      {error && <div className="err">{error}</div>}
      <button className="btn block secondary" disabled={busy}>Добавить пункт</button>
    </form>
  );
}

function NewVersion({ sourceId, onSaved }: { sourceId: string; onSaved: () => void }) {
  const { org } = useOrg();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ edition: '', effectiveFrom: '' });
  const { busy, error, run } = useSubmit();
  return (
    <div className="card">
      {!open ? <button className="btn block secondary" onClick={() => setOpen(true)}>Новая редакция</button> : (
        <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/orgs/${org.id}/regulatory/sources/${sourceId}/versions`, { body: { edition: f.edition, effectiveFrom: f.effectiveFrom || null } }); setOpen(false); onSaved(); }); }}>
          <h2>Новая редакция</h2>
          <p className="small muted">Пункты действующей редакции скопируются в черновик. После утверждения система сравнит пункты и поставит задачи пересмотра связанных правил контроля.</p>
          <div className="grid2">
            <div><label htmlFor="ne">Редакция</label><input id="ne" required value={f.edition} onChange={(e) => setF({ ...f, edition: e.target.value })} /></div>
            <div><label htmlFor="nf">Действует с</label><input id="nf" type="date" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} /></div>
          </div>
          {error && <div className="err">{error}</div>}
          <button className="btn block" disabled={busy}>Создать черновик редакции</button>
        </form>
      )}
    </div>
  );
}
