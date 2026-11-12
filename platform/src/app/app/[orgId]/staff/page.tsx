'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { SitePicker } from '@/components/OrgNav';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';

/** Персонал: готовность к работе — медицинский допуск, осмотр перед сменой, инструктажи; темы и проведение инструктажей. */

interface Brief { topic_id: string; title: string; state: string }
interface Row { user_id: string; full_name: string; role: string; role_label: string; position: string | null; food: boolean;
  medical: { status: string; label: string; restrictions: string | null }; today_check: { admitted: boolean; signs: string | null } | null; briefings: Brief[]; briefings_due: number }
interface Topic { id: string; title: string; category: string; category_label: string; material: string; period_months: number | null; roles: string[] }
interface Data { gate: string; today: string; staff: Row[]; topics: Topic[] }
const MED_TONE: Record<string, string> = { ok: 'ok', soon: 'warn', expired: 'crit', missing: 'crit' };
const GATES: [string, string][] = [['off', 'Выключено'], ['warn', 'Предупреждать'], ['block', 'Блокировать']];
const TYPES: [string, string][] = [['intro', 'Вводный'], ['primary', 'Первичный на рабочем месте'], ['repeat', 'Повторный'], ['unscheduled', 'Внеплановый'], ['target', 'Целевой'], ['training', 'Обучение']];
const ROLE_OPTS: [string, string][] = [['line_staff', 'Сотрудник цеха'], ['chef', 'Шеф / су-шеф'], ['storekeeper', 'Кладовщик'], ['cashier', 'Кассир'], ['haccp_lead', 'ХАССП'], ['technologist', 'Технолог']];

