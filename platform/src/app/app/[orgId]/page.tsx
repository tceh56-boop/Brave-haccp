'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';

interface Org { id: string; name: string; legal_form: string | null; inn: string | null; phone: string | null; region: string | null; timezone: string; status: string;
  ogrn?: string | null; legal_address?: string | null; email?: string | null; head_position?: string | null; head_name?: string | null; head_basis?: string | null; activity_notice?: string | null; modules?: string[]; sales_consumption?: string }
interface Membership { role: string; role_label: string; site_ids: string[]; permissions: string[] }
interface Site { id: string; name: string; address: string | null; status: string }
interface Member { id: string; user_id: string; full_name: string; email: string; role: string; role_label: string; site_ids: string[]; position: string | null; status: string; blocked_reason: string | null; has_pin?: boolean }
interface Invitation { id: string; email: string; full_name: string | null; role: string; site_ids: string[]; state: string; expires_at: string }
interface AuditRow { id: string; created_at: string; action: string; entity_type: string | null; result: string; reason: string | null; actor: string | null; before: unknown; after: unknown }
interface RoleDef { code: string; label: string; summary: string }
interface ModuleDef { code: string; label: string; summary: string }

const ACTIONS: Record<string, string> = {
  'org.create': 'Создано предприятие', 'org.update': 'Изменены реквизиты', 'site.create': 'Добавлена площадка', 'site.update': 'Изменена площадка',
  'member.add': 'Сотрудник добавлен', 'member.invite': 'Отправлено приглашение', 'member.invite_revoke': 'Приглашение отозвано',
  'member.change': 'Изменены роль или площадки', 'member.block': 'Сотрудник заблокирован', 'member.unblock': 'Сотрудник разблокирован',
  'member.read': 'Просмотр сотрудников', 'member.invite.denied': 'Попытка приглашения', 'audit.read': 'Просмотр аудита',
  'org.read': 'Просмотр организации', 'site.manage': 'Изменение площадок', 'member.manage': 'Изменение сотрудников', 'site.read': 'Просмотр площадок',
};
const INV_STATE: Record<string, [string, string]> = { pending: ['ожидает', 'warn'], accepted: ['принято', 'ok'], revoked: ['отозвано', ''], expired: ['истекло', 'crit'] };

type Tab = 'sites' | 'members' | 'invites' | 'devices' | 'audit' | 'org' | 'modules';

