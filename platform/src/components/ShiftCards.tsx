'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { dt } from '@/lib/fmt';

/**
 * Карточки смены (этап 3 доработки): «что сделать сейчас» — одно касание и одно поле. Порядок и содержание задаёт сервер
 * (`/sites/{id}/shift-cards`); действие карточки — вызов существующего API, бизнес-правил здесь нет.
 */

interface Action { type: 'number' | 'done' | 'open' | 'info'; url?: string; body?: Record<string, unknown>; field?: string; unit?: string; label?: string; href?: string }
interface Card { key: string; kind: string; bucket: 'overdue' | 'now' | 'later'; title: string; detail: string; due_at: string | null; action: Action; href?: string | null }
interface Data { cards: Card[]; probes: { id: string; name: string; serial_no: string | null }[]; counts: { overdue: number; now: number; later: number } }

const BUCKET: Record<Card['bucket'], [string, string]> = { overdue: ['Просрочено', 'crit'], now: ['Сейчас', 'warn'], later: ['Позже сегодня', ''] };
const PROBE_KEY = 'ceh:probe';

export function ShiftCards({ orgId, siteId, tz, onChange }: { orgId: string; siteId: string; tz: string; onChange?: () => void }) {
  const [d, setD] = useState<Data | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [probe, setProbe] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ key: string; ok: boolean; text: string } | null>(null);
  const load = useCallback(() => api<Data>(`/orgs/${orgId}/sites/${siteId}/shift-cards`).then((x) => {
    setD(x);
    let saved = '';
    try { saved = localStorage.getItem(PROBE_KEY) || ''; } catch { /* хранилище недоступно */ }
    setProbe((p) => p || (x.probes.some((pr) => pr.id === saved) ? saved : x.probes[0]?.id || ''));
  }).catch((e) => setMsg({ key: '', ok: false, text: e.message })), [orgId, siteId]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <p className="muted">Загрузка…</p>;

  const act = async (c: Card) => {
    const a = c.action;
    if (!a.url) return;
    const body: Record<string, unknown> = { ...(a.body || {}) };
    if (a.type === 'number') {
      const v = (vals[c.key] || '').trim().replace(',', '.');
      if (!v) return setMsg({ key: c.key, ok: false, text: 'Введите значение.' });
      body[a.field || 'value'] = v;
      if (c.kind === 'measure' && probe) body.instrumentId = probe;
    }
    setBusy(c.key); setMsg(null);
    try {
      const r = await api<{ result?: string }>(a.url, { body });
      setMsg({ key: c.key, ok: r?.result !== 'deviation', text: r?.result === 'deviation' ? 'Вне предела — ответственный получил отклонение. Действуйте по процедуре.' : 'Готово.' });
      setVals({ ...vals, [c.key]: '' });
      await load(); onChange?.();
    } catch (e) { setMsg({ key: c.key, ok: false, text: (e as Error).message }); } finally { setBusy(null); }
  };
  const flip = (k: string) => setVals({ ...vals, [k]: (vals[k] || '').startsWith('-') ? (vals[k] || '').slice(1) : `-${vals[k] || ''}` });
  const needProbe = d.cards.some((c) => c.kind === 'measure');

  return (
    <div className="card">
      <div className="between"><h2 style={{ margin: 0 }}>Что сделать</h2>
        <span className="small">{d.counts.overdue > 0 && <span className="badge crit">просрочено: {d.counts.overdue}</span>} {d.counts.now > 0 && <span className="badge warn">сейчас: {d.counts.now}</span>}</span></div>
      {needProbe && d.probes.length > 0 && <>
        <label htmlFor="shprobe" className="small">Термометр (поверка действует)</label>
        <select id="shprobe" style={{ minHeight: 48 }} value={probe} onChange={(e) => { setProbe(e.target.value); try { localStorage.setItem(PROBE_KEY, e.target.value); } catch { /* нет хранилища */ } }}>
          {d.probes.map((p) => <option key={p.id} value={p.id}>{p.name}{p.serial_no ? ` № ${p.serial_no}` : ''}</option>)}
        </select>
      </>}
      {msg && !d.cards.some((c) => c.key === msg.key) && <div className={msg.ok ? 'note' : 'err'} role="status">{msg.text}</div>}
      {d.cards.length === 0 && <p className="muted">На сейчас всё сделано.</p>}
      <ul className="list">{d.cards.map((c, i) => {
        const head = i === 0 || d.cards[i - 1].bucket !== c.bucket;
        return (
          <li key={c.key} style={head ? { borderTop: 'none' } : undefined}>
            {head && <div className="small" style={{ margin: '8px 0 4px' }}><span className={`badge ${BUCKET[c.bucket][1]}`}>{BUCKET[c.bucket][0]}</span></div>}
            <div><b>{c.href ? <Link href={c.href}>{c.title}</Link> : c.title}</b>
              {c.detail && <div className="small muted">{c.detail}</div>}
              {c.due_at && c.kind !== 'production' && c.kind !== 'sanitation' && <div className="small muted">к {dt(c.due_at, tz)}</div>}</div>
            {c.action.type === 'number' && (
              <form className="row" style={{ marginTop: 6 }} onSubmit={(e) => { e.preventDefault(); act(c); }}>
                {c.action.unit === '°C' && <button type="button" className="btn secondary" style={{ minHeight: 48, minWidth: 48 }} aria-label="Сменить знак" onClick={() => flip(c.key)}>±</button>}
                <input aria-label={c.title} inputMode="decimal" autoComplete="off" value={vals[c.key] || ''} onChange={(e) => setVals({ ...vals, [c.key]: e.target.value })}
                  placeholder={c.action.unit} style={{ flex: 1, minHeight: 48, fontSize: 20 }} />
                <button className="btn" style={{ minHeight: 48 }} disabled={busy === c.key}>{c.action.label || 'Записать'}</button>
              </form>)}
            {c.action.type === 'done' && <button className="btn block" style={{ minHeight: 48, marginTop: 6 }} disabled={busy === c.key} onClick={() => act(c)}>{c.action.label || 'Сделано'}</button>}
            {c.action.type === 'open' && c.action.href && <Link className="btn block secondary" style={{ minHeight: 48, marginTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }} href={c.action.href}>{c.action.label || 'Открыть'}</Link>}
            {msg?.key === c.key && <div className={msg.ok ? 'note' : 'err'} role="status">{msg.text}</div>}
          </li>);
      })}</ul>
    </div>
  );
}
