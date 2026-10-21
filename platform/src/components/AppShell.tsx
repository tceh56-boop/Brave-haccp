'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Logo } from './Logo';
import { api } from '@/lib/api';

export interface Me { id: string; email: string; full_name: string; email_verified: boolean }

/**
 * Шапка как в прежнем ЦЕХ: ☰ (если есть меню разделов), логотип, справа имя и роль.
 * Нажатие на имя — выход из системы.
 */
export function TopBar({ me, roleLabel, onMenu, home = '/app' }: { me?: Me; roleLabel?: string; onMenu?: () => void; home?: string }) {
  const router = useRouter();
  return (
    <header className="topbar">
      {onMenu && <button className="hamburger" onClick={onMenu} aria-label="Меню разделов">☰</button>}
      <Link href={home} className="logo" aria-label="ЦЕХ — на главную"><Logo height={30} eyes="var(--brand)" /></Link>
      {me && (
        <button className="who" title="Выйти" onClick={async () => { await api('/auth/logout', { body: {} }); router.replace('/login'); }}>
          <span>{me.full_name}</span>
          <span className="role">{roleLabel ? `${roleLabel} · выйти` : 'выйти'}</span>
        </button>
      )}
    </header>
  );
}

/** Проверка сессии: без входа — на страницу входа с возвратом. bare — шапку рисует вызывающий (меню предприятия). */
export function AppShell({ children, bare = false }: { children: (me: Me) => React.ReactNode; bare?: boolean }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    api<{ user: Me | null }>('/auth/me').then((r) => {
      if (!r.user) router.replace(`/login?next=${encodeURIComponent(location.pathname)}`);
      else setMe(r.user);
    }).catch(() => setMe(null));
  }, [router]);
  const status = me === undefined ? <p className="muted">Загрузка…</p> : me === null ? <div className="err">Нет связи с сервером. Обновите страницу.</div> : null;
  if (bare && me) return <>{children(me)}</>;
  return (
    <>
      <TopBar me={me || undefined} />
      <main className="wrap">{status}{me && children(me)}</main>
    </>
  );
}
