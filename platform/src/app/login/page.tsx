'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AuthShell } from '@/components/AuthShell';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get('next') || '/app';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useSubmit();
  return (
    <AuthShell title="Вход">
      <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api('/auth/login', { body: { email, password } }); router.replace(next.startsWith('/') ? next : '/app'); }); }}>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="password">Пароль</label>
        <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div className="err" role="alert">{error}</div>}
        <button className="btn block" disabled={busy}>{busy ? 'Входим…' : 'Войти'}</button>
      </form>
      <p className="between small" style={{ marginTop: 16 }}>
        <Link href="/register">Регистрация</Link>
        <Link href="/forgot">Забыли пароль?</Link>
      </p>
    </AuthShell>
  );
}

export default function Page() { return <Suspense><LoginForm /></Suspense>; }
