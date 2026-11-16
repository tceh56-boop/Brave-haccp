'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AuthShell } from '@/components/AuthShell';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';

interface Me { user: { email: string; full_name: string; email_verified: boolean } | null }

function Invite() {
  const token = useSearchParams().get('token') || '';
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const { busy, error, run } = useSubmit();
  useEffect(() => { api<Me>('/auth/me').then(setMe).catch(() => setMe({ user: null })); }, []);
  const back = `/invite?token=${encodeURIComponent(token)}`;
  return (
    <AuthShell title="Приглашение">
      {!me && <p>Загрузка…</p>}
      {me && !me.user && (
        <>
          <p>Чтобы принять приглашение, войдите или зарегистрируйтесь <b>на тот email, на который пришло письмо</b>.</p>
          <Link className="btn block" href={`/login?next=${encodeURIComponent(back)}`}>Войти</Link>
          <Link className="btn block secondary" href="/register">Зарегистрироваться</Link>
        </>
      )}
      {me?.user && (
        <>
          <p>Вы вошли как <b>{me.user.email}</b>.</p>
          {error && <div className="err" role="alert">{error}</div>}
          <button className="btn block" disabled={busy} onClick={() => run(async () => {
            const r = await api<{ organizationId: string }>('/invitations/accept', { body: { token } });
            router.replace(`/app/${r.organizationId}`);
          })}>Принять приглашение</button>
        </>
      )}
    </AuthShell>
  );
}

export default function Page() { return <Suspense><Invite /></Suspense>; }
