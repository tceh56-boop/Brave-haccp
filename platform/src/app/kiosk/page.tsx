'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { api } from '@/lib/api';

/**
 * Кухонный планшет (перенос с Google Диска: выбрать себя → PIN → смена). Работает только на устройстве, которое владелец
 * привязал к площадке в настройках предприятия; список и проверка PIN — на сервере.
 */

interface Person { id: string; full_name: string; role_label: string; locked: boolean }
interface Roster { device: { name: string; organization: string; site: string } | null; people: Person[] }

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

export default function KioskPage() {
  const router = useRouter();
  const [r, setR] = useState<Roster | null>(null);
  const [who, setWho] = useState<Person | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<Roster>('/kiosk').then(setR).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const submit = async (value: string) => {
    if (!who || busy) return;
    setBusy(true); setError(null);
    try {
      const res = await api<{ orgId: string }>('/kiosk/login', { body: { userId: who.id, pin: value } });
      router.replace(`/app/${res.orgId}/shift`);
    } catch (e) { setError((e as Error).message); setPin(''); await load(); } finally { setBusy(false); }
  };
  const press = (k: string) => {
    if (k === '⌫') return setPin((p) => p.slice(0, -1));
    if (!k) return;
    setPin((p) => (p.length < 6 ? p + k : p));
  };

  return (
    <main className="narrow auth" style={{ maxWidth: 560 }}>
      <div className="brandblock"><div className="plate"><Logo height={64} eyes="#fff" /></div></div>
      {!r ? <p className="muted">Загрузка…</p> : !r.device ? (
        <div className="card">
          <h1>Кухонный планшет</h1>
          <p>Это устройство не привязано к предприятию, поэтому вход по PIN на нём закрыт.</p>
          <p className="small muted">Владелец входит по паролю на этом планшете и в настройках предприятия на вкладке «Планшеты» нажимает «Сделать это устройство кухонным планшетом».</p>
          <Link className="btn block" href="/login">Вход по паролю</Link>
        </div>
      ) : !who ? (
        <div className="card">
          <h1 style={{ marginBottom: 2 }}>Кто на смене?</h1>
          <p className="small muted" style={{ marginTop: 0 }}>{r.device.organization} · {r.device.site} · {r.device.name}</p>
          {error && <div className="err" role="alert">{error}</div>}
          {r.people.length === 0 ? <p>Пока никто не задал PIN. Сотрудник задаёт его сам после входа по паролю: «Смена» → «Вход по PIN на планшете».</p> : (
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
              {r.people.map((p) => (
                <button key={p.id} className="btn secondary" style={{ minHeight: 72, display: 'flex', flexDirection: 'column', justifyContent: 'center' }} disabled={p.locked}
                  onClick={() => { setWho(p); setPin(''); setError(null); }}>
                  <span style={{ fontSize: 17 }}>{p.full_name}</span>
                  <span className="small muted">{p.locked ? 'PIN заблокирован' : p.role_label}</span>
                </button>))}
            </div>)}
          <p className="small" style={{ marginTop: 16 }}><Link href="/login">Вход по паролю</Link></p>
        </div>
      ) : (
        <div className="card">
          <button className="btn secondary small" onClick={() => { setWho(null); setPin(''); setError(null); }}>← Другой сотрудник</button>
          <h1 style={{ margin: '12px 0 4px' }}>{who.full_name}</h1>
          <p className="small muted" style={{ marginTop: 0 }}>Введите PIN</p>
          <div aria-live="polite" style={{ display: 'flex', gap: 12, justifyContent: 'center', margin: '12px 0', fontSize: 28, letterSpacing: 4 }}>
            {Array.from({ length: Math.max(4, pin.length) }, (_, i) => <span key={i} aria-hidden>{i < pin.length ? '●' : '○'}</span>)}
          </div>
          {error && <div className="err" role="alert">{error}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {KEYS.map((k, i) => k ? (
              <button key={i} className="btn secondary" style={{ minHeight: 64, fontSize: 24 }} disabled={busy} aria-label={k === '⌫' ? 'Стереть' : k} onClick={() => press(k)}>{k}</button>
            ) : <span key={i} />)}
          </div>
          <button className="btn block" style={{ minHeight: 56, marginTop: 12 }} disabled={busy || pin.length < 4} onClick={() => submit(pin)}>{busy ? 'Проверяем…' : 'Войти'}</button>
        </div>
      )}
    </main>
  );
}
