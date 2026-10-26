'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';

/** «Готов ли я к проверке»: требования встроенной нормативной базы, применимые к предприятию, и их выполнение по данным системы. */

type Status = 'fail' | 'warn' | 'onsite' | 'ok';
interface Item { id: string; doc: string; doc_kind: string; clause: string; title: string; text: string; applies_note: string | null; status: Status; detail: string; href?: string | null; items?: string[] }
interface Doc { code: string; kind: string; title: string; issued: string; effective_from: string; effective_to: string | null; edition: string }
interface C { today: string; profile: { objectTypes: string[]; salesModes: string[]; seats: number | null; features: string[] }; profile_set: boolean; features: Record<string, string>;
  docs: Doc[]; summary: Record<Status | 'na', number>; items: Item[]; not_applicable: Omit<Item, 'status' | 'detail'>[] }

const BADGE: Record<Status, [string, string]> = { fail: ['crit', 'нарушение'], warn: ['warn', 'внимание'], onsite: ['', 'проверить на месте'], ok: ['ok', 'выполнено'] };
const TYPES: [string, string][] = [['cafe', 'Кафе'], ['restaurant', 'Ресторан'], ['canteen', 'Столовая'], ['catering', 'Кейтеринг'], ['delivery', 'Доставка'], ['school', 'Питание детей (школа, сад)'], ['hospital', 'Медицинская организация']];
const SALES: [string, string][] = [['hall', 'Зал'], ['takeaway', 'На вынос'], ['delivery', 'Доставка'], ['catering', 'Кейтеринг']];
const ddmm = (s: string) => s.split('-').reverse().join('.');

