'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';

interface Act { id: string; number: number; act_date: string; status: string; ttk_version: number }

/** Акты контрольной проработки блюда: список и новый акт (из ТТК — разрабатываемой или утверждённой версии). */
export default function ActsPage({ params }: { params: Promise<{ dishId: string }> }) {
  const { dishId } = use(params);
  const { org, can, sites, siteId, me } = useOrg();
  const [acts, setActs] = useState<Act[] | null>(null);
  const [name, setName] = useState('');
  const [members, setMembers] = useState([{ position: 'Заведующий производством (шеф-повар)', name: me.full_name || '' }, { position: 'Руководитель', name: '' }, { position: 'Бухгалтер-калькулятор', name: '' }]);
  const [site, setSite] = useState(siteId || '');
  const { busy, error, run } = useSubmit();
  useEffect(() => {
    api<Act[]>(`/orgs/${org.id}/dishes/${dishId}/acts`).then(setActs).catch(() => setActs([]));
    api<{ dish: { name: string } }>(`/orgs/${org.id}/dishes/${dishId}`).then((d) => setName(d.dish.name)).catch(() => undefined);
  }, [org.id, dishId]);
  const create = () => run(async () => {
    const a = await api<{ id: string }>(`/orgs/${org.id}/dishes/${dishId}/acts`, { body: { siteId: site || null, commission: members.filter((m) => m.name.trim()) } });
    location.assign(`/app/${org.id}/menu/${dishId}/acts/${a.id}`);
  });
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/menu/${dishId}`}>← {name || 'Блюдо'}</Link></p>
      <h1>Акты контрольной проработки</h1>
      <p className="small muted">Комиссия готовит блюдо по ТТК и взвешивает сырьё: брутто, нетто, после тепловой обработки, выход. Проценты отходов и потерь считаются по массам
        (П = (М1 − М2) / М1 × 100). Утверждённый акт — основание норм обработки сырья.</p>
      <div className="card">
        {!acts ? <p className="muted">Загрузка…</p> : acts.length === 0 ? <p className="muted">Актов пока нет.</p> : (
          <ul className="list">{acts.map((a) => (
            <li key={a.id}><Link className="between" href={`/app/${org.id}/menu/${dishId}/acts/${a.id}`}>
              <span><b>№ {a.number} от {a.act_date.split('-').reverse().join('.')}</b><span className="small muted"> · ТТК v{a.ttk_version}</span></span>
              <span className={`badge ${a.status === 'approved' ? 'ok' : 'warn'}`}>{a.status === 'approved' ? 'утверждён' : 'черновик'}</span>
            </Link></li>))}</ul>
        )}
      </div>
      {can('ttk.manage') && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); create(); }}>
          <h2>Новый акт</h2>
          <label htmlFor="as">Место проведения</label>
          <select id="as" value={site} onChange={(e) => setSite(e.target.value)}><option value="">—</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <h3>Комиссия</h3>
          {members.map((m, i) => (
            <div className="grid2" key={i}>
              <div><label htmlFor={`mp${i}`}>Должность</label><input id={`mp${i}`} value={m.position} onChange={(e) => setMembers(members.map((x, j) => (j === i ? { ...x, position: e.target.value } : x)))} /></div>
              <div><label htmlFor={`mn${i}`}>ФИО</label><input id={`mn${i}`} value={m.name} onChange={(e) => setMembers(members.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></div>
            </div>
          ))}
          <button type="button" className="btn small secondary" onClick={() => setMembers([...members, { position: '', name: '' }])}>+ член комиссии</button>
          {error && <div className="err" role="alert">{error}</div>}
          <button className="btn block" disabled={busy}>Составить акт по ТТК</button>
          <p className="small muted">Плановые массы подставятся из ТТК (на порцию блюда, для полуфабриката — на закладку); фактические впишете после взвешивания.</p>
        </form>
      )}
    </>
  );
}
