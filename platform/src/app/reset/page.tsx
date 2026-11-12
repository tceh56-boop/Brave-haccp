'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AuthShell } from '@/components/AuthShell';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';

function Reset() {
  const token = useSearchParams().get('token') || '';
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, run } = useSubmit();
  return (
    <AuthShell title="Новый пароль">
      {done ? (
        <><div className="okbox">Пароль изменён. Все открытые сеансы на других устройствах закрыты.</div><Link className="btn block" href="/login">Войти</Link></>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api('/auth/password/reset', { body: { token, password } }); setDone(true); }); }}>
          <label htmlFor="password">Новый пароль</label>
          <input id="password" type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="muted small">Не короче 10 символов, буквы и цифры.</p>
          {error && <div className="err" role="alert">{error}</div>}
          <button className="btn block" disabled={busy}>Сохранить пароль</button>
        </form>
      )}
    </AuthShell>
  );
}

export default function Page() { return <Suspense><Reset /></Suspense>; }
