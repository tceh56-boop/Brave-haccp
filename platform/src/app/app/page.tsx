'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppShell, type Me } from '@/components/AppShell';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';

interface OrgRow { id: string; name: string; status: string; role: string; role_label: string }

const STATUS: Record<string, string> = { DRAFT: 'Черновик', CONFIGURED: 'Настроено', COMPLIANCE_REVIEW: 'Нормативная проверка', ARCHIVED: 'Архив' };

function Orgs({ me }: { me: Me }) {
  const router = useRouter();
  const [orgs, setOrgs] = useState<OrgRow[] | null>(null);
  const [form, setForm] = useState({ name: '', legalForm: 'ООО', inn: '', region: '', firstSiteName: '' });
  const [resent, setResent] = useState(false);
  const { busy, error, run } = useSubmit();
  const load = useCallback(() => api<OrgRow[]>('/orgs').then(setOrgs), []);
  useEffect(() => { load(); }, [load]);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <>
      <h1>Мои предприятия</h1>
      {!me.email_verified && (
        <div className="note">
          Подтвердите email <b>{me.email}</b> — ссылка в письме после регистрации. Без подтверждения нельзя создать предприятие или принять приглашение.
          <div style={{ marginTop: 8 }}>
            {resent ? <span className="small">Письмо отправлено повторно.</span> :
              <button className="btn secondary small" onClick={async () => { await api('/auth/resend-verification', { body: {} }); setResent(true); }}>Отправить письмо ещё раз</button>}
          </div>
        </div>
      )}
      <div className="card">
        {orgs === null ? <p className="muted">Загрузка…</p> : orgs.length === 0 ? <p className="muted">Пока нет предприятий. Создайте своё или примите приглашение по ссылке из письма.</p> : (
          <ul className="list">
            {orgs.map((o) => (
              <li key={o.id} className="between">
                <div><Link href={`/app/${o.id}`}><b>{o.name}</b></Link><div className="small muted">{o.role_label}</div></div>
                <span className="badge">{STATUS[o.status] || o.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {me.email_verified && (
        <div className="card">
          <h2>Новое предприятие</h2>
          <p className="muted small">Вы станете владельцем. Паспорт предприятия (помещения, цеха, оборудование) заполняется следующим шагом; до проверки статус — «Черновик».</p>
          <form onSubmit={(e) => { e.preventDefault(); run(async () => {
            const r = await api<{ organization: { id: string } }>('/orgs', { body: { ...form, inn: form.inn || undefined, region: form.region || undefined, firstSiteName: form.firstSiteName || undefined } });
            router.push(`/app/${r.organization.id}`);
          }); }}>
            <label htmlFor="name">Название</label>
            <input id="name" required value={form.name} onChange={set('name')} placeholder="Кафе «Пример»" />
            <div className="grid2">
              <div><label htmlFor="lf">Форма</label>
                <select id="lf" value={form.legalForm} onChange={set('legalForm')}>{['ООО', 'ИП', 'АО', 'другое'].map((x) => <option key={x}>{x}</option>)}</select></div>
              <div><label htmlFor="inn">ИНН</label><input id="inn" inputMode="numeric" value={form.inn} onChange={set('inn')} placeholder="10 или 12 цифр" /></div>
              <div><label htmlFor="region">Регион</label><input id="region" value={form.region} onChange={set('region')} /></div>
              <div><label htmlFor="site">Первая площадка</label><input id="site" value={form.firstSiteName} onChange={set('firstSiteName')} placeholder="Основная площадка" /></div>
            </div>
            {error && <div className="err" role="alert">{error}</div>}
            <button className="btn block" disabled={busy}>Создать предприятие</button>
          </form>
        </div>
      )}
    </>
  );
}

export default function Page() { return <AppShell>{(me) => <Orgs me={me} />}</AppShell>; }
