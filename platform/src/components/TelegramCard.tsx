'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

/** Привязка Telegram-бота «ЦЕХ ИИ»: код на 15 минут → отправить боту /start КОД. Карточка видна, только если бот подключён на сервере. */
interface St { configured: boolean; bot: string | null; linked: boolean; username: string | null }

export function TelegramCard({ orgId }: { orgId: string }) {
  const [st, setSt] = useState<St | null>(null);
  const [kiosk, setKiosk] = useState(true);
  const [code, setCode] = useState<{ code: string; minutes: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api<St>(`/orgs/${orgId}/telegram`).then(setSt).catch(() => undefined), [orgId]);
  useEffect(() => { load(); api<{ kiosk?: boolean }>('/auth/me').then((m) => setKiosk(!!m.kiosk)).catch(() => undefined); }, [load]);
  if (!st?.configured || kiosk) return null;
  const cmd = code ? `/start ${code.code}` : '';
  return (
    <div className="card">
      <h2>Telegram-бот «ЦЕХ ИИ»</h2>
      {st.linked ? <>
        <p className="small">Привязан{st.username ? ` к @${st.username}` : ''}. Бот присылает уведомления по вашей роли, показывает дела смены (/smena) и отвечает на вопросы по требованиям.</p>
        <button className="btn secondary block" onClick={async () => { await api(`/orgs/${orgId}/telegram`, { method: 'DELETE' }); setCode(null); await load(); }}>Отвязать</button>
      </> : <>
        <p className="small muted">Уведомления об отклонениях и задачах — в Telegram; там же сводка смены и вопросы помощнику. Бот действует с вашими правами и только в личном чате.</p>
        {code ? <>
          <p>Отправьте боту{st.bot ? <> <a href={`https://t.me/${st.bot}?start=${code.code}`} target="_blank" rel="noreferrer">@{st.bot}</a></> : ''} сообщение:</p>
          <p style={{ fontSize: 22, fontWeight: 700, letterSpacing: 1, userSelect: 'all' }}>{cmd}</p>
          <p className="small muted">Код действует {code.minutes} минут и срабатывает один раз.</p>
          <button className="btn secondary block" onClick={load}>Я отправил — проверить</button>
        </> : <button className="btn block" style={{ minHeight: 48 }} onClick={async () => { setErr(null); try { setCode(await api(`/orgs/${orgId}/telegram`, { body: {} })); } catch (e) { setErr((e as Error).message); } }}>Получить код</button>}
        {err && <div className="err">{err}</div>}
      </>}
    </div>
  );
}
