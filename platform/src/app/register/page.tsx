'use client';
import { useState } from 'react';
import Link from 'next/link';
import { AuthShell } from '@/components/AuthShell';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';

export default function Page() {
  const [form, setForm] = useState({ fullName: '', email: '', password: '' });
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useSubmit();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  if (sent) {
    return (
      <AuthShell title="Проверьте почту">
        <p>Мы отправили письмо на <b>{form.email}</b>. Откройте ссылку в письме, чтобы подтвердить адрес — после этого можно создать предприятие.</p>
        <p className="muted small">Письмо не пришло за несколько минут — проверьте папку «Спам».</p>
        <Link className="btn block" href="/login">Перейти ко входу</Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Регистрация">
      <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api('/auth/register', { body: form }); setSent(true); }); }}>
        <label htmlFor="fullName">Имя и фамилия</label>
        <input id="fullName" autoComplete="name" required value={form.fullName} onChange={set('fullName')} />
        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="email" inputMode="email" required value={form.email} onChange={set('email')} />
        <label htmlFor="password">Пароль</label>
        <input id="password" type="password" autoComplete="new-password" required minLength={10} value={form.password} onChange={set('password')} />
        <p className="muted small">Не короче 10 символов, буквы и цифры.</p>
        <p className="muted small">Регистрируясь, вы соглашаетесь с политикой обработки персональных данных организации-оператора.</p>
        {error && <div className="err" role="alert">{error}</div>}
        <button className="btn block" disabled={busy}>{busy ? 'Отправляем…' : 'Зарегистрироваться'}</button>
      </form>
      <p className="small" style={{ marginTop: 16 }}>Уже есть учётная запись? <Link href="/login">Войти</Link></p>
    </AuthShell>
  );
}
