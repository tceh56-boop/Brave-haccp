'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { dt } from '@/lib/fmt';

interface Check { key: string; group: string; title: string; status: 'pass' | 'warn' | 'fail'; detail: string; href?: string; manual?: boolean; confirmation?: { by: string; at: string; evidence: string } | null }
interface Data { checks: Check[]; counts: { pass: number; warn: number; fail: number }; can_go: boolean;
  decisions: { id: string; decision: string; note: string; created_at: string; full_name: string; fails: number }[] }

const ST: Record<string, [string, string]> = { pass: ['Готово', 'ok'], warn: ['Внимание', 'warn'], fail: ['Не готово', 'crit'] };

/** Готовность к пилоту (этап 8): проверки из данных, подтверждения ответственных, решение «запускаем / не запускаем». */
export default function ReadinessPage() {
  const { org, siteId, sites, can } = useOrg();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const qs = sites.length > 1 && siteId ? `?siteId=${siteId}` : '';
  const load = useCallback(() => api<Data>(`/orgs/${org.id}/pilot${qs}`).then((r) => { setD(r); setErr(null); }).catch((e) => setErr(e.message)), [org.id, qs]);
  useEffect(() => { load(); }, [load]);
  if (!d) return err ? <div className="err">{err}</div> : <p className="muted">Проверяю готовность…</p>;
  const groups = [...new Set(d.checks.map((c) => c.group))];
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}`}>← Управление</Link></p>
      <h1>Готовность к пилоту</h1>
      <div className="tiles">
        <div className="tile">{d.counts.pass}<span className="sub">готово</span></div>
        <div className={`tile ${d.counts.fail ? 'alert' : ''}`}>{d.counts.fail}<span className="sub">не готово{d.counts.warn ? ` · внимание: ${d.counts.warn}` : ''}</span></div>
      </div>
      {d.can_go ? <div className="okbox">Блокирующих проблем нет — можно принимать решение о запуске пилота.</div>
        : <div className="err">Запуск невозможен, пока есть пункты «Не готово». Критический провал безопасности или целостности блокирует запуск.</div>}
      {groups.map((g) => (
        <div className="card" key={g}>
          <h2>{g}</h2>
          <ul className="list">{d.checks.filter((c) => c.group === g).map((c) => <Row key={c.key} c={c} onDone={load} />)}</ul>
        </div>
      ))}
      {can('pilot.decide') && <Decide canGo={d.can_go} onDone={load} siteId={sites.length > 1 ? siteId : null} />}
      {d.decisions.length > 0 && (
        <div className="card"><h2>Решения</h2>
          <ul className="list">{d.decisions.map((x) => (
            <li key={x.id}><span className={`badge ${x.decision === 'go' ? 'ok' : 'crit'}`}>{x.decision === 'go' ? 'Запускаем' : 'Не запускаем'}</span> {x.note}
              <div className="small muted">{x.full_name}, {dt(x.created_at, org.timezone)}{x.fails ? ` · на момент решения не готово: ${x.fails}` : ''}</div></li>
          ))}</ul></div>
      )}
      <div className="card small muted">
        Резервная копия снимается командой <code>npm run backup</code>, восстановление проверяется командой <code>npm run backup:verify</code> — во временную базу со сверкой строк, миграций, цепочек аудита и защит. Порядок пилота — в <code>docs/ПИЛОТ_ЭТАП_8.md</code>.
      </div>
    </>
  );
}

function Row({ c, onDone }: { c: Check; onDone: () => void }) {
  const { org, can } = useOrg();
  const [ev, setEv] = useState<string | null>(null);
  const { busy, error, run } = useSubmit();
  return (
    <li>
      <div className="between"><span>{c.href ? <Link href={c.href}>{c.title}</Link> : c.title}</span><span className={`badge ${ST[c.status][1]}`}>{ST[c.status][0]}</span></div>
      <div className="small muted">{c.confirmation ? `${c.confirmation.by}, ${dt(c.confirmation.at, org.timezone)}: ${c.confirmation.evidence}` : c.detail}</div>
      {c.manual && can('pilot.confirm') && (ev === null ? (
        <button className="btn small secondary" style={{ marginTop: 6 }} onClick={() => setEv('')}>{c.confirmation ? 'Отозвать' : 'Подтвердить'}</button>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); run(async () => {
          await api(`/orgs/${org.id}/pilot/confirm`, { body: { key: c.key.replace(/^confirm_/, ''), confirmed: !c.confirmation, evidence: ev } }); setEv(null); onDone();
        }); }}>
          {error && <div className="err">{error}</div>}
          <label htmlFor={`ev-${c.key}`}>{c.confirmation ? 'Причина отзыва' : 'Основание: кем и каким документом подтверждено'}</label>
          <input id={`ev-${c.key}`} required value={ev} onChange={(e) => setEv(e.target.value)} />
          <div className="row" style={{ marginTop: 6 }}><button className="btn small" disabled={busy}>Сохранить</button><button type="button" className="btn small secondary" onClick={() => setEv(null)}>Отмена</button></div>
        </form>
      ))}
    </li>
  );
}

function Decide({ canGo, siteId, onDone }: { canGo: boolean; siteId: string | null; onDone: () => void }) {
  const { org } = useOrg();
  const [note, setNote] = useState('');
  const { busy, error, run } = useSubmit();
  const send = (decision: 'go' | 'no_go') => run(async () => { await api(`/orgs/${org.id}/pilot/decide`, { body: { decision, note, siteId } }); setNote(''); onDone(); });
  return (
    <div className="card">
      <h2>Решение Go / No-Go</h2>
      {error && <div className="err">{error}</div>}
      <label htmlFor="dn">Решение и условия</label>
      <textarea id="dn" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Например: запуск на основной площадке с 22.10; через 2 недели — разбор итогов" />
      <div className="grid2">
        <button className="btn block" disabled={busy || !canGo || note.trim().length < 10} onClick={() => send('go')}>Запускаем</button>
        <button className="btn block secondary" disabled={busy || note.trim().length < 10} onClick={() => send('no_go')}>Не запускаем</button>
      </div>
      <p className="small muted">Решение сохраняется вместе со снимком всех проверок и не меняется.</p>
    </div>
  );
}
