'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Logo } from './Logo';
import { api } from '@/lib/api';

export interface Me { id: string; email: string; full_name: string; email_verified: boolean }

/** Верхняя панель и проверка сессии: без входа — на страницу входа с возвратом. */
export function AppShell({ children }: { children: (me: Me) => React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    api<{ user: Me | null }>('/auth/me').then((r) => {
      if (!r.user) router.replace(`/login?next=${encodeURIComponent(location.pathname)}`);
      else setMe(r.user);
    }).catch(() => setMe(null));
  }, [router]);
  return (
    <>
      <header className="topbar">
        <div className="wrap">
          <Link href="/app" className="logo" aria-label="ЦЕХ — мои предприятия"><Logo height={30} eyes="#3b2a1e" /></Link>
          {me && (
            <div className="row">
              <span className="small" style={{ opacity: .85 }}>{me.full_name}</span>
              <button className="btn secondary small" onClick={async () => { await api('/auth/logout', { body: {} }); router.replace('/login'); }}>Выйти</button>
            </div>
          )}
        </div>
      </header>
      <main className="wrap">
        {me === undefined && <p className="muted">Загрузка…</p>}
        {me === null && <div className="err">Нет связи с сервером. Обновите страницу.</div>}
        {me && children(me)}
      </main>
    </>
  );
}
