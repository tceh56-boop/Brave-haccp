'use client';
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { dt } from '@/lib/fmt';

/** Карточка сотрудника: медицинский допуск (даты — праву «медицинский допуск» и самому сотруднику), осмотры, инструктажи с подтверждением. */

interface Card {
  user_id: string; full_name: string; role_label: string; position: string | null; food: boolean; self: boolean;
  medical: { status: string; label: string; restrictions: string | null; exam_on?: string | null; exam_due?: string | null; hygiene_on?: string | null; hygiene_due?: string | null; med_book_no?: string | null };
  today_check: { admitted: boolean; signs: string | null; action: string | null; checked_by: string } | null;
  briefings: { topic_id: string; title: string; category_label: string; held_on: string | null; next_due: string | null; state: string }[];
  history: { id: string; title: string; category_label: string; type_label: string; held_on: string; result: string; note: string | null; next_due: string | null; instructor: string; acknowledged_at: string | null }[];
  checks: { checked_on: string; admitted: boolean; signs: string | null; action: string | null; checked_by: string }[];
}
const ddmm = (s: string | null | undefined) => (s ? s.slice(0, 10).split('-').reverse().join('.') : '—');
const MED_TONE: Record<string, string> = { ok: 'ok', soon: 'warn', expired: 'crit', missing: 'crit' };
const STATE: Record<string, [string, string]> = { ok: ['пройден', 'ok'], unconfirmed: ['не подтверждён сотрудником', 'warn'], overdue: ['просрочен', 'crit'], missing: ['не проведён', 'crit'] };

