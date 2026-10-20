'use client';
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { SitePicker } from '@/components/OrgNav';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { dt } from '@/lib/fmt';
import type { FormInfo } from '../page';

interface Signoff { id: string; signer: string; signed_at: string; rows_count: number; note: string | null; valid: boolean }
interface Journal { form: FormInfo; site: { name: string }; period: { from: string; to: string }; columns: string[]; rows: string[][]; grid: boolean; content_hash: string; signoffs: Signoff[]; blockers: string[] }
interface Entry { id: string; occurred_at: string; entered_at: string; is_late: boolean; values: Record<string, string>; corrects_id: string | null; correction_reason: string | null; author: string }

const ymd = (date: Date, tz: string) => date.toLocaleDateString('sv-SE', { timeZone: tz });

/** Журнал за период: просмотр, печать и выгрузка, подпись ответственного; для ручных форм — запись по столбцам. */
export default function JournalPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const { org, siteId, can } = useOrg();
  const today = ymd(new Date(), org.timezone);
  const [period, setPeriod] = useState({ from: today, to: today });
  const [j, setJ] = useState<Journal | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const { busy, error, run } = useSubmit();
  const qs = siteId ? `siteId=${siteId}&from=${period.from}&to=${period.to}` : '';
  const load = useCallback(() => {
    if (!siteId) return;
    setLoadErr(null);
    api<Journal>(`/orgs/${org.id}/journals/${code}?${qs}`).then(setJ).catch((e) => { setJ(null); setLoadErr(e.message); });
  }, [org.id, code, qs, siteId]);
  useEffect(() => { load(); }, [load]);

  const preset = (days: number, month = false) => {
    const now = new Date();
    if (month) { const [y, m] = today.split('-'); setPeriod({ from: `${y}-${m}-01`, to: today }); return; }
    setPeriod({ from: ymd(new Date(now.getTime() - days * 86400e3), org.timezone), to: today });
  };
  const valid = j?.signoffs.find((s) => s.valid);
  const exportUrl = (format: string) => `/api/v1/orgs/${org.id}/journals/${code}?${qs}&format=${format}`;

  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/journals`}>← Журналы</Link></p>
      <SitePicker />
      <h1>{j ? `${j.form.code} ${j.form.name}` : code}</h1>
      {j && <p className="small muted">{j.form.purpose}{j.form.mode === 'auto' ? ' · заполняется из операций' : ''}{j.form.shares_with ? ` · те же записи, что в ${j.form.shares_with}` : ''}</p>}
      <div className="card">
        <div className="chips">
          <button aria-pressed={period.from === today && period.to === today} onClick={() => preset(0)}>Сегодня</button>
          <button onClick={() => preset(6)}>7 дней</button>
          <button onClick={() => preset(0, true)}>Этот месяц</button>
        </div>
        <div className="grid2">
          <div><label htmlFor="pf">С</label><input id="pf" type="date" value={period.from} max={period.to} onChange={(e) => e.target.value && setPeriod({ ...period, from: e.target.value })} /></div>
          <div><label htmlFor="pt">По</label><input id="pt" type="date" value={period.to} min={period.from} onChange={(e) => e.target.value && setPeriod({ ...period, to: e.target.value })} /></div>
        </div>
        {j?.grid && <p className="small muted">Месячная сетка: показан весь месяц даты «С». Значения за день — через «/», «!» — вне предела.</p>}
      </div>
      {loadErr && <div className="err">{loadErr}</div>}
      {error && <div className="err">{error}</div>}
      {j && (
        <>
          <div className="card">
            <div className="between"><b>Записей: {j.rows.length}</b>
              <div className="row">
                <a className="btn small secondary" href={exportUrl('html')} target="_blank" rel="noopener">Печать</a>
                <a className="btn small secondary" href={exportUrl('csv')}>CSV</a>
              </div></div>
            <div className="scroll" style={{ marginTop: 10 }}>
              <table className="tbl">
                <thead><tr>{j.columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
                <tbody>{j.rows.length === 0 ? <tr><td colSpan={j.columns.length} className="muted">Записей за период нет</td></tr>
                  : j.rows.map((r, i) => <tr key={i}>{r.map((c, k) => <td key={k}>{c}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </div>
          <div className="card">
            <h2>Подпись за период</h2>
            {valid ? <div className="okbox">Подписано: {valid.signer}, {dt(valid.signed_at, org.timezone)}{valid.note ? ` — ${valid.note}` : ''}</div>
              : j.signoffs.length ? <div className="note">Журнал изменился после подписи ({j.signoffs[0].signer}, {dt(j.signoffs[0].signed_at, org.timezone)}). Нужна новая подпись.</div>
              : <p className="small muted">Не подписан.</p>}
            {j.blockers.length > 0 && <div className="err">Подписать нельзя, пока в журнале есть проблемы:<ul>{j.blockers.map((b) => <li key={b}>{b}</li>)}</ul><Link href={`/app/${org.id}/problems`}>Открыть проблемы →</Link></div>}
            {can('journal.sign') && !valid && j.blockers.length === 0 && (
              <button className="btn block" disabled={busy} onClick={() => run(async () => {
                await api(`/orgs/${org.id}/journals/${code}/sign`, { body: { siteId, from: j.period.from, to: j.period.to, contentHash: j.content_hash, note: null } });
                load();
              })}>Подписать журнал за период</button>
            )}
          </div>
          {j.form.mode === 'manual' && can('journal.record') && siteId && <Manual code={code} dataForm={j.form.data_form} siteId={siteId} onSaved={load} />}
        </>
      )}
    </>
  );
}

function Manual({ code, dataForm, siteId, onSaved }: { code: string; dataForm: string; siteId: string; onSaved: () => void }) {
  const { org } = useOrg();
  const [columns, setColumns] = useState<string[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [occurredAt, setOccurredAt] = useState('');
  const [fix, setFix] = useState<{ entry: Entry; values: Record<string, string>; reason: string } | null>(null);
  const { busy, error, run } = useSubmit();
  const load = useCallback(async () => {
    const forms = await api<FormInfo[]>(`/orgs/${org.id}/journals`);
    setColumns(forms.find((f) => f.code === dataForm)?.columns || []);
    setEntries(await api<Entry[]>(`/orgs/${org.id}/journals/${code}/entries?siteId=${siteId}`));
  }, [org.id, code, dataForm, siteId]);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="card">
        <h2>Новая запись</h2>
        {dataForm !== code && <p className="small muted">Запись сохраняется в {dataForm} и показывается в обеих формах.</p>}
        {error && <div className="err">{error}</div>}
        <form onSubmit={(e) => { e.preventDefault(); run(async () => {
          await api(`/orgs/${org.id}/journals/${code}/entries`, { body: { siteId, values, occurredAt: occurredAt ? new Date(occurredAt).toISOString() : undefined } });
          setValues({}); setOccurredAt(''); await load(); onSaved();
        }); }}>
          {columns.map((c, i) => (
            <div key={i}><label htmlFor={`v${i}`}>{c}</label><input id={`v${i}`} value={values[i] || ''} onChange={(e) => setValues({ ...values, [i]: e.target.value })} /></div>
          ))}
          <label htmlFor="occ">Когда выполнено (если не сейчас)</label>
          <input id="occ" type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
          <p className="small muted">Позже 15 минут запись помечается как внесённая позже. Старше суток внести нельзя.</p>
          <button className="btn block" disabled={busy}>Сохранить запись</button>
        </form>
      </div>
      {entries.length > 0 && (
        <div className="card">
          <h2>Последние записи</h2>
          <ul className="list">{entries.map((e) => (
            <li key={e.id}>
              <div className="between"><span className="small">{dt(e.occurred_at, org.timezone)} · {e.author}{e.is_late ? ' · внесено позже' : ''}{e.corrects_id ? ` · исправлено: ${e.correction_reason}` : ''}</span>
                <button className="btn small secondary" onClick={() => setFix({ entry: e, values: { ...e.values }, reason: '' })}>Исправить</button></div>
              <div className="small">{columns.map((c, i) => e.values[i] ? `${c}: ${e.values[i]}` : '').filter(Boolean).join(' · ')}</div>
              {fix?.entry.id === e.id && (
                <form onSubmit={(ev) => { ev.preventDefault(); run(async () => {
                  await api(`/orgs/${org.id}/journals/entries/${e.id}/correct`, { body: { values: fix.values, reason: fix.reason } });
                  setFix(null); await load(); onSaved();
                }); }}>
                  {columns.map((c, i) => (
                    <div key={i}><label htmlFor={`f${i}`}>{c}</label><input id={`f${i}`} value={fix.values[i] || ''} onChange={(ev) => setFix({ ...fix, values: { ...fix.values, [i]: ev.target.value } })} /></div>
                  ))}
                  <label htmlFor="fr">Причина исправления</label>
                  <input id="fr" required minLength={5} value={fix.reason} onChange={(ev) => setFix({ ...fix, reason: ev.target.value })} />
                  <p className="small muted">Исходная запись сохраняется; в журнале показывается исправленная с причиной.</p>
                  <div className="row"><button className="btn small" disabled={busy}>Сохранить исправление</button><button type="button" className="btn small secondary" onClick={() => setFix(null)}>Отмена</button></div>
                </form>
              )}
            </li>
          ))}</ul>
        </div>
      )}
    </>
  );
}
