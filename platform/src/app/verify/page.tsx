'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AuthShell } from '@/components/AuthShell';
import { api } from '@/lib/api';

function Verify() {
  const token = useSearchParams().get('token');
  const [state, setState] = useState<'wait' | 'ok' | 'err'>('wait');
  const [msg, setMsg] = useState('');
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return; once.current = true;
    api('/auth/verify', { body: { token } }).then(() => setState('ok')).catch((e) => { setMsg(e.message); setState('err'); });
  }, [token]);
  return (
    <AuthShell title="Подтверждение email">
      {state === 'wait' && <p>Проверяем ссылку…</p>}
      {state === 'ok' && <><div className="okbox">Email подтверждён.</div><Link className="btn block" href="/app">Продолжить</Link></>}
      {state === 'err' && <><div className="err" role="alert">{msg}</div><Link className="btn block secondary" href="/app">Запросить новую ссылку</Link></>}
    </AuthShell>
  );
}

export default function Page() { return <Suspense><Verify /></Suspense>; }
