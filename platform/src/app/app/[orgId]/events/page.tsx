'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useOrg } from '@/lib/org';
import { SitePicker } from '@/components/OrgNav';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { n } from '@/lib/fmt';

/** План-меню: ближайшие и прошедшие мероприятия площадки, новое мероприятие. */

interface Ev { id: string; number: number; title: string; event_date: string; event_time: string | null; guests: number; format: string | null; status: string; status_label: string; items: number; portions: string | null }
const TONE: Record<string, string> = { planned: '', confirmed: 'warn', done: 'ok', cancelled: '' };
const ddmm = (s: string) => s.slice(0, 10).split('-').reverse().join('.');

export default function Events() {
  const { org, siteId, can } = useOrg();
  const router = useRouter();
  const [period, setPeriod] = useState('upcoming');
  const [list, setList] = useState<Ev[] | null>(null);
  const [f, setF] = useState({ title: '', eventDate: '', eventTime: '', guests: '', format: '', contact: '' });
  const { busy, error, run, setError } = useSubmit();
  useEffect(() => {
    if (!siteId) return;
    let stale = false;                                       // ответ по прежней вкладке не перезаписывает текущую
    setList(null);
    api<Ev[]>(`/orgs/${org.id}/events?siteId=${siteId}&period=${period}`).then((l) => { if (!stale) setList(l); }).catch((e) => { if (!stale) setError(e.message); });
    return () => { stale = true; };
  }, [org.id, siteId, period, setError]);
  return (
    <>
      <h1>План-меню</h1>
      <p className="small muted">Банкеты и мероприятия: меню и порции → потребность в сырье и п/ф по ТТК → заказ на нехватку → «Проведено» со списанием по ТТК.</p>
      <SitePicker />
      <div className="tabs" role="tablist">
        {[['upcoming', 'Ближайшие'], ['past', 'Проведённые и отменённые']].map(([k, l]) => <button key={k} role="tab" aria-selected={period === k} onClick={() => setPeriod(k)}>{l}</button>)}
      </div>
      {error && <div className="err">{error}</div>}
      {list && list.length === 0 && <div className="card"><p className="muted">{period === 'past' ? 'Проведённых мероприятий пока нет.' : 'Ближайших мероприятий нет.'}</p></div>}
      {list && list.length > 0 && (
        <div className="card">
          {list.map((e) => (
            <Link key={e.id} href={`/app/${org.id}/events/${e.id}`} className="objrow">
              <div><b>{ddmm(e.event_date)}{e.event_time ? ` ${e.event_time}` : ''} · {e.title}</b>
                <div className="small muted">№ {e.number} · {e.guests} гостей{e.format ? ` · ${e.format}` : ''} · {e.items ? `${e.items} блюд, ${n(e.portions)} порц.` : 'меню не составлено'}</div></div>
              <span className={`badge ${TONE[e.status]}`}>{e.status_label}</span>
            </Link>))}
        </div>
      )}
      {can('event.manage') && (
        <div className="card">
          <h2>Новое мероприятие</h2>
          <form onSubmit={(e) => { e.preventDefault(); run(async () => {
            const ev = await api<{ id: string }>(`/orgs/${org.id}/events`, { body: { siteId, ...f, eventTime: f.eventTime || null, format: f.format || null, contact: f.contact || null } });
            router.push(`/app/${org.id}/events/${ev.id}`);
          }); }}>
            <label htmlFor="et">Название</label><input id="et" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Юбилей, свадьба, корпоратив" />
            <div className="grid2">
              <div><label htmlFor="ed">Дата</label><input id="ed" type="date" required value={f.eventDate} onChange={(e) => setF({ ...f, eventDate: e.target.value })} /></div>
              <div><label htmlFor="eh">Время</label><input id="eh" type="time" value={f.eventTime} onChange={(e) => setF({ ...f, eventTime: e.target.value })} /></div>
              <div><label htmlFor="eg">Гостей</label><input id="eg" required inputMode="numeric" value={f.guests} onChange={(e) => setF({ ...f, guests: e.target.value })} /></div>
              <div><label htmlFor="ef">Формат</label><input id="ef" value={f.format} onChange={(e) => setF({ ...f, format: e.target.value })} placeholder="банкет, фуршет" /></div>
            </div>
            <label htmlFor="ec">Контакт заказчика</label><input id="ec" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} placeholder="имя, телефон" />
            <button className="btn block" disabled={busy || !siteId}>Создать мероприятие</button>
          </form>
        </div>
      )}
    </>
  );
}
