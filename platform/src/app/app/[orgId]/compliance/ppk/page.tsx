'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { dt } from '@/lib/fmt';
import { refOf, type PpkDoc, type PpkParams, type PpkVersion } from '@/lib/ppk';

interface R { doc: PpkDoc; versions: PpkVersion[]; current: boolean; staff: { id: string; full_name: string; position: string | null }[] }

/**
 * Мастер ППК: система собирает программу сама — из профиля предприятия, нормативной базы и данных (план ХАССП,
 * объекты контроля, исследования, санитария, договоры, персонал). Пользователь только устраняет пробелы и утверждает.
 */
export default function PpkWizard() {
  const { org, can } = useOrg();
  const [r, setR] = useState<R | null>(null);
  const [p, setP] = useState<PpkParams>({});
  const [note, setNote] = useState('');
  const { busy, error, run, setError } = useSubmit();
  const load = useCallback(() => api<R>(`/orgs/${org.id}/ppk`).then((x) => { setR(x); setP(x.doc.params); }).catch((e) => setError(e.message)), [org.id, setError]);
  useEffect(() => { load(); }, [load]);
  if (!r) return error ? <div className="err">{error}</div> : <p className="muted">Собираю программу…</p>;
  const d = r.doc;
  const last = r.versions[r.versions.length - 1];
  const step = d.gaps.length ? 1 : r.current ? 3 : 2;

  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/compliance`}>← Готов ли я к проверке</Link></p>
      <h1>Программа производственного контроля</h1>
      <p className="small muted">Программу собирает система: какие требования применяются — по профилю предприятия, что в неё записать — по вашим данным. Каждая строка — со ссылкой на документ и пункт; дословные тексты — в приложении.</p>
      {error && <div className="err" role="alert">{error}</div>}

      <ol className="small" style={{ paddingLeft: 18 }}>
        <li style={{ fontWeight: step === 1 ? 700 : 400 }}>Устраните пробелы в данных{d.gaps.length ? ` (${d.gaps.length})` : ' — готово'}</li>
        <li style={{ fontWeight: step === 2 ? 700 : 400 }}>Проверьте проект и утвердите</li>
        <li style={{ fontWeight: step === 3 ? 700 : 400 }}>Распечатайте и подпишите{r.current ? ` — версия ${last.version} действует` : ''}</li>
      </ol>
      {last && !r.current && <div className="note">Версия {last.version} утверждена {dt(last.approved_at, org.timezone, { day: '2-digit', month: '2-digit', year: 'numeric' })}, но данные с тех пор изменились — программу нужно пересмотреть.</div>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Реквизиты программы</h2>
        <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/orgs/${org.id}/ppk`, { method: 'PUT', body: p }); await load(); }); }}>
          <label htmlFor="resp">Ответственный за производственный контроль</label>
          <select id="resp" value={p.responsibleUserId || ''} onChange={(e) => setP({ ...p, responsibleUserId: e.target.value || null })} disabled={!can('haccp.manage')}>
            <option value="">— не назначен —</option>
            {r.staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}{s.position ? `, ${s.position}` : ''}</option>)}
          </select>
          <label htmlFor="appr">Должность утверждающего</label>
          <input id="appr" value={p.approverTitle || ''} onChange={(e) => setP({ ...p, approverTitle: e.target.value })} placeholder="Генеральный директор / Индивидуальный предприниматель" disabled={!can('haccp.manage')} />
          <label htmlFor="city">Город</label>
          <input id="city" value={p.city || ''} onChange={(e) => setP({ ...p, city: e.target.value })} disabled={!can('haccp.manage')} />
          <label htmlFor="ord">Номер приказа о введении</label>
          <input id="ord" value={p.orderNo || ''} onChange={(e) => setP({ ...p, orderNo: e.target.value })} disabled={!can('haccp.manage')} />
          {can('haccp.manage') && <button className="btn" disabled={busy}>Сохранить</button>}
        </form>
      </div>

      {d.gaps.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Чего не хватает ({d.gaps.length})</h2>
          <p className="small muted">Пока пробелы не устранены, программу утвердить нельзя: в ней были бы мероприятия, которые нечем подтвердить.</p>
          {d.gaps.map((g, i) => (
            <div key={i} className="between" style={{ borderTop: i ? '1px solid var(--line, #ddd)' : 'none', padding: '8px 0', gap: 8 }}>
              <div><div>{g.text}</div><div className="small muted">{g.section}</div></div>
              {g.href && <Link className="btn small" href={g.href}>Исправить ›</Link>}
            </div>))}
        </div>
      )}

      <div className="card">
        <div className="between"><h2 style={{ margin: 0 }}>Проект программы</h2><Link className="btn secondary small" href={`/app/${org.id}/compliance/ppk/print`}>Печатная форма</Link></div>
        {d.sections.map((s) => (
          <details key={s.no} open={s.lines.some((l) => l.gap)}>
            <summary><b>{s.no}. {s.title}</b>{s.lines.some((l) => l.gap) && <span className="badge crit" style={{ marginLeft: 6 }}>пробел</span>}</summary>
            {s.lines.map((l, i) => (
              <div key={i} style={{ margin: '6px 0' }}>
                {l.gap ? <div className="note" style={{ margin: 0 }}>{l.gap}</div> : <div>{s.no}.{i + 1}. {l.text}</div>}
                {l.basis.length > 0 && <div className="small muted">Основание: {refOf(d, l.basis)}</div>}
              </div>))}
            {s.table && s.table.rows.length > 0 && <div className="small muted">Таблица: {s.table.rows.length} строк — в печатной форме.</div>}
          </details>))}
      </div>

      {can('haccp.approve') && !d.gaps.length && !r.current && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Утверждение</h2>
          <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/orgs/${org.id}/ppk/approve`, { method: 'POST', body: { changeNote: note } }); setNote(''); await load(); }); }}>
            <label htmlFor="note">Что введено или изменено</label>
            <input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={last ? 'Пересмотр: новый договор, изменён план ХАССП' : 'Введена впервые'} />
            <button className="btn" disabled={busy || note.trim().length < 3}>Утвердить версию {last ? last.version + 1 : 1}</button>
          </form>
        </div>
      )}

      {r.versions.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Утверждённые версии</h2>
          {[...r.versions].reverse().map((v) => (
            <p key={v.version} className="small"><Link href={`/app/${org.id}/compliance/ppk/print?v=${v.version}`}>Версия {v.version}</Link> — {dt(v.approved_at, org.timezone, { day: '2-digit', month: '2-digit', year: 'numeric' })}, {v.approved_by_name}: {v.change_note}</p>))}
        </div>
      )}
    </>
  );
}
