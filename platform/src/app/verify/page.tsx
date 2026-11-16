'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AuthShell } from '@/components/AuthShell';
import { api } from '@/lib/api';

/** Подтверждение email. Если адрес регистрировали повторно — нужен пароль регистрации по этой ссылке. */
function Verify() {
  const token = useSearchParams().get('token');
  const [state, setState] = useState<'wait' | 'password' | 'ok' | 'err'>('wait');
  const [msg, setMsg] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const once = useRef(false);
  const confirm = (password?: string) => api('/auth/verify', { body: { token, password } }).then(() => setState('ok'));
  useEffect(() => {
    if (once.current) return; once.current = true;
    api<{ need_password: boolean }>('/auth/verify', { body: { token, info: true } })
      .then((r) => (r.need_password ? setState('password') : confirm()))
      .catch((e) => { setMsg(e.message); setState('err'); });
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <AuthShell title="Подтверждение email">
      {state === 'wait' && <p>Проверяем ссылку…</p>}
      {state === 'password' && <form onSubmit={(e) => { e.preventDefault(); setBusy(true); setMsg(''); confirm(pw).catch((x) => setMsg(x.message)).finally(() => setBusy(false)); }}>
        <p>На этот адрес регистрировались несколько раз. Чтобы подтвердить, введите пароль, который вы указали при регистрации, — после этого все другие входы будут закрыты.</p>
        <label htmlFor="pw">Пароль</label><input id="pw" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
        {msg && <div className="err" role="alert">{msg}</div>}
        <button className="btn block" disabled={busy || !pw}>Подтвердить</button>
        <p className="small muted">Если вы не регистрировались — просто закройте страницу.</p>
      </form>}
      {state === 'ok' && <><div className="okbox">Email подтверждён. Войдите заново.</div><Link className="btn block" href="/login">Войти</Link></>}
      {state === 'err' && <><div className="err" role="alert">{msg}</div><Link className="btn block secondary" href="/app">Запросить новую ссылку</Link></>}
    </AuthShell>
  );
}

export default function Page() { return <Suspense><Verify /></Suspense>; }