export default function Compliance() {
  const { org, can } = useOrg();
  const [c, setC] = useState<C | null>(null);
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState<C['profile'] | null>(null);
  const [show, setShow] = useState<Status | 'all'>('all');
  const { busy, error, run, setError } = useSubmit();
  const load = useCallback(() => api<C>(`/orgs/${org.id}/compliance`).then((x) => { setC(x); setF(x.profile); if (!x.profile_set) setEdit(true); }).catch((e) => setError(e.message)), [org.id, setError]);
  useEffect(() => { load(); }, [load]);
  if (!c || !f) return error ? <div className="err">{error}</div> : <p className="muted">Проверяю требования…</p>;
  const tog = (arr: string[], k: string) => (arr.includes(k) ? arr.filter((x) => x !== k) : [...arr, k]);
  const s = c.summary;
  const shown = c.items.filter((i) => show === 'all' || i.status === show);

  return (
    <>
      <h1>Готов ли я к проверке</h1>
      <p className="small muted">Система сверяет ваше предприятие с нормативной базой: каждое требование — дословно, со ссылкой на документ и пункт. Нарушение — с тем, что не так и где исправить.</p>
      {error && <div className="err" role="alert">{error}</div>}

      <div className="tiles">
        {([['fail', 'Нарушений'], ['warn', 'Внимание'], ['onsite', 'Проверить на месте'], ['ok', 'Выполнено']] as [Status, string][]).map(([k, l]) => (
          <button key={k} type="button" className={`tile ${k === 'fail' && s.fail ? 'alert' : ''}`} aria-pressed={show === k} onClick={() => setShow(show === k ? 'all' : k)}>{s[k]}<span className="sub">{l}</span></button>))}
      </div>
      {s.fail === 0 && s.warn === 0 && <div className="okbox">Нарушений по данным системы нет. Пункты «проверить на месте» сверьте сами.</div>}

      <div className="card">
        <div className="between"><h2 style={{ margin: 0 }}>Ваше предприятие</h2>{can('reg.manage') && !edit && <button className="btn secondary small" onClick={() => setEdit(true)}>Изменить</button>}</div>
        {!edit ? (
          <p className="small">{[f.objectTypes.map((t) => TYPES.find((x) => x[0] === t)?.[1] || t).join(', ') || 'тип не указан', f.salesModes.length ? `продажи: ${f.salesModes.map((t) => SALES.find((x) => x[0] === t)?.[1] || t).join(', ')}` : '',
            f.seats !== null ? `мест: ${f.seats}` : '', ...f.features.map((k) => c.features[k])].filter(Boolean).join(' · ')}</p>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); run(async () => {
            const cur = await api<{ profile: { processes: string[]; product_groups: string[] } }>(`/orgs/${org.id}/regulatory/profile`);
            await api(`/orgs/${org.id}/regulatory/profile`, { method: 'PUT', body: { objectTypes: f.objectTypes, salesModes: f.salesModes, seats: f.seats, features: f.features, processes: cur.profile.processes, productGroups: cur.profile.product_groups } });
            setEdit(false); await load();
          }); }}>
            <p className="small muted">От ответов зависит, какие требования к вам применяются.</p>
            <label>Тип предприятия</label>
            <div className="chips">{TYPES.map(([k, l]) => <button key={k} type="button" aria-pressed={f.objectTypes.includes(k)} onClick={() => setF({ ...f, objectTypes: tog(f.objectTypes, k) })}>{l}</button>)}</div>
            <label>Как продаёте</label>
            <div className="chips">{SALES.map(([k, l]) => <button key={k} type="button" aria-pressed={f.salesModes.includes(k)} onClick={() => setF({ ...f, salesModes: tog(f.salesModes, k) })}>{l}</button>)}</div>
            <label htmlFor="seats">Посадочных мест</label>
            <input id="seats" inputMode="numeric" value={f.seats ?? ''} onChange={(e) => setF({ ...f, seats: e.target.value === '' ? null : Number(e.target.value.replace(/\D/g, '')) })} placeholder="0 — без зала" />
            <label>Особенности</label>
            {Object.entries(c.features).map(([k, l]) => (
              <label key={k} style={{ fontWeight: 400, display: 'flex', gap: 10, alignItems: 'flex-start', margin: '6px 0' }}><input type="checkbox" style={{ width: 22, minHeight: 22, flex: 'none' }} checked={f.features.includes(k)} onChange={() => setF({ ...f, features: tog(f.features, k) })} /> {l}</label>))}
            <div className="row" style={{ gap: 8 }}><button className="btn" disabled={busy}>Сохранить</button>{c.profile_set && <button type="button" className="btn secondary" onClick={() => { setEdit(false); setF(c.profile); }}>Отмена</button>}</div>
          </form>
        )}
      </div>

      {shown.map((i) => (
        <div key={i.id} className="card">
          <div className="between" style={{ alignItems: 'flex-start' }}><b>{i.title}</b><span className={`badge ${BADGE[i.status][0]}`}>{BADGE[i.status][1]}</span></div>
          <div className="small muted">{i.doc}, {i.clause}{i.doc_kind === 'Разъяснение' ? ' · разъяснение органа надзора' : ''}{i.applies_note ? ` · ${i.applies_note}` : ''}</div>
          <p style={{ margin: '6px 0' }}>{i.detail}</p>
          {i.items && i.items.length > 0 && <ul className="small" style={{ margin: '0 0 6px', paddingLeft: 18 }}>{i.items.map((x) => <li key={x}>{x}</li>)}</ul>}
          {i.href && i.status !== 'ok' && <Link className="btn small" href={i.href}>Исправить ›</Link>}
          <details style={{ marginTop: 6 }}><summary className="small">Текст требования</summary><p className="small" style={{ whiteSpace: 'pre-line' }}>{i.text}</p></details>
        </div>
      ))}

      {c.not_applicable.length > 0 && (
        <details className="card"><summary>Не применяются к вашему предприятию ({c.not_applicable.length})</summary>
          {c.not_applicable.map((i) => <p key={i.id} className="small"><b>{i.title}</b> — {i.doc}, {i.clause}; {i.applies_note}</p>)}</details>
      )}

      <details className="card"><summary>Нормативная база ({c.docs.length})</summary>
        {c.docs.map((d) => <p key={d.code} className="small"><b>{d.code}</b> «{d.title}» — {d.issued}; действует с {ddmm(d.effective_from)}{d.effective_to ? ` до ${ddmm(d.effective_to)}` : ''}. Текст: {d.edition}.</p>)}
        <p className="small muted">Тексты требований — дословно из официальных изданий. Проверка на {ddmm(c.today)}.</p>
      </details>
    </>
  );
}