export default function Staff() {
  const { org, siteId, can } = useOrg();
  const [x, setX] = useState<Data | null>(null);
  const [bad, setBad] = useState<{ id: string; signs: string; action: string } | null>(null);
  const [tf, setTf] = useState({ title: '', category: 'safety', material: '', periodMonths: '', roles: [] as string[] });
  const [bf, setBf] = useState({ topicId: '', briefingType: 'repeat', userIds: [] as string[], result: 'passed', note: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const { busy, error, run, setError } = useSubmit();
  const load = useCallback(() => api<Data>(`/orgs/${org.id}/staff${siteId ? `?siteId=${siteId}` : ''}`).then(setX).catch((e) => setError(e.message)), [org.id, siteId, setError]);
  useEffect(() => { load(); }, [load]);
  if (!x) return <><h1>Персонал</h1>{error ? <div className="err">{error}</div> : <p className="muted">Загрузка…</p>}</>;
  const toCheck = x.staff.filter((s) => s.food && !s.today_check);
  const check = (uid: string, admitted: boolean, signs?: string, action?: string) => run(async () => {
    await api(`/orgs/${org.id}/staff/${uid}/health-check`, { body: { siteId, admitted, signs: signs || null, action: action || null } }); setBad(null); load();
  });
  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((a) => a !== v) : [...arr, v]);
  return (
    <>
      <h1>Персонал</h1>
      <p className="small muted">Допуск к работе с продукцией: действующие медосмотр и гигиеническая аттестация (ЛМК), осмотр перед сменой, инструктажи по должности.</p>
      <SitePicker />
      {error && <div className="err" role="alert">{error}</div>}
      {msg && <div className="okbox" role="status">{msg}</div>}

      {can('staff.medical') && (
        <div className="card">
          <h2>Медицинский допуск — режим</h2>
          <div className="chips">{GATES.map(([k, l]) => <button key={k} type="button" aria-pressed={x.gate === k} disabled={busy} onClick={() => run(async () => { await api(`/orgs/${org.id}/staff/settings`, { body: { medicalGate: k } }); load(); })}>{l}</button>)}</div>
          <p className="small muted">«Блокировать»: повар или шеф без действующего допуска или не допущенный на осмотре не вносит замеры, производство, пробы, приёмку и санитарию.</p>
        </div>
      )}

      {can('staff.health_check') && toCheck.length > 0 && (
        <div className="card">
          <h2>Осмотр перед сменой · {toCheck.length}</h2>
          <ul className="list">{toCheck.map((s) => (
            <li key={s.user_id}>
              <div className="between"><b>{s.full_name}</b><span className="small muted">{s.position || s.role_label}</span></div>
              {bad?.id === s.user_id ? (
                <>
                  <input aria-label="Признаки" value={bad.signs} onChange={(e) => setBad({ ...bad, signs: e.target.value })} placeholder="признаки: гнойничковые поражения, ОРВИ, жалобы" style={{ marginTop: 6 }} />
                  <input aria-label="Меры" value={bad.action} onChange={(e) => setBad({ ...bad, action: e.target.value })} placeholder="меры: отстранён, направлен к врачу" style={{ marginTop: 6 }} />
                  <div className="row" style={{ marginTop: 6 }}>
                    <button className="btn small danger" disabled={busy || bad.signs.trim().length < 3 || bad.action.trim().length < 3} onClick={() => check(s.user_id, false, bad.signs, bad.action)}>Не допущен</button>
                    <button className="btn small secondary" onClick={() => setBad(null)}>Отмена</button>
                  </div>
                </>
              ) : (
                <div className="row" style={{ marginTop: 6 }}>
                  <button className="btn small" disabled={busy || !siteId} onClick={() => check(s.user_id, true)}>Допущен</button>
                  <button className="btn small secondary" onClick={() => setBad({ id: s.user_id, signs: '', action: '' })}>Есть признаки</button>
                </div>
              )}
            </li>))}</ul>
        </div>
      )}

      <div className="card">
        <h2>Сотрудники · {x.staff.length}</h2>
        {x.staff.map((s) => (
          <Link key={s.user_id} href={`/app/${org.id}/staff/${s.user_id}`} className="objrow">
            <div><b>{s.full_name}</b>
              <div className="small muted">{s.position || s.role_label}{s.today_check ? (s.today_check.admitted ? ' · осмотр: допущен' : ' · осмотр: НЕ допущен') : ''}{s.briefings_due ? ` · инструктажей к проведению: ${s.briefings_due}` : ''}</div></div>
            {s.food || s.medical.status !== 'missing' ? <span className={`badge ${s.today_check && !s.today_check.admitted ? 'crit' : MED_TONE[s.medical.status]}`}>{s.today_check && !s.today_check.admitted ? 'не допущен' : `ЛМК: ${s.medical.label}`}</span>
              : <span className="badge">{s.role_label}</span>}
          </Link>))}
      </div>

      {can('staff.brief') && <>
        <div className="card">
          <h2>Провести инструктаж</h2>
          {x.topics.length === 0 ? <p className="small muted">Сначала добавьте тему ниже.</p> : <>
            <label htmlFor="bt">Тема</label>
            <select id="bt" value={bf.topicId} onChange={(e) => setBf({ ...bf, topicId: e.target.value })}><option value="">— тема —</option>{x.topics.map((t) => <option key={t.id} value={t.id}>{t.category_label}: {t.title}</option>)}</select>
            <label htmlFor="bk">Вид</label>
            <select id="bk" value={bf.briefingType} onChange={(e) => setBf({ ...bf, briefingType: e.target.value })}>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <p className="small" style={{ marginBottom: 4 }}><b>Сотрудники</b></p>
            <div className="chips">{x.staff.map((s) => <button key={s.user_id} type="button" aria-pressed={bf.userIds.includes(s.user_id)} onClick={() => setBf({ ...bf, userIds: toggle(bf.userIds, s.user_id) })}>{s.full_name}</button>)}</div>
            <div className="seg">
              <button type="button" className="yes" aria-pressed={bf.result === 'passed'} onClick={() => setBf({ ...bf, result: 'passed' })}>Сдал</button>
              <button type="button" className="no" aria-pressed={bf.result === 'failed'} onClick={() => setBf({ ...bf, result: 'failed' })}>Не сдал</button>
            </div>
            <label htmlFor="bn">Примечание {bf.result === 'failed' ? '(что повторить)' : ''}</label><input id="bn" value={bf.note} onChange={(e) => setBf({ ...bf, note: e.target.value })} placeholder="результат теста, вопросы" />
            <button className="btn block" disabled={busy || !bf.topicId || !bf.userIds.length} onClick={() => run(async () => {
              const r = await api<{ ids: string[]; next_due: string | null }>(`/orgs/${org.id}/staff/briefings`, { body: { ...bf, note: bf.note || null } });
              setMsg(`Записано: ${r.ids.length}. Сотрудники подтвердят ознакомление у себя.${r.next_due ? ` Следующий — до ${r.next_due.split('-').reverse().join('.')}.` : ''}`);
              setBf({ ...bf, userIds: [], note: '' }); load();
            })}>Записать инструктаж</button>
          </>}
        </div>
        <div className="card">
          <h2>Темы · {x.topics.length}</h2>
          <ul className="list">{x.topics.map((t) => (
            <li key={t.id}><b>{t.title}</b> <span className="badge">{t.category_label}</span>
              <div className="small muted">{t.material}{t.period_months ? ` · раз в ${t.period_months} мес.` : ' · однократно'} · {t.roles.length ? t.roles.map((r) => ROLE_OPTS.find(([k]) => k === r)?.[1] || r).join(', ') : 'все сотрудники'}</div></li>))}</ul>
          <form onSubmit={(e) => { e.preventDefault(); run(async () => {
            await api(`/orgs/${org.id}/staff/topics`, { body: { ...tf, periodMonths: tf.periodMonths || null } }); setTf({ title: '', category: tf.category, material: '', periodMonths: '', roles: [] }); load();
          }); }}>
            <h3 style={{ marginTop: 12 }}>Новая тема</h3>
            <div className="grid2">
              <div><label htmlFor="tt">Тема</label><input id="tt" value={tf.title} onChange={(e) => setTf({ ...tf, title: e.target.value })} placeholder="Охрана труда повара" /></div>
              <div><label htmlFor="tc">Раздел</label><select id="tc" value={tf.category} onChange={(e) => setTf({ ...tf, category: e.target.value })}><option value="safety">Охрана труда</option><option value="sanitary">Санминимум</option><option value="haccp">ХАССП</option></select></div>
              <div><label htmlFor="tm">Материал</label><input id="tm" value={tf.material} onChange={(e) => setTf({ ...tf, material: e.target.value })} placeholder="ИОТ-01, ред. 2026" /></div>
              <div><label htmlFor="tp">Раз в, мес.</label><input id="tp" inputMode="numeric" value={tf.periodMonths} onChange={(e) => setTf({ ...tf, periodMonths: e.target.value })} placeholder="пусто — однократно" /></div>
            </div>
            <p className="small" style={{ marginBottom: 4 }}><b>Для ролей</b> (не выбрано — для всех)</p>
            <div className="chips">{ROLE_OPTS.map(([k, l]) => <button key={k} type="button" aria-pressed={tf.roles.includes(k)} onClick={() => setTf({ ...tf, roles: toggle(tf.roles, k) })}>{l}</button>)}</div>
            <button className="btn secondary block" disabled={busy}>Добавить тему</button>
          </form>
        </div>
      </>}
    </>
  );
}
