'use client';
import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { SitePicker } from '@/components/OrgNav';
import { api } from '@/lib/api';
import { n, ago } from '@/lib/fmt';
import { ShiftCards } from '@/components/ShiftCards';
import { PinCard } from '@/components/PinCard';
import { TelegramCard } from '@/components/TelegramCard';

interface Obj { id: string; name: string; kind_label: string; criterion: string | null; last: { value: string; unit: string; measured_at: string; result: string } | null; due: { state: string } }
interface Status {
  pos_shift?: { opened_at: string; opened_by: string } | null; staff?: { checked: number; admitted: number; not_admitted: number };
  fridges: { scheduled: number; checked_today: number; overdue: number }; lots: { quarantine: number; expired: number; soon: number };
  capa?: { active: number; overdue: number }; samples?: { today: number }; semis?: { lots: number; qty: number };
  receipts_draft?: number; sales_unfulfilled?: number; finance?: { sales: number; amount: number };
}
interface Shift { site: { name: string }; objects: Obj[]; myTasks: number; openIncidents: number; production: number; status?: Status; journals_due?: { code: string; text: string }[] }

const DUE: Record<string, [string, string]> = { ok: ['в норме по графику', 'ok'], due: ['пора замерить', 'warn'], missed: ['пропущен замер', 'crit'], no_schedule: ['', ''] };