function OrgPage({ orgId, meId }: { orgId: string; meId: string }) {
  const [org, setOrg] = useState<Org | null>(null);
  const [m, setM] = useState<Membership | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('sites');
  const [sites, setSites] = useState<Site[]>([]);
  const [roles, setRoles] = useState<RoleDef[]>([]);
  const [modules, setModules] = useState<ModuleDef[]>([]);

  const loadSites = useCallback(() => api<Site[]>(`/orgs/${orgId}/sites`).then(setSites), [orgId]);
  useEffect(() => {
    api<{ organization: Org; membership: Membership }>(`/orgs/${orgId}`).then((r) => { setOrg(r.organization); setM(r.membership); }).catch((e) => setErr(e.message));
    loadSites().catch(() => undefined);
    api<{ roles: RoleDef[]; modules: ModuleDef[] }>('/roles').then((r) => { setRoles(r.roles); setModules(r.modules || []); });
  }, [orgId, loadSites]);

  if (err) return <><div className="err">{err}</div><p><Link href="/app">← Мои предприятия</Link></p></>;
  if (!org || !m) return <p className="muted">Загрузка…</p>;
  const can = (p: string) => m.permissions.includes(p);
  const tabs: [Tab, string, boolean][] = [
    ['sites', 'Площадки', can('site.read')], ['members', 'Сотрудники', can('member.read')], ['invites', 'Приглашения', can('member.invite')], ['devices', 'Планшеты', can('device.manage')],
    ['audit', 'Аудит', can('audit.read')], ['org', 'Реквизиты', can('org.read')], ['modules', 'Модули', can('org.read')],
  ];
  return (
    <>
      <p className="small"><Link href="/app">← Мои предприятия</Link></p>
      <div className="between"><h1 style={{ margin: 0 }}>{org.name}</h1><span className="badge">{m.role_label}</span></div>
      {(can('control.manage') || can('catalog.manage')) && (
        <p className="small"><Link href={`/app/${orgId}/setup`}>Объекты контроля, правила, товары и поставщики →</Link></p>
      )}
      {can('reg.read') && <p className="small"><Link href={`/app/${orgId}/regulatory`}>Нормативный реестр и профиль предприятия →</Link></p>}
      {can('journal.read') && <p className="small"><Link href={`/app/${orgId}/journals`}>Журналы J01–J60: просмотр, печать, подпись →</Link></p>}
      {can('haccp.read') && <p className="small"><Link href={`/app/${orgId}/haccp`}>План ХАССП: опасности, ККТ, мониторинг →</Link></p>}
      {can('capa.read') && <p className="small"><Link href={`/app/${orgId}/capa`}>CAPA: корректирующие и предупреждающие действия →</Link></p>}
      {can('pack.export') && <p className="small"><Link href={`/app/${orgId}/pack`}>Пакет документов для проверки →</Link></p>}
      {can('menu.read') && <p className="small"><Link href={`/app/${orgId}/menu`}>Блюда и ТТК: состав, себестоимость, КБЖУ, архив карт →</Link></p>}
      {can('pos.sell') && <p className="small"><Link href={`/app/${orgId}/pos`}>Касса: смена, заказы, оплата →</Link></p>}
      {can('menu.read') && <p className="small"><Link href={`/app/${orgId}/stop-list`}>Стоп-лист →</Link></p>}
      {can('sales.manage') && <p className="small"><Link href={`/app/${orgId}/sales`}>Продажи: очередь списания, импорт внешней кассы →</Link></p>}
      {can('econ.read') && <p className="small"><Link href={`/app/${orgId}/economics`}>Экономика: выручка, себестоимость, маржа →</Link></p>}
      {can('ai.use') && <p className="small"><Link href={`/app/${orgId}/assistant`}>AI-помощник: вопрос по требованиям со ссылкой на источник →</Link></p>}
      {can('pilot.read') && <p className="small"><Link href={`/app/${orgId}/readiness`}>Готовность к пилоту: проверки, подтверждения, решение Go/No-Go →</Link></p>}
      <p className="small"><Link href={`/app/${orgId}/guide`}>Памятки по ролям →</Link> · <a href="/api/v1/me/data" download>Мои данные (152-ФЗ) — скачать</a></p>
      <div className="tabs" role="tablist">
        {tabs.filter((t) => t[2]).map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      {tab === 'sites' && <Sites orgId={orgId} sites={sites} reload={loadSites} canManage={can('site.manage')} />}
      {tab === 'members' && <Members orgId={orgId} meId={meId} sites={sites} roles={roles} canManage={can('member.manage')} />}
      {tab === 'invites' && <Invites orgId={orgId} sites={sites} roles={roles} />}
      {tab === 'devices' && <Devices orgId={orgId} sites={sites} />}
      {tab === 'audit' && <Audit orgId={orgId} />}
      {tab === 'org' && <OrgForm org={org} canEdit={can('org.update')} onSaved={setOrg} />}
      {tab === 'modules' && <OrgModules org={org} defs={modules} canEdit={can('org.update')} />}
    </>
  );
}

function Sites({ orgId, sites, reload, canManage }: { orgId: string; sites: Site[]; reload: () => Promise<unknown>; canManage: boolean }) {
  const [name, setName] = useState(''); const [address, setAddress] = useState('');
  const { busy, error, run } = useSubmit();
  return (
    <>
      <div className="card">
        <ul className="list">
          {sites.map((s) => (
            <li key={s.id} className="between">
              <div><b>{s.name}</b>{s.address && <div className="small muted">{s.address}</div>}</div>
              <div className="row">
                <span className={`badge ${s.status === 'active' ? 'ok' : ''}`}>{s.status === 'active' ? 'работает' : 'в архиве'}</span>
                {canManage && <button className="btn secondary small" onClick={() => run(async () => { await api(`/orgs/${orgId}/sites/${s.id}`, { method: 'PATCH', body: { status: s.status === 'active' ? 'archived' : 'active' } }); await reload(); })}>
                  {s.status === 'active' ? 'В архив' : 'Вернуть'}</button>}
              </div>
            </li>
          ))}
        </ul>
      </div>
      {canManage && (
        <div className="card">
          <h2>Новая площадка</h2>
          <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/orgs/${orgId}/sites`, { body: { name, address: address || undefined } }); setName(''); setAddress(''); await reload(); }); }}>
            <label htmlFor="sn">Название</label><input id="sn" required value={name} onChange={(e) => setName(e.target.value)} />
            <label htmlFor="sa">Адрес</label><input id="sa" value={address} onChange={(e) => setAddress(e.target.value)} />
            {error && <div className="err">{error}</div>}
            <button className="btn block" disabled={busy}>Добавить площадку</button>
          </form>
        </div>
      )}
    </>
  );
}

function siteNames(ids: string[], sites: Site[]) {
  return ids.length ? ids.map((id) => sites.find((s) => s.id === id)?.name || '—').join(', ') : 'все площадки';
}

function SitePicker({ sites, value, onChange }: { sites: Site[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div>
      <label>Площадки</label>
      <div className="row">
        {sites.filter((s) => s.status === 'active').map((s) => (
          <label key={s.id} className="row" style={{ fontWeight: 400, margin: 0 }}>
            <input type="checkbox" style={{ width: 22, minHeight: 22 }} checked={value.includes(s.id)}
              onChange={(e) => onChange(e.target.checked ? [...value, s.id] : value.filter((x) => x !== s.id))} />{s.name}
          </label>
        ))}
      </div>
      <p className="small muted">Ничего не отмечено — доступ ко всем площадкам.</p>
    </div>
  );
}

interface Device { id: string; name: string; site: string; created_at: string; last_seen_at: string | null; revoked_at: string | null; created_by_name: string }

/** Кухонные планшеты: вход сотрудников по PIN работает только на привязанных устройствах. */
function Devices({ orgId, sites }: { orgId: string; sites: Site[] }) {
  const [list, setList] = useState<Device[] | null>(null);
  const [f, setF] = useState({ siteId: '', name: '' });
  const [done, setDone] = useState(false);
  const { busy, error, run } = useSubmit();
  const load = useCallback(() => api<Device[]>(`/orgs/${orgId}/devices`).then(setList), [orgId]);
  useEffect(() => { load(); }, [load]);
  const fmt = (s: string | null) => (s ? new Date(s).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  return (
    <div className="card">
      <p className="small muted">На планшете сотрудник выбирает себя из списка и вводит PIN — как в версии на Google Диске. PIN принимается только на привязанном здесь устройстве; сессия — 12 часов и только в этом предприятии. Отвязка сразу закрывает все сессии планшета.</p>
      <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/orgs/${orgId}/devices`, { body: f }); setDone(true); setF({ siteId: f.siteId, name: '' }); await load(); }); }}>
        <h3>Сделать это устройство кухонным планшетом</h3>
        <div className="grid2">
          <div><label htmlFor="dvs">Площадка</label><select id="dvs" required value={f.siteId} onChange={(e) => setF({ ...f, siteId: e.target.value })}><option value="">— выберите —</option>{sites.filter((s) => s.status !== 'archived').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div><label htmlFor="dvn">Название</label><input id="dvn" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Планшет горячего цеха" /></div>
        </div>
        {error && <div className="err">{error}</div>}
        {done && <div className="note">Устройство привязано. Выйдите из своей учётной записи — на экране входа будет «Кухонный планшет — вход по PIN».</div>}
        <button className="btn block" disabled={busy}>Привязать это устройство</button>
      </form>
      <h3 style={{ marginTop: 16 }}>Привязанные устройства</h3>
      {!list ? <p className="muted">Загрузка…</p> : list.length === 0 ? <p className="small muted">Пока нет.</p> : (
        <ul className="list">{list.map((d) => (
          <li key={d.id} className="between">
            <div><b>{d.name}</b> {d.revoked_at ? <span className="badge">отвязано</span> : <span className="badge ok">действует</span>}
              <div className="small muted">{d.site} · привязал {d.created_by_name} {fmt(d.created_at)} · последний вход {fmt(d.last_seen_at)}</div></div>
            {!d.revoked_at && <button className="btn danger small" disabled={busy} onClick={() => run(async () => { await api(`/orgs/${orgId}/devices/${d.id}/revoke`, { body: {} }); await load(); })}>Отвязать</button>}
          </li>))}</ul>)}
    </div>
  );
}

