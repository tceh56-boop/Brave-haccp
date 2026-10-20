'use client';
import { useState } from 'react';
import Link from 'next/link';
import { AuthShell } from '@/components/AuthShell';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';

export default function Page() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useSubmit();
  return (
    <AuthShell title="Восстановление пароля">
      {sent ? (
        <><p>Если такой адрес зарегистрирован, на него придёт письмо со ссылкой. Ссылка действует 1 час.</p><Link className="btn block" href="/login">Ко входу</Link></>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api('/auth/password/forgot', { body: { email } }); setSent(true); }); }}>
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          {error && <div className="err" role="alert">{error}</div>}
          <button className="btn block" disabled={busy}>Отправить ссылку</button>
        </form>
      )}
    </AuthShell>
  );
}
