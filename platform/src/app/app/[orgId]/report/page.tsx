'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { SitePicker } from '@/components/OrgNav';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';

function Report() {
  const { org, siteId } = useOrg();
  const sp = useSearchParams();
  const router = useRouter();
  const [what, setWhat] = useState('');
  const { busy, error, run } = useSubmit();
  const entityType = sp.get('entityType') || undefined, entityId = sp.get('entityId') || undefined;
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/shift`}>← Смена</Link></p>
      <h1>Сообщить о проблеме</h1>
      <SitePicker />
      <div className="card">
        <form onSubmit={(e) => { e.preventDefault(); run(async () => {
          const r = await api<{ id: string }>(`/orgs/${org.id}/incidents`, { body: { siteId, what, entityType: entityType || undefined, entityId: entityId || undefined } });
          router.replace(`/app/${org.id}/incidents/${r.id}`);
        }); }}>
          <label htmlFor="w">Что случилось</label>
          <textarea id="w" rows={5} required value={what} onChange={(e) => setWhat(e.target.value)} placeholder="Где, что видите, что уже сделали" />
          <p className="small muted">Ответственный получит уведомление. Опишите факт — оценку и решение принимает ответственный.</p>
          {error && <div className="err">{error}</div>}
          <button className="btn block" disabled={busy || !siteId}>Отправить</button>
        </form>
      </div>
    </>
  );
}

export default function Page() { return <Suspense><Report /></Suspense>; }
