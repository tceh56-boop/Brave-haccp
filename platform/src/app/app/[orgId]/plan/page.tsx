'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useOrg } from '@/lib/org';
import { SitePicker } from '@/components/OrgNav';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { dt } from '@/lib/fmt';

interface Row { id: string; name: string; width_mm: number; height_mm: number; revision: number; updated_at: string; approved_version: number | null; objects: number }

/** 2D-планы площадки (ТЗ 3.0 §15.2): список и создание. */
export default function Plans() {
  const { org, siteId, can } = useOrg();
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [f, setF] = useState({ name: '', width: '', height: '' });
  const { busy, error, run, setError } = useSubmit();
  const load = useCallback(() => { if (siteId) api<Row[]>(`/orgs/${org.id}/plans?siteId=${siteId}`).then(setRows).catch((e) => setError(e.message)); }, [org.id, siteId, setError]);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <h1>Планировка</h1>
      <SitePicker />
      <p className="small muted">2D-план — мастер-модель предприятия: помещения, стены, двери, оборудование с реальными габаритами в миллиметрах, зоны и маршруты потоков.
        Спецификация оборудования и проверки (наложения, зоны открывания дверей, пересечение потоков) строятся по плану автоматически.</p>
      {error && <div className="err">{error}</div>}
      {rows && rows.length === 0 && <p className="muted">Планов пока нет.</p>}
      {rows && rows.length > 0 && <div className="card"><ul className="list">{rows.map((r) => (
        <li key={r.id}><div className="between"><Link href={`/app/${org.id}/plan/${r.id}`}><b>{r.name}</b></Link>
          <span className={`badge ${r.approved_version ? 'ok' : 'warn'}`}>{r.approved_version ? `утверждена версия ${r.approved_version}` : 'черновик'}</span></div>
          <div className="small muted">{r.width_mm} × {r.height_mm} мм · объектов {r.objects} · изменён {dt(r.updated_at, org.timezone)}</div></li>))}</ul></div>}
      {can('plan.manage') && (
        <div className="card">
          <h2>Новый план</h2>
          <form onSubmit={(e) => { e.preventDefault(); run(async () => {
            const p = await api<{ id: string }>(`/orgs/${org.id}/plans`, { body: { siteId, name: f.name, width_mm: f.width, height_mm: f.height } });
            router.push(`/app/${org.id}/plan/${p.id}`);
          }); }}>
            <label htmlFor="pn">Название</label><input id="pn" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Горячий цех, вариант 1" />
            <div className="grid2">
              <div><label htmlFor="pw">Ширина листа, мм</label><input id="pw" inputMode="numeric" value={f.width} onChange={(e) => setF({ ...f, width: e.target.value })} placeholder="например, 6000" /></div>
              <div><label htmlFor="ph">Высота листа, мм</label><input id="ph" inputMode="numeric" value={f.height} onChange={(e) => setF({ ...f, height: e.target.value })} placeholder="например, 11000" /></div>
            </div>
            <p className="small muted">Лист — область черчения с запасом вокруг помещений. Помещения, стены и оборудование задаются в редакторе.</p>
            <button className="btn block" disabled={busy || !siteId}>Создать план</button>
          </form>
        </div>
      )}
    </>
  );
}