function Members({ orgId, meId, sites, roles, canManage }: { orgId: string; meId: string; sites: Site[]; roles: RoleDef[]; canManage: boolean }) {
  const [list, setList] = useState<Member[] | null>(null);
  const { error, run } = useSubmit();
  const load = useCallback(() => api<Member[]>(`/orgs/${orgId}/members`).then(setList), [orgId]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="card">
      {error && <div className="err">{error}</div>}
      {!list ? <p className="muted">Загрузка…</p> : (
        <ul className="list">
          {list.map((x) => (
            <li key={x.id}>
              <div className="between">
                <div><b>{x.full_name}</b> <span className="small muted">{x.email}</span>
                  <div className="small">{x.role_label}{x.position ? ` · ${x.position}` : ''} · {siteNames(x.site_ids, sites)}</div>
                  {x.status === 'blocked' && <div className="small" style={{ color: 'var(--crit)' }}>Заблокирован: {x.blocked_reason}</div>}
                </div>
                {canManage && x.user_id !== meId && (
                  <div className="row">
                    <select aria-label="Роль" value={x.role} style={{ width: 'auto', minHeight: 36 }} disabled={x.status === 'blocked'}
                      onChange={(e) => run(async () => { await api(`/orgs/${orgId}/members/${x.id}`, { method: 'PATCH', body: { role: e.target.value } }); await load(); })}>
                      {roles.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                    </select>
                    {x.has_pin && <button className="btn secondary small" onClick={() => run(async () => { await api(`/orgs/${orgId}/pins/${x.user_id}/reset`, { body: {} }); await load(); })}>Сбросить PIN</button>}
                    {x.status === 'active'
                      ? <button className="btn danger small" onClick={() => { const reason = prompt('Причина блокировки (например, увольнение):'); if (reason) run(async () => { await api(`/orgs/${orgId}/members/${x.id}/block`, { body: { blocked: true, reason } }); await load(); }); }}>Заблокировать</button>
                      : <button className="btn secondary small" onClick={() => run(async () => { await api(`/orgs/${orgId}/members/${x.id}/block`, { body: { blocked: false } }); await load(); })}>Разблокировать</button>}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Invites({ orgId, sites, roles }: { orgId: string; sites: Site[]; roles: RoleDef[] }) {
  const [list, setList] = useState<Invitation[] | null>(null);
  const [form, setForm] = useState({ email: '', fullName: '', role: 'line_staff', position: '', siteIds: [] as string[] });
  const [sent, setSent] = useState<string | null>(null);
  const { busy, error, run } = useSubmit();
  const load = useCallback(() => api<Invitation[]>(`/orgs/${orgId}/invitations`).then(setList), [orgId]);
  useEffect(() => { load(); }, [load]);
  const role = roles.find((r) => r.code === form.role);
  return (
    <>
      <div className="card">
        <h2>Пригласить сотрудника</h2>
        <form onSubmit={(e) => { e.preventDefault(); run(async () => {
          await api(`/orgs/${orgId}/invitations`, { body: { ...form, fullName: form.fullName || undefined, position: form.position || undefined } });
          setSent(form.email); setForm({ ...form, email: '', fullName: '', position: '' }); await load();
        }); }}>
          <div className="grid2">
            <div><label htmlFor="ie">Email</label><input id="ie" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><label htmlFor="in">ФИО</label><input id="in" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></div>
            <div><label htmlFor="ir">Роль</label>
              <select id="ir" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{roles.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}</select></div>
            <div><label htmlFor="ip">Должность</label><input id="ip" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} /></div>
          </div>
          {role && <p className="small muted">{role.summary}</p>}
          <SitePicker sites={sites} value={form.siteIds} onChange={(v) => setForm({ ...form, siteIds: v })} />
          {sent && <div className="okbox">Приглашение отправлено на {sent}. Ссылка действует 7 дней.</div>}
          {error && <div className="err">{error}</div>}
          <button className="btn block" disabled={busy}>Отправить приглашение</button>
        </form>
      </div>
      <div className="card">
        <h2>Отправленные</h2>
        {!list ? <p className="muted">Загрузка…</p> : list.length === 0 ? <p className="muted">Приглашений пока нет.</p> : (
          <ul className="list">
            {list.map((x) => (
              <li key={x.id} className="between">
                <div><b>{x.email}</b>{x.full_name && <> · {x.full_name}</>}<div className="small muted">{roles.find((r) => r.code === x.role)?.label} · {siteNames(x.site_ids, sites)}</div></div>
                <div className="row">
                  <span className={`badge ${INV_STATE[x.state]?.[1] || ''}`}>{INV_STATE[x.state]?.[0] || x.state}</span>
                  {x.state === 'pending' && <button className="btn secondary small" onClick={() => run(async () => { await api(`/orgs/${orgId}/invitations/${x.id}`, { method: 'DELETE' }); await load(); })}>Отозвать</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function fmt(ts: string) {
  return new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function Audit({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [chain, setChain] = useState<{ ok: boolean; checked: number; brokenAt?: number } | null>(null);
  useEffect(() => { api<AuditRow[]>(`/orgs/${orgId}/audit?limit=100`).then(setRows); }, [orgId]);
  return (
    <div className="card">
      <div className="between">
        <h2 style={{ margin: 0 }}>Журнал аудита</h2>
        <button className="btn secondary small" onClick={() => api<typeof chain>(`/orgs/${orgId}/audit/verify`).then(setChain)}>Проверить целостность</button>
      </div>
      {chain && (chain.ok
        ? <div className="okbox">Цепочка цела: проверено записей — {chain.checked}.</div>
        : <div className="err">Цепочка нарушена на записи №{chain.brokenAt}. Сообщите администратору.</div>)}
      {!rows ? <p className="muted">Загрузка…</p> : (
        <div className="scroll">
          <table className="tbl">
            <thead><tr><th>Когда</th><th>Кто</th><th>Что</th><th>Результат</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{fmt(r.created_at)}</td>
                  <td>{r.actor || '—'}</td>
                  <td>{ACTIONS[r.action] || r.action}{r.reason && <div className="small muted">{r.reason}</div>}</td>
                  <td>{r.result === 'success' ? <span className="badge ok">выполнено</span> : <span className="badge crit">{r.result === 'denied' ? 'отказано' : 'ошибка'}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OrgForm({ org, canEdit, onSaved }: { org: Org; canEdit: boolean; onSaved: (o: Org) => void }) {
  const [f, setF] = useState({ name: org.name, legalForm: org.legal_form || 'ООО', inn: org.inn || '', phone: org.phone || '', region: org.region || '', timezone: org.timezone,
    ogrn: org.ogrn || '', legalAddress: org.legal_address || '', email: org.email || '', headPosition: org.head_position || '', headName: org.head_name || '', headBasis: org.head_basis || '', activityNotice: org.activity_notice || '' });
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useSubmit();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setSaved(false); setF({ ...f, [k]: e.target.value }); };
  return (
    <div className="card">
      <form onSubmit={(e) => { e.preventDefault(); run(async () => {
        onSaved(await api<Org>(`/orgs/${org.id}`, { method: 'PATCH', body: f }));   // пустое поле очищает значение setSaved(true);
      }); }}>
        <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }}>
          <label htmlFor="on">Название</label><input id="on" value={f.name} onChange={set('name')} />
          <div className="grid2">
            <div><label htmlFor="olf">Форма</label><select id="olf" value={f.legalForm} onChange={set('legalForm')}>{['ООО', 'ИП', 'АО', 'другое'].map((x) => <option key={x}>{x}</option>)}</select></div>
            <div><label htmlFor="oinn">ИНН</label><input id="oinn" inputMode="numeric" value={f.inn} onChange={set('inn')} /></div>
            <div><label htmlFor="oph">Телефон</label><input id="oph" type="tel" value={f.phone} onChange={set('phone')} /></div>
            <div><label htmlFor="org">Регион</label><input id="org" value={f.region} onChange={set('region')} /></div>
            <div><label htmlFor="otz">Часовой пояс</label><input id="otz" value={f.timezone} onChange={set('timezone')} /></div>
          </div>
          <h3 style={{ marginTop: 14 }}>Реквизиты заявителя для декларации о соответствии</h3>
          <p className="small muted">Поля 3–4 единой формы (решение Коллегии ЕЭК N 293) и сведения заявления о регистрации (приказ Минэкономразвития N 478, п. 7, 12).</p>
          <div className="grid2">
            <div><label htmlFor="ogrn">{f.legalForm === 'ИП' ? 'ОГРНИП' : 'ОГРН'}</label><input id="ogrn" inputMode="numeric" value={f.ogrn} onChange={set('ogrn')} /></div>
            <div><label htmlFor="oem">Электронная почта</label><input id="oem" type="email" value={f.email} onChange={set('email')} /></div>
          </div>
          <label htmlFor="ola">{f.legalForm === 'ИП' ? 'Место жительства (по ЕГРИП)' : 'Место нахождения (адрес юридического лица)'}</label><input id="ola" value={f.legalAddress} onChange={set('legalAddress')} />
          {f.legalForm !== 'ИП' && <div className="grid2">
            <div><label htmlFor="ohp">Должность руководителя</label><input id="ohp" value={f.headPosition} onChange={set('headPosition')} placeholder="Генеральный директор" /></div>
            <div><label htmlFor="ohn">ФИО руководителя</label><input id="ohn" value={f.headName} onChange={set('headName')} /></div>
          </div>}
          {f.legalForm === 'ИП' && <><label htmlFor="ohn2">ФИО индивидуального предпринимателя</label><input id="ohn2" value={f.headName} onChange={set('headName')} /></>}
          {f.legalForm !== 'ИП' && <><label htmlFor="ohb">Основание полномочий (в родительном падеже)</label><input id="ohb" value={f.headBasis} onChange={set('headBasis')} placeholder="Устава / доверенности № … от …" /></>}
          <label htmlFor="oan">Уведомление о начале предпринимательской деятельности (ПП РФ N 584)</label><input id="oan" value={f.activityNotice} onChange={set('activityNotice')} placeholder="№, дата, орган, принявший уведомление" />
        </fieldset>
        <p className="small muted">Статус предприятия: {org.status === 'DRAFT' ? 'черновик — паспорт ещё не заполнен' : org.status}. Соответствие требованиям система автоматически не присваивает.</p>
        {saved && <div className="okbox">Сохранено.</div>}
        {error && <div className="err">{error}</div>}
        {canEdit && <button className="btn block" disabled={busy}>Сохранить</button>}
      </form>
    </div>
  );
}

/** Необязательные модули (ТЗ 3.0 §1.4): по умолчанию выключены; выключение не удаляет историю. */
function OrgModules({ org, defs, canEdit }: { org: Org; defs: ModuleDef[]; canEdit: boolean }) {
  const on = org.modules || [];
  const { busy, error, run } = useSubmit();
  const toggle = (code: string, enable: boolean) => run(async () => {
    await api(`/orgs/${org.id}`, { method: 'PATCH', body: { modules: enable ? [...on, code] : on.filter((x) => x !== code) } });
    window.location.reload();                        // права и меню пересчитываются сервером
  });
  return (
    <div className="card">
      <p className="small muted">Необязательные модули включает владелец или администратор. Пока модуль выключен, его операции запрещены на сервере и раздел скрыт из меню.
        Выключение не удаляет историю: прежние записи остаются в отчётах и журнале аудита.</p>
      <table className="table">
        <thead><tr><th>Модуль</th><th>Назначение</th><th>Состояние</th>{canEdit && <th />}</tr></thead>
        <tbody>
          {defs.map((d) => {
            const enabled = on.includes(d.code);
            return (
              <tr key={d.code}>
                <td>{d.label}</td><td className="small">{d.summary}</td><td>{enabled ? 'включён' : 'выключен'}</td>
                {canEdit && <td><button className={`btn small ${enabled ? 'secondary' : ''}`} disabled={busy} onClick={() => {
                  if (!enabled || confirm(`Выключить модуль «${d.label}»? Его операции станут недоступны всем сотрудникам.`)) toggle(d.code, !enabled);
                }}>{enabled ? 'Выключить' : 'Включить'}</button></td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      <h3 style={{ marginTop: 16 }}>Расход сырья по продажам</h3>
      <p className="small muted">ТЗ 3.0 §12.5: расчётное потребление по продажам отделено от фактического расхода.</p>
      {[['estimate', 'Только расчёт (по умолчанию)', 'Продажа создаёт расчётное потребление по ТТК; склад меняют выпуск, расход, списание и инвентаризация. Расхождение расчёта и факта видно при инвентаризации.'],
        ['ttk_writeoff', 'Списание по ТТК — утверждённая методика сверки', 'Продажа списывает сырьё по ТТК (по ближайшему сроку). Такие движения помечены «расчётное списание»; выбирайте, только если методика утверждена на предприятии.']]
        .map(([k, l, h]) => (
          <label key={k} className="row" style={{ fontWeight: 400, alignItems: 'flex-start', marginTop: 6 }}>
            <input type="radio" name="sc" style={{ width: 22, minHeight: 22 }} disabled={!canEdit || busy} checked={(org.sales_consumption || 'estimate') === k}
              onChange={() => run(async () => { await api(`/orgs/${org.id}`, { method: "PATCH", body: { salesConsumption: k } }); window.location.reload(); })} />
            <span><b>{l}</b><br /><span className="small muted">{h}</span></span>
          </label>))}
      {error && <div className="err">{error}</div>}
    </div>
  );
}

export default function Page() {
  const { org, me } = useOrg();
  return <OrgPage orgId={org.id} meId={me.id} />;
}
