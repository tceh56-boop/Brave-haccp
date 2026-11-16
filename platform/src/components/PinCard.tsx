'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/** «Мой PIN» для входа на кухонном планшете. Задаётся только после входа по паролю (в сессии по PIN карточки нет). */
export function PinCard({ orgId }: { orgId: string }) {
  const [state, setState] = useState<{ has_pin: boolean; locked: boolean } | null>(null);
  const [kiosk, setKiosk] = useState(true);
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    api<{ kiosk?: boolean }>('/auth/me').then((m) => setKiosk(!!m.kiosk)).catch(() => undefined);
    api<{ has_pin: boolean; locked: boolean }>(`/orgs/${orgId}/pin`).then(setState).catch(() => undefined);
  }, [orgId]);
  if (kiosk || !state) return null;
  return (
    <div className="card">
      <h2>Вход по PIN на кухонном планшете</h2>
      <p className="small muted">{state.has_pin ? 'PIN задан. Можно сменить: старые входы на планшете закроются.' : 'Задайте PIN из 4–6 цифр — на планшете цеха будете входить: выбрать себя → PIN.'}</p>
      <form className="row" onSubmit={async (e) => { e.preventDefault(); setMsg(null);
        try { await api(`/orgs/${orgId}/pin`, { method: 'PUT', body: { pin } }); setPin(''); setState({ has_pin: true, locked: false }); setMsg({ ok: true, text: 'PIN сохранён.' }); }
        catch (err) { setMsg({ ok: false, text: (err as Error).message }); } }}>
        <input aria-label="Новый PIN" type="password" inputMode="numeric" autoComplete="new-password" pattern="\d{4,6}" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} style={{ flex: 1, minHeight: 48, fontSize: 20 }} />
        <button className="btn" style={{ minHeight: 48 }} disabled={pin.length < 4}>{state.has_pin ? 'Сменить PIN' : 'Задать PIN'}</button>
      </form>
      {msg && <div className={msg.ok ? 'note' : 'err'}>{msg.text}</div>}
    </div>
  );
}