export default function StaffCard({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  const { org, can } = useOrg();
  const [c, setC] = useState<Card | null>(null);
  const [mf, setMf] = useState<{ medBookNo: string; examOn: string; examDue: string; hygieneOn: string; hygieneDue: string; restrictions: string } | null>(null);
  const { busy, error, run, setError } = useSubmit();
  const load = useCallback(() => api<Card>(`/orgs/${org.id}/staff/${userId}`).then(setC).catch((e) => setError(e.message)), [org.id, userId, setError]);
  useEffect(() => { load(); }, [load]);
  if (!c) return error ? <div className="err">{error}</div> : <p className="muted">Загрузка…</p>;
  const md = c.medical;
  return (
    <>
      {can('staff.read') && <p className="small"><Link href={`/app/${org.id}/staff`}>← Персонал</Link></p>}
      <div className="between"><h1 style={{ margin: 0 }}>{c.self ? 'Мой допуск и инструктажи' : c.full_name}</h1>
        <span className={`badge ${c.today_check && !c.today_check.admitted ? 'crit' : MED_TONE[md.status]}`}>{c.today_check && !c.today_check.admitted ? 'не допущен сегодня' : `ЛМК: ${md.label}`}</span></div>
      <p className="muted">{c.self ? c.full_name : ''}{c.self ? ' · ' : ''}{c.position || c.role_label}</p>

      <div className="card">
        <h2>Медицинский допуск</h2>
        <div className="kv">
          {md.med_book_no !== undefined && <><span>ЛМК №</span><b>{md.med_book_no || '—'}</b></>}
          {md.exam_due !== undefined && <><span>Медосмотр</span><b>{md.exam_on ? `${ddmm(md.exam_on)} → ` : ''}до {ddmm(md.exam_due)}</b></>}
          {md.hygiene_due !== undefined && <><span>Гигиеническая аттестация</span><b>{md.hygiene_on ? `${ddmm(md.hygiene_on)} → ` : ''}до {ddmm(md.hygiene_due)}</b></>}
          {md.restrictions && <><span>Ограничения</span><b>{md.restrictions}</b></>}
          <span>Статус</span><b>{md.label}</b>
        </div>
        {can('staff.medical') && !mf && <button className="btn secondary small" style={{ marginTop: 10 }} onClick={() => setMf({ medBookNo: md.med_book_no || '', examOn: '', examDue: '', hygieneOn: '', hygieneDue: '', restrictions: '' })}>Внести по ЛМК</button>}
        {mf && (
          <form onSubmit={(e) => { e.preventDefault(); run(async () => {
            await api(`/orgs/${org.id}/staff/${c.user_id}/medical`, { body: { medBookNo: mf.medBookNo || null, examOn: mf.examOn || null, examDue: mf.examDue, hygieneOn: mf.hygieneOn || null, hygieneDue: mf.hygieneDue, restrictions: mf.restrictions || null } });
            setMf(null); load();
          }); }}>
            <label htmlFor="mb">Номер ЛМК</label><input id="mb" value={mf.medBookNo} onChange={(e) => setMf({ ...mf, medBookNo: e.target.value })} />
            <div className="grid2">
              <div><label htmlFor="m1">Медосмотр пройден</label><input id="m1" type="date" value={mf.examOn} onChange={(e) => setMf({ ...mf, examOn: e.target.value })} /></div>
              <div><label htmlFor="m2">Медосмотр действует до</label><input id="m2" type="date" required value={mf.examDue} onChange={(e) => setMf({ ...mf, examDue: e.target.value })} /></div>
              <div><label htmlFor="m3">Аттестация пройдена</label><input id="m3" type="date" value={mf.hygieneOn} onChange={(e) => setMf({ ...mf, hygieneOn: e.target.value })} /></div>
              <div><label htmlFor="m4">Аттестация действует до</label><input id="m4" type="date" required value={mf.hygieneDue} onChange={(e) => setMf({ ...mf, hygieneDue: e.target.value })} /></div>
            </div>
            <label htmlFor="m5">Ограничения (если есть в заключении)</label><input id="m5" value={mf.restrictions} onChange={(e) => setMf({ ...mf, restrictions: e.target.value })} />
            <p className="small muted">Сроки — как записаны в ЛМК. Диагнозы и результаты исследований в системе не хранятся.</p>
            <div className="row"><button className="btn small" disabled={busy}>Сохранить</button><button type="button" className="btn small secondary" onClick={() => setMf(null)}>Отмена</button></div>
          </form>
        )}
      </div>

      {c.today_check && (
        <div className={c.today_check.admitted ? 'okbox' : 'err'}>Осмотр сегодня: {c.today_check.admitted ? 'допущен' : `не допущен — ${c.today_check.signs}; ${c.today_check.action}`} ({c.today_check.checked_by})</div>
      )}

      <div className="card">
        <h2>Инструктажи по должности · {c.briefings.length}</h2>
        {c.briefings.length === 0 && <p className="small muted">Обязательных тем нет.</p>}
        <ul className="list">{c.briefings.map((b) => (
          <li key={b.topic_id}>
            <div className="between"><b>{b.title}</b><span className={`badge ${STATE[b.state][1]}`}>{STATE[b.state][0]}</span></div>
            <div className="small muted">{b.category_label}{b.held_on ? ` · ${ddmm(b.held_on)}` : ''}{b.next_due ? ` · следующий до ${ddmm(b.next_due)}` : ''}</div>
          </li>))}</ul>
      </div>

      <div className="card">
        <h2>История инструктажей · {c.history.length}</h2>
        <ul className="list">{c.history.map((h) => (
          <li key={h.id}>
            <div className="between"><b>{h.title}</b><span className={`badge ${h.result === 'passed' ? 'ok' : 'crit'}`}>{h.result === 'passed' ? 'сдал' : 'не сдал'}</span></div>
            <div className="small muted">{h.category_label} · {h.type_label} · {ddmm(h.held_on)} · {h.instructor}{h.note ? ` · ${h.note}` : ''}</div>
            <div className="small">{h.acknowledged_at ? `ознакомлен(а) ${dt(h.acknowledged_at, org.timezone)}` : c.self
              ? <button className="btn small" disabled={busy} onClick={() => run(async () => { await api(`/orgs/${org.id}/staff/briefings/${h.id}/ack`, { body: {} }); load(); })}>Подтверждаю: инструктаж прошёл(а), с материалом ознакомлен(а)</button>
              : 'ознакомление не подтверждено'}</div>
          </li>))}</ul>
      </div>

      {c.checks.length > 0 && (
        <div className="card">
          <h2>Осмотры перед сменой</h2>
          <ul className="list">{c.checks.map((h) => <li key={h.checked_on} className="small">{ddmm(h.checked_on)} — {h.admitted ? 'допущен' : `не допущен: ${h.signs}; ${h.action}`} · {h.checked_by}</li>)}</ul>
        </div>
      )}
      {error && <div className="err" role="alert">{error}</div>}
    </>
  );
}