/** Главный экран сотрудника (ТЗ v2 §1, §3): только задачи смены, приёмка, замеры, сроки и «сообщить о проблеме». */
export default function ShiftPage() {
  const { org, siteId, can } = useOrg();
  const [s, setS] = useState<Shift | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { if (siteId) api<Shift>(`/orgs/${org.id}/sites/${siteId}/shift`).then(setS).catch((e) => setErr(e.message)); }, [org.id, siteId]);
  useEffect(() => { load(); }, [load]);
  if (!siteId) return <p className="muted">Нет доступных площадок.</p>;
  if (err) return <div className="err">{err}</div>;
  const base = `/app/${org.id}`;
  const missed = s?.objects.filter((o) => o.due.state === 'missed' || o.due.state === 'due').length || 0;
  return (
    <>
      <SitePicker />
      <h1>{s?.site.name || 'Смена'}</h1>
      <ShiftCards orgId={org.id} siteId={siteId} tz={org.timezone} onChange={load} />
      <div className="tiles">
        {can('receipt.record') && <Link className="tile primary" href={`${base}/receipts/new`}>Приёмка<span className="sub">товар, партия, проверки</span></Link>}
        <a className={`tile ${missed ? 'alert' : ''}`} href="#temps">Температура<span className="sub">{missed ? `ждут замера: ${missed}` : 'по графику'}</span></a>
        <Link className="tile" href={`${base}/lots`}>Сроки<span className="sub">годность партий</span></Link>
        <Link className="tile" href={`${base}/tasks`}>Задачи<span className="sub">{s ? `открыто: ${s.myTasks}` : '…'}</span></Link>
        <Link className={`tile ${s?.openIncidents ? 'alert' : ''}`} href={`${base}/problems`}>Проблемы<span className="sub">{s ? (s.openIncidents ? `открыто: ${s.openIncidents}` : 'нет открытых') : '…'}</span></Link>
        <Link className="tile" href={`${base}/report`}>Сообщить<span className="sub">о проблеме</span></Link>
        {can('journal.record') && <Link className="tile" href={`${base}/journals`}>Журналы<span className="sub">ручные записи</span></Link>}
        {can('production.read') && <Link className="tile" href={`${base}/production`}>Производство<span className="sub">{s ? (s.production ? `заданий: ${s.production}` : 'нет заданий') : '…'}</span></Link>}
      </div>
      {s?.status && <ShiftStatus s={s} base={base} can={can} />}
      <div className="card" id="temps">
        <h2>Температура</h2>
        {!s ? <p className="muted">Загрузка…</p> : s.objects.length === 0 ? <p className="muted">Объекты контроля ещё не заведены. Их добавляет ответственный в разделе «Управление».</p> : (
          <div>
            {s.objects.map((o) => (
              <Link key={o.id} className="objrow" href={`${base}/objects/${o.id}`}>
                <div>
                  <b>{o.name}</b>
                  <div className="small muted">{o.criterion ? `предел ${o.criterion}` : 'критерий не утверждён'}</div>
                  {o.last && <div className="small">последний: {n(o.last.value)} {o.last.unit}, {ago(o.last.measured_at)}</div>}
                </div>
                <div className="row">
                  {o.last?.result === 'deviation' && <span className="badge crit">вне предела</span>}
                  {DUE[o.due.state]?.[0] && <span className={`badge ${DUE[o.due.state][1]}`}>{DUE[o.due.state][0]}</span>}
                  <span aria-hidden>›</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
      <PinCard orgId={org.id} />
      <TelegramCard orgId={org.id} />
    </>
  );
}

/** Состояние смены (ТЗ доработки, 10): что требует действия сейчас; каждая строка ведёт туда, где это исправляется. */
function ShiftStatus({ s, base, can }: { s: Shift; base: string; can: (p: string) => boolean }) {
  const st = s.status!;
  const rows: [string, string, string, boolean][] = [];   // подпись, значение, ссылка, требует действия
  if (st.pos_shift !== undefined) rows.push(['Смена кассы', st.pos_shift ? `открыта ${new Date(st.pos_shift.opened_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}, ${st.pos_shift.opened_by}` : 'закрыта', `${base}/pos`, false]);
  if (st.staff) rows.push(['Допуск персонала (осмотр)', st.staff.checked ? `осмотрено ${st.staff.checked}, допущено ${st.staff.admitted}${st.staff.not_admitted ? `, не допущено ${st.staff.not_admitted}` : ''}` : 'осмотров сегодня нет', `${base}/staff`, !st.staff.checked || st.staff.not_admitted > 0]);
  rows.push(['Холодильники и помещения', st.fridges.scheduled ? `проверено сегодня ${st.fridges.checked_today} из ${st.fridges.scheduled}${st.fridges.overdue ? `, пропущено ${st.fridges.overdue}` : ''}` : 'нет объектов с графиком замеров', '#temps', st.fridges.overdue > 0]);
  rows.push(['Партии', `карантин ${st.lots.quarantine} · истёк срок ${st.lots.expired} · срок < 24 ч ${st.lots.soon}`, `${base}/lots`, st.lots.quarantine + st.lots.expired > 0]);
  if (st.capa) rows.push(['Корректирующие действия (CAPA)', `активных ${st.capa.active}${st.capa.overdue ? `, просрочено ${st.capa.overdue}` : ''}`, `${base}/capa`, st.capa.overdue > 0]);
  if (st.samples) rows.push(['Суточные пробы сегодня', String(st.samples.today), `${base}/lab`, false]);
  if (st.semis) rows.push(['Готовые полуфабрикаты', st.semis.lots ? `партий ${st.semis.lots}, ${n(Math.round(st.semis.qty * 100) / 100)} ед.` : 'нет', `${base}/stock`, false]);
  if (st.receipts_draft !== undefined) rows.push(['Ожидают приёмки', st.receipts_draft ? `незавершённых приёмок ${st.receipts_draft}` : 'нет', `${base}/receipts/new`, st.receipts_draft > 0]);
  if (st.sales_unfulfilled !== undefined) rows.push(['Продажи без списания', String(st.sales_unfulfilled), `${base}/sales`, st.sales_unfulfilled > 0]);
  if (st.finance) rows.push(['Выручка за день', `${n(Math.round(st.finance.amount))} ₽, продаж ${st.finance.sales}`, `${base}/economics`, false]);
  const actions: [string, string, boolean][] = [
    ['Открыть / закрыть смену', `${base}/pos`, can('pos.sell')], ['Принять сырьё', `${base}/receipts/new`, can('receipt.record')], ['Внести температуру', '#temps', can('measure.record')],
    ['Выпустить полуфабрикат', `${base}/production`, can('production.read')], ['Вскрыть тару', `${base}/lots`, can('lot.open')], ['Напечатать этикетку', `${base}/labels`, can('label.print')],
    ['Провести бракераж', `${base}/production`, can('production.run')], ['Внести суточную пробу', `${base}/lab`, can('sample.record')], ['Оформить списание', `${base}/stock`, can('stock.write_off')],
  ];
  return (
    <div className="card">
      <h2>Состояние смены</h2>
      {(s.journals_due?.length || 0) > 0 && <div className="err small"><b>Не заполнены обязательные журналы:</b> {s.journals_due!.map((j) => <span key={j.code}><Link href={`${base}/journals/${j.code}`}>{j.code}</Link> — {j.text}; </span>)}</div>}
      <div className="kv">{rows.map(([t, v, href, bad]) => <Fragment key={t}><span>{t}</span><b style={{ fontWeight: bad ? 700 : 400, color: bad ? 'var(--crit)' : undefined }}><Link href={href}>{v}</Link></b></Fragment>)}</div>
      <h3>Быстрые действия</h3>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>{actions.filter((a) => a[2]).map(([t, href]) => <Link key={t} className="btn small secondary" href={href}>{t}</Link>)}</div>
    </div>
  );
}
