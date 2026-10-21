'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useOrg } from '@/lib/org';
import { SitePicker } from '@/components/OrgNav';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { dt, n } from '@/lib/fmt';

/** Санитария: что сделать сегодня (отметка, замер концентрации, проверка), план уборок, дезсредства с утверждённым режимом. */

interface Plan { id: string; area: string; work: string; kind: string; kind_label: string; period_days: number; check_concentration: boolean; responsible_role: string; next_due: string;
  disinfectant: string | null; range: string | null; exposure: string | null; state: string }
interface Rec { id: string; plan_id: string; area: string; work: string; kind_label: string; done_at: string; done_by: string; done_by_id: string; concentration: number | null; concentration_ok: boolean | null;
  result: string; note: string | null; disinfectant: string | null; verified_ok: boolean | null; verify_note: string | null; verified_by: string | null }
interface Dis { id: string; name: string; purpose: string; range: string | null; exposure: string | null; basis: string; status: string; approved_by: string | null }
interface S { today: string; plans: Plan[]; records: Rec[]; disinfectants: Dis[] }
const ROLES: [string, string][] = [['line_staff', 'Сотрудник цеха'], ['chef', 'Шеф / су-шеф'], ['storekeeper', 'Кладовщик'], ['haccp_lead', 'Ответственный ХАССП']];
const KINDS: [string, string][] = [['current', 'Текущая уборка'], ['general', 'Генеральная уборка'], ['disinfection', 'Дезинфекция'], ['inventory', 'Мойка инвентаря и тары']];
const ddmm = (s: string) => s.slice(0, 10).split('-').reverse().join('.');
const num = (s: string) => s.trim().replace(',', '.');

