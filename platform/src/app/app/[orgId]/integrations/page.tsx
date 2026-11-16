'use client';
import { useCallback, useEffect, useState } from 'react';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';

/**
 * Интеграции (ТЗ доработки, P3): у каждой системы — честный статус. Включается только то, что проверено;
 * для остального видно, каких документов и доступов не хватает. Учётные данные хранятся зашифрованными и не показываются.
 */

interface Sys { code: string; title: string; state: 'ready' | 'needs_access' | 'needs_spec'; what: string; needs: string[]; settings: string[]; secrets: string[];
  enabled: boolean; settings_values: Record<string, string>; secrets_set: string[] }
interface Data { systems: Sys[]; events: { system: string; action: string; status: string; detail: string; created_at: string; who: string | null }[]; encryption: boolean }
const STATE: Record<string, [string, string]> = { ready: ['готово', 'ok'], needs_access: ['нужны доступы', 'warn'], needs_spec: ['нужна спецификация', 'crit'] };

export default function Integrations() {
  const { org } = useOrg();
  const [d, setD] = useState<Data | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const { busy, error, run, setError } = useSubmit();
  const load = useCallback(() => api<Data>(`/orgs/${org.id}/integrations`).then(setD).catch((e) => setError(e.message)), [org.id, setError]);
  useEffect(() => { load(); }, [load]);
  if (!d) return error ? <div className="err">{error}</div> : <p className="muted">Загрузка…</p>;
  const title = Object.fromEntries(d.systems.map((s) => [s.code, s.title]));
  return (
    <>
      <h1>Интеграции</h1>
      <p className="muted">Обмен включается только после проверки на реальном формате или тестовом контуре — система не имитирует обмен, которого нет.</p>
      {!d.encryption && <div className="note small">На сервере не задан ключ шифрования (CEH_SECRET_KEY) — учётные данные внешних систем сохранить нельзя.</div>}
      {error && <div className="err">{error}</div>}
      {d.systems.map((s) => (
        <div key={s.code} className="card">
          <div className="between"><h2 style={{ margin: 0 }}>{s.title}</h2><span className={`badge ${STATE[s.state][1]}`}>{STATE[s.state][0]}{s.enabled ? ' · включена' : ''}</span></div>
          <p className="small">{s.what}</p>
          {s.needs.length > 0 && <div className="small"><b>Что нужно для подключения:</b><ul style={{ margin: '2px 0 0', paddingLeft: 18 }}>{s.needs.map((x) => <li key={x}>{x}</li>)}</ul></div>}
          {(s.settings.length > 0 || s.secrets.length > 0) && (open === s.code ? (
            <form onSubmit={(e) => { e.preventDefault(); run(async () => {
              const settings = Object.fromEntries(s.settings.filter((k) => form[k] !== undefined).map((k) => [k, form[k]]));
              const secrets = Object.fromEntries(s.secrets.filter((k) => form[`#${k}`]).map((k) => [k, form[`#${k}`]]));
              await api(`/orgs/${org.id}/integrations/${s.code}`, { method: 'PUT', body: { settings, secrets } }); setOpen(null); setForm({}); await load();
            }); }}>
              {s.settings.map((k) => <div key={k}><label htmlFor={`${s.code}-${k}`}>{k}</label><input id={`${s.code}-${k}`} defaultValue={s.settings_values[k] || ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></div>)}
              {s.secrets.map((k) => <div key={k}><label htmlFor={`${s.code}-s-${k}`}>{k} {s.secrets_set.includes(k) ? '(задан — оставьте пустым, чтобы не менять)' : ''}</label><input id={`${s.code}-s-${k}`} type="password" autoComplete="off" onChange={(e) => setForm({ ...form, [`#${k}`]: e.target.value })} /></div>)}
              <button className="btn small" disabled={busy}>Сохранить</button> <button type="button" className="btn small secondary" onClick={() => setOpen(null)}>Отмена</button>
            </form>) : <button type="button" className="btn small secondary" onClick={() => { setOpen(s.code); setForm({}); }}>Параметры{s.secrets_set.length ? ` (заданы: ${s.secrets_set.join(', ')})` : ''}</button>)}
          {s.state === 'ready' && <button type="button" className="btn small" style={{ marginLeft: 6 }} disabled={busy} onClick={() => run(async () => { await api(`/orgs/${org.id}/integrations/${s.code}/enable`, { body: { enabled: !s.enabled } }); await load(); })}>{s.enabled ? 'Выключить' : 'Включить'}</button>}
        </div>))}
      <div className="card">
        <h2>Журнал обмена</h2>
        {!d.events.length ? <p className="small muted">Событий нет.</p> : <ul>{d.events.map((e, i) => <li key={i} className="small">{new Date(e.created_at).toLocaleString('ru-RU')} · {title[e.system] || e.system} · {e.action}: {e.status === 'ok' ? 'успешно' : e.status === 'skipped' ? 'не выполнено' : 'ошибка'} — {e.detail}{e.who ? ` (${e.who})` : ''}</li>)}</ul>}
      </div>
    </>
  );
}
