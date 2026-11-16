'use client';
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';

/** Переход по QR-коду этикетки: после входа — карточка партии (если у сотрудника есть к ней доступ). */
function Resolve({ code }: { code: string }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<{ orgId: string; lotId: string }>(`/labels/${encodeURIComponent(code)}`)
      .then((r) => router.replace(`/app/${r.orgId}/lots/${r.lotId}`)).catch((e) => setErr(e.message));
  }, [code, router]);
  return err ? <div className="err">Этикетка {code}: {err}</div> : <p className="muted">Открываю партию…</p>;
}

export default function LabelCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  return <AppShell>{() => <Resolve code={code} />}</AppShell>;
}