function Sanitation() {
  const { org, siteId, can, me } = useOrg();
  const [tab, setTab] = useState(useSearchParams().get('tab') || 'today');
  const [x, setX] = useState<S | null>(null);
  const [conc, setConc] = useState<Record<string, string>>({});
  const [bad, setBad] = useState<{ id: string; note: string } | null>(null);
  const [pf, setPf] = useState({ area: '', work: '', kind: 'current', periodDays: '1', disinfectantId: '', checkConcentration: false, responsibleRole: 'line_staff', nextDue: '' });
  const [df, setDf] = useState({ name: '', purpose: '', concentrationMin: '', concentrationMax: '', exposure: '', basis: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const { busy, error, run, setError } = useSubmit();
  const load = useCallback(() => { if (siteId) api<S>(`/orgs/${org.id}/sanitation?siteId=${siteId}`).then(setX).catch((e) => setError(e.message)); }, [org.id, siteId, setError]);
  useEffect(() => { load(); }, [load]);
  const manage = can('sanitation.manage');
  if (!x) return <><h1>Санитария</h1><SitePicker />{error ? <div className="err">{error}</div> : <p className="muted">Загрузка…</p>}</>;
  const due = x.plans.filter((p) => p.state !== 'later');
  const toVerify = x.records.filter((r) => r.verified_ok === null && r.done_by_id !== me.id);
  const done = (p: Plan) => run(async () => {
    const r = await api<{ result: string; next_due: string }>(`/orgs/${org.id}/sanitation/plans/${p.id}/done`, { body: { concentration: conc[p.id] ? num(conc[p.id]) : null } });
    setMsg(r.result === 'done' ? `«${p.area}» — отмечено. Следующий раз — ${ddmm(r.next_due)}.` : `«${p.area}»: концентрация вне режима ${p.range}. Приготовьте раствор заново и повторите — создано отклонение.`);
    setConc({ ...conc, [p.id]: '' }); load();
  });
  return (
    <>
      <h1>Санитария</h1>
      <SitePicker />
      <div className="tabs" role="tablist">
        {[['today', `Сегодня${due.length ? ` · ${due.length}` : ''}`], ['plan', 'План'], ['means', 'Дезсредства']].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {error && <div className="err" role="alert">{error}</div>}
      {msg && <div className="okbox" role="status">{msg}</div>}

      {tab === 'today' && <>
        <div className="card">
          <h2>Сделать · {due.length}</h2>
          {due.length === 0 && <p className="small muted">На сегодня всё выполнено.</p>}
          <ul className="list">{due.map((p) => (
            <li key={p.id}>
              <div className="between"><b>{p.area}</b><span className={`badge ${p.state === 'overdue' ? 'crit' : 'warn'}`}>{p.state === 'overdue' ? `просрочено с ${ddmm(p.next_due)}` : 'сегодня'}</span></div>
              <div className="small">{p.kind_label}: {p.work}</div>
              {p.disinfectant && <div className="small muted">{p.disinfectant}{p.range ? `, ${p.range}` : ''}{p.exposure ? `, экспозиция ${p.exposure}` : ''}</div>}
              <div className="row" style={{ marginTop: 6 }}>
                {p.check_concentration && <input aria-label={`Концентрация: ${p.area}`} inputMode="decimal" placeholder="концентрация, %" value={conc[p.id] || ''} onChange={(e) => setConc({ ...conc, [p.id]: e.target.value })} style={{ flex: 1 }} />}
                <button className="btn small" disabled={busy || (p.check_concentration && !conc[p.id])} onClick={() => done(p)}>Выполнено</button>
              </div>
            </li>))}</ul>
        </div>
        {can('sanitation.verify') && (
          <div className="card">
            <h2>Проверить · {toVerify.length}</h2>
            {toVerify.length === 0 && <p className="small muted">Нет записей для проверки.</p>}
            <ul className="list">{toVerify.map((r) => (
              <li key={r.id}>
                <div className="between"><b>{r.area}</b>{r.result === 'deviation' && <span className="badge crit">отклонение</span>}</div>
                <div className="small">{r.kind_label}: {r.work} · {r.done_by}, {dt(r.done_at, org.timezone)}{r.concentration !== null ? ` · ${n(r.concentration)} %` : ''}{r.note ? ` · ${r.note}` : ''}</div>
                {bad?.id === r.id ? (
                  <div className="row" style={{ marginTop: 6 }}>
                    <input aria-label="Замечание" value={bad.note} onChange={(e) => setBad({ ...bad, note: e.target.value })} placeholder="что не так" style={{ flex: 2 }} />
                    <button className="btn small danger" disabled={busy || bad.note.trim().length < 3} onClick={() => run(async () => { await api(`/orgs/${org.id}/sanitation/records/${r.id}/verify`, { body: { ok: false, note: bad.note } }); setBad(null); load(); })}>Не принято</button>
                  </div>
                ) : (
                  <div className="row" style={{ marginTop: 6 }}>
                    <button className="btn small" disabled={busy} onClick={() => run(async () => { await api(`/orgs/${org.id}/sanitation/records/${r.id}/verify`, { body: { ok: true } }); load(); })}>Принято</button>
                    <button className="btn small secondary" onClick={() => setBad({ id: r.id, note: '' })}>Замечание</button>
                  </div>
                )}
              </li>))}</ul>
          </div>
        )}
        <div className="card">
          <h2>За 7 дней · {x.records.length}</h2>
          <ul className="list">{x.records.map((r) => (
            <li key={r.id} className="small">
              <div className="between"><span><b>{r.area}</b> · {dt(r.done_at, org.timezone)} · {r.done_by}{r.concentration !== null ? ` · ${n(r.concentration)} %` : ''}</span>
                <span className={`badge ${r.result === 'deviation' || r.verified_ok === false ? 'crit' : r.verified_ok ? 'ok' : ''}`}>{r.result === 'deviation' ? 'отклонение' : r.verified_ok === null ? 'не проверено' : r.verified_ok ? `принято: ${r.verified_by}` : `не принято: ${r.verify_note}`}</span></div>
            </li>))}</ul>
        </div>
      </>}

      {tab === 'plan' && <>
        <div className="card">
          <h2>План · {x.plans.length}</h2>
          {x.plans.length === 0 && <p className="small muted">Пунктов плана нет.</p>}
          {x.plans.map((p) => (
            <div key={p.id} className="objrow">
              <div><b>{p.area}</b><div className="small">{p.kind_label}: {p.work}</div>
                <div className="small muted">раз в {p.period_days} дн. · {ROLES.find(([k]) => k === p.responsible_role)?.[1]}{p.disinfectant ? ` · ${p.disinfectant}${p.check_concentration ? ', замер концентрации' : ''}` : ''}</div></div>
              <span className={`badge ${p.state === 'overdue' ? 'crit' : p.state === 'today' ? 'warn' : ''}`}>{ddmm(p.next_due)}</span>
            </div>))}
        </div>
        {manage && (
          <div className="card">
            <h2>Добавить в план</h2>
            <form onSubmit={(e) => { e.preventDefault(); run(async () => {
              await api(`/orgs/${org.id}/sanitation/plans`, { body: { siteId, ...pf, disinfectantId: pf.disinfectantId || null, nextDue: pf.nextDue || null } });
              setPf({ ...pf, area: '', work: '' }); load();
            }); }}>
              <div className="grid2">
                <div><label htmlFor="pa">Зона / объект</label><input id="pa" value={pf.area} onChange={(e) => setPf({ ...pf, area: e.target.value })} placeholder="Горячий цех" /></div>
                <div><label htmlFor="pk">Вид</label><select id="pk" value={pf.kind} onChange={(e) => setPf({ ...pf, kind: e.target.value })}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
              </div>
              <label htmlFor="pw">Что делать</label><input id="pw" value={pf.work} onChange={(e) => setPf({ ...pf, work: e.target.value })} placeholder="влажная уборка полов, дезинфекция столов" />
              <div className="grid2">
                <div><label htmlFor="pp">Раз в, дней</label><input id="pp" inputMode="numeric" value={pf.periodDays} onChange={(e) => setPf({ ...pf, periodDays: e.target.value })} /></div>
                <div><label htmlFor="pr">Исполнитель</label><select id="pr" value={pf.responsibleRole} onChange={(e) => setPf({ ...pf, responsibleRole: e.target.value })}>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
                <div><label htmlFor="pd">Средство</label><select id="pd" value={pf.disinfectantId} onChange={(e) => setPf({ ...pf, disinfectantId: e.target.value })}>
                  <option value="">—</option>{x.disinfectants.filter((d) => d.status === 'approved').map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
                <div><label htmlFor="pn">Первый срок</label><input id="pn" type="date" value={pf.nextDue} onChange={(e) => setPf({ ...pf, nextDue: e.target.value })} /></div>
              </div>
              {pf.disinfectantId && <label className="row" style={{ fontWeight: 400, marginTop: 8 }}><input type="checkbox" style={{ width: 22, minHeight: 22 }} checked={pf.checkConcentration} onChange={(e) => setPf({ ...pf, checkConcentration: e.target.checked })} /> Замер концентрации раствора при выполнении</label>}
              <button className="btn block" disabled={busy || !siteId}>Добавить</button>
            </form>
          </div>
        )}
      </>}

      {tab === 'means' && <>
        <div className="card">
          <h2>Дезсредства · {x.disinfectants.length}</h2>
          {x.disinfectants.length === 0 && <p className="small muted">Средств нет. Режим (концентрация, экспозиция) вносится из инструкции производителя.</p>}
          <ul className="list">{x.disinfectants.map((d) => (
            <li key={d.id}>
              <div className="between"><b>{d.name}</b><span className={`badge ${d.status === 'approved' ? 'ok' : 'warn'}`}>{d.status === 'approved' ? 'утверждено' : 'черновик'}</span></div>
              <div className="small">{d.purpose}{d.range ? ` · ${d.range}` : ''}{d.exposure ? ` · ${d.exposure}` : ''}</div>
              <div className="small muted">Основание: {d.basis}{d.approved_by ? ` · утвердил(а) ${d.approved_by}` : ''}</div>
              {manage && d.status === 'draft' && <button className="btn small" disabled={busy} onClick={() => run(async () => { await api(`/orgs/${org.id}/disinfectants/${d.id}/approve`, { body: {} }); load(); })}>Утвердить режим</button>}
            </li>))}</ul>
        </div>
        {manage && (
          <div className="card">
            <h2>Добавить средство</h2>
            <form onSubmit={(e) => { e.preventDefault(); run(async () => {
              await api(`/orgs/${org.id}/disinfectants`, { body: { ...df, concentrationMin: df.concentrationMin ? num(df.concentrationMin) : null, concentrationMax: df.concentrationMax ? num(df.concentrationMax) : null, exposure: df.exposure || null } });
              setDf({ name: '', purpose: '', concentrationMin: '', concentrationMax: '', exposure: '', basis: '' }); load();
            }); }}>
              <div className="grid2">
                <div><label htmlFor="dn">Наименование</label><input id="dn" value={df.name} onChange={(e) => setDf({ ...df, name: e.target.value })} /></div>
                <div><label htmlFor="dp">Назначение</label><input id="dp" value={df.purpose} onChange={(e) => setDf({ ...df, purpose: e.target.value })} placeholder="поверхности, инвентарь" /></div>
                <div><label htmlFor="d1">Концентрация от, %</label><input id="d1" inputMode="decimal" value={df.concentrationMin} onChange={(e) => setDf({ ...df, concentrationMin: e.target.value })} /></div>
                <div><label htmlFor="d2">до, %</label><input id="d2" inputMode="decimal" value={df.concentrationMax} onChange={(e) => setDf({ ...df, concentrationMax: e.target.value })} /></div>
                <div><label htmlFor="de">Экспозиция</label><input id="de" value={df.exposure} onChange={(e) => setDf({ ...df, exposure: e.target.value })} placeholder="30 мин" /></div>
                <div><label htmlFor="db">Основание</label><input id="db" value={df.basis} onChange={(e) => setDf({ ...df, basis: e.target.value })} placeholder="инструкция производителя №, дата" /></div>
              </div>
              <button className="btn block" disabled={busy}>Добавить черновик</button>
            </form>
            <p className="small muted">Значения — только из инструкции производителя; система концентраций не подставляет. В план средство попадает после утверждения.</p>
          </div>
        )}
      </>}
    </>
  );
}

export default function Page() { return <Suspense><Sanitation /></Suspense>; }
