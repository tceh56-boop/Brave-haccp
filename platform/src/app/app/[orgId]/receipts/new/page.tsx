'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { SitePicker } from '@/components/OrgNav';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';

export default function NewReceipt() {
  const { org, siteId, can } = useOrg();
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [f, setF] = useState({ supplierId: '', documentNo: '', documentDate: new Date().toISOString().slice(0, 10), newSupplier: '' });
  const { busy, error, run } = useSubmit();
  useEffect(() => { api<{ id: string; name: string }[]>(`/orgs/${org.id}/suppliers`).then(setSuppliers).catch(() => undefined); }, [org.id]);
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/shift`}>← Смена</Link></p>
      <h1>Приёмка</h1>
      <SitePicker />
      <div className="card">
        <form onSubmit={(e) => { e.preventDefault(); run(async () => {
          let supplierId = f.supplierId || null;
          if (!supplierId && f.newSupplier) supplierId = (await api<{ id: string }>(`/orgs/${org.id}/suppliers`, { body: { name: f.newSupplier } })).id;
          const r = await api<{ id: string }>(`/orgs/${org.id}/receipts`, { body: { siteId, supplierId, documentNo: f.documentNo || null, documentDate: f.documentDate || null } });
          router.replace(`/app/${org.id}/receipts/${r.id}`);
        }); }}>
          <label htmlFor="sup">Поставщик</label>
          <select id="sup" value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}>
            <option value="">— выберите —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {!f.supplierId && can('catalog.manage') && <><label htmlFor="ns">или новый поставщик</label><input id="ns" value={f.newSupplier} onChange={(e) => setF({ ...f, newSupplier: e.target.value })} placeholder="ООО «…»" /></>}
          <div className="grid2">
            <div><label htmlFor="dn">№ документа</label><input id="dn" value={f.documentNo} onChange={(e) => setF({ ...f, documentNo: e.target.value })} placeholder="УПД, ТТН" /></div>
            <div><label htmlFor="dd">Дата документа</label><input id="dd" type="date" value={f.documentDate} onChange={(e) => setF({ ...f, documentDate: e.target.value })} /></div>
          </div>
          {error && <div className="err">{error}</div>}
          <button className="btn block" disabled={busy || !siteId}>Начать приёмку</button>
        </form>
      </div>
    </>
  );
}
