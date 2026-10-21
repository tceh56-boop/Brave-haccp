'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { SitePicker } from '@/components/OrgNav';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';

interface Obj { id: string; name: string; kind_label: string; criterion: string | null; drafts: number; code: string }
const KINDS: [string, string][] = [['fridge', 'Холодильник'], ['freezer', 'Морозильник'], ['room', 'Помещение / склад'], ['hot_holding', 'Мармит / горячее хранение'], ['line', 'Линия раздачи'], ['other', 'Другое']];

/** Настройка: объекты контроля и их правила, товары, поставщики. */
export default function SetupPage() {
  const { org, siteId, can } = useOrg();
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}`}>← Управление</Link></p>
      <h1>Настройка контроля и справочников</h1>
      <SitePicker />
      {can('control.read') && siteId && <Objects />}
      {can('catalog.manage') && <Reference />}
      {can('catalog.read') && <Catalog />}
    </>
  );
}

function Objects() {
  const { org, siteId, can } = useOrg();
  const [list, setList] = useState<Obj[] | null>(null);
  const [f, setF] = useState({ name: '', kind: 'fridge', location: '' });
  const { busy, error, run } = useSubmit();
  const load = useCallback(() => { if (siteId) api<Obj[]>(`/orgs/${org.id}/sites/${siteId}/objects`).then(setList); }, [org.id, siteId]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="card">
      <h2>Объекты контроля</h2>
      {!list ? <p className="muted">Загрузка…</p> : list.length === 0 ? <p className="muted">Пока нет объектов.</p> : (
        <div>{list.map((o) => (
          <Link key={o.id} className="objrow" href={`/app/${org.id}/objects/${o.id}`}>
            <div><b>{o.name}</b><div className="small muted">{o.kind_label} · код {o.code}</div></div>
            <div className="row">{o.criterion ? <span className="badge ok">{o.criterion}</span> : <span className="badge warn">нет утверждённого правила</span>}
              {o.drafts > 0 && <span className="badge warn">проект: {o.drafts}</span>}<span aria-hidden>›</span></div>
          </Link>
        ))}</div>
      )}
      {can('control.manage') && (
        <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/orgs/${org.id}/objects`, { body: { siteId, name: f.name, kind: f.kind, location: f.location || null } }); setF({ name: '', kind: f.kind, location: '' }); load(); }); }}>
          <h3 style={{ marginTop: 14 }}>Новый объект</h3>
          <div className="grid2">
            <div><label htmlFor="on">Название</label><input id="on" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Холодильник №2 (молочка)" /></div>
            <div><label htmlFor="ok">Вид</label><select id="ok" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          </div>
          <label htmlFor="ol">Где находится</label><input id="ol" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="горячий цех, у окна" />
          {error && <div className="err">{error}</div>}
          <button className="btn block secondary" disabled={busy}>Добавить объект</button>
          <p className="small muted">После добавления откройте объект и задайте правило: пределы, частоту и основание. Правило действует после утверждения.</p>
        </form>
      )}
    </div>
  );
}

function Catalog() {
  const { org, can } = useOrg();
  const [products, setProducts] = useState<{ id: string; name: string; unit: string; category: string | null; reference_name: string | null; reference_code: string | null; opened_shelf_hours: string | null; opened_shelf_basis: string | null }[]>([]);
  const [rule, setRule] = useState<{ id: string; hours: string; basis: string } | null>(null);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string; inn: string | null; phone: string | null; email: string | null; blocked_reason: string | null }[]>([]);
  const [sup, setSup] = useState<{ id: string; phone: string; email: string; blockedReason: string } | null>(null);
  const [p, setP] = useState({ name: '', unit: 'кг', category: '' });
  const [s, setS] = useState({ name: '', inn: '' });
  const { busy, error, run } = useSubmit();
  const load = useCallback(() => { api<typeof products>(`/orgs/${org.id}/products`).then(setProducts); api<typeof suppliers>(`/orgs/${org.id}/suppliers`).then(setSuppliers); }, [org.id]);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <div className="card">
        <h2>Товары</h2>
        <p className="small muted">Товары предприятия. Привязка к справочнику MON CHEF даёт справочную пищевую ценность и условия хранения (статус «на проверке» — не утверждённая норма).</p>
        <ul className="list">{products.map((x) => <li key={x.id}>{x.name} <span className="small muted">({x.unit}{x.category ? `, ${x.category}` : ''})</span>{x.reference_code && <div className="small muted">справочник: {x.reference_code} «{x.reference_name}»</div>}
          <div className="small">{x.opened_shelf_hours ? <>после вскрытия: {Number(x.opened_shelf_hours)} ч — {x.opened_shelf_basis}</> : <span className="muted">срок после вскрытия не задан</span>}
            {can('catalog.manage') && rule?.id !== x.id && <> · <button className="linkbtn" onClick={() => setRule({ id: x.id, hours: x.opened_shelf_hours ? String(Number(x.opened_shelf_hours)) : '', basis: x.opened_shelf_basis || '' })}>изменить</button></>}</div>
          {rule?.id === x.id && (
            <form onSubmit={(e) => { e.preventDefault(); run(async () => {
              await api(`/orgs/${org.id}/products/${x.id}/opened-shelf-life`, { body: { hours: rule.hours ? rule.hours.replace(',', '.') : null, basis: rule.basis || null } }); setRule(null); load();
            }); }}>
              <div className="grid2">
                <div><label htmlFor={`oh-${x.id}`}>После вскрытия, ч (пусто — снять)</label><input id={`oh-${x.id}`} inputMode="decimal" value={rule.hours} onChange={(e) => setRule({ ...rule, hours: e.target.value })} /></div>
                <div><label htmlFor={`ob-${x.id}`}>Основание</label><input id={`ob-${x.id}`} value={rule.basis} onChange={(e) => setRule({ ...rule, basis: e.target.value })} placeholder="маркировка изготовителя / утверждённое правило" /></div>
              </div>
              <div className="row" style={{ marginTop: 8 }}><button className="btn small" disabled={busy}>Сохранить</button><button type="button" className="btn small secondary" onClick={() => setRule(null)}>Отмена</button></div>
            </form>)}
        </li>)}</ul>
        {can('catalog.manage') && (
          <form className="row" style={{ marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/orgs/${org.id}/products`, { body: { ...p, category: p.category || null } }); setP({ name: '', unit: p.unit, category: '' }); load(); }); }}>
            <input aria-label="Название товара" required placeholder="Название" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} style={{ flex: 3 }} />
            <select aria-label="Единица" value={p.unit} onChange={(e) => setP({ ...p, unit: e.target.value })} style={{ flex: 1 }}>{['кг', 'г', 'л', 'мл', 'шт'].map((u) => <option key={u}>{u}</option>)}</select>
            <button className="btn secondary small" disabled={busy}>Добавить</button>
          </form>
        )}
      </div>
      <div className="card">
        <h2>Поставщики</h2>
        <ul className="list">{suppliers.map((x) => <li key={x.id}>{x.name} {x.inn && <span className="small muted">ИНН {x.inn}</span>}
          {x.blocked_reason && <span className="badge crit">заблокирован</span>}
          <div className="small">{[x.phone, x.email].filter(Boolean).join(' · ') || <span className="muted">контакты не заданы</span>}{x.blocked_reason ? ` · блок: ${x.blocked_reason}` : ''}
            {can('catalog.manage') && sup?.id !== x.id && <> · <button className="linkbtn" onClick={() => setSup({ id: x.id, phone: x.phone || '', email: x.email || '', blockedReason: x.blocked_reason || '' })}>изменить</button></>}</div>
          {sup?.id === x.id && (
            <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/orgs/${org.id}/suppliers/${x.id}`, { method: 'PATCH', body: sup }); setSup(null); load(); }); }}>
              <div className="grid2">
                <div><label htmlFor={`sph-${x.id}`}>Телефон</label><input id={`sph-${x.id}`} inputMode="tel" value={sup.phone} onChange={(e) => setSup({ ...sup, phone: e.target.value })} /></div>
                <div><label htmlFor={`sem-${x.id}`}>Email для заказов</label><input id={`sem-${x.id}`} inputMode="email" value={sup.email} onChange={(e) => setSup({ ...sup, email: e.target.value })} /></div>
              </div>
              <label htmlFor={`sbl-${x.id}`}>Блокировка для заказов (причина; пусто — не заблокирован)</label>
              <input id={`sbl-${x.id}`} value={sup.blockedReason} onChange={(e) => setSup({ ...sup, blockedReason: e.target.value })} placeholder="две поставки подряд с нарушением температуры" />
              <div className="row" style={{ marginTop: 8 }}><button className="btn small" disabled={busy}>Сохранить</button><button type="button" className="btn small secondary" onClick={() => setSup(null)}>Отмена</button></div>
            </form>)}
        </li>)}</ul>
        {can('catalog.manage') && (
          <form className="row" style={{ marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/orgs/${org.id}/suppliers`, { body: { name: s.name, inn: s.inn || null } }); setS({ name: '', inn: '' }); load(); }); }}>
            <input aria-label="Поставщик" required placeholder="ООО «…»" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} style={{ flex: 3 }} />
            <input aria-label="ИНН" placeholder="ИНН" inputMode="numeric" value={s.inn} onChange={(e) => setS({ ...s, inn: e.target.value })} style={{ flex: 2 }} />
            <button className="btn secondary small" disabled={busy}>Добавить</button>
          </form>
        )}
      </div>
      {error && <div className="err">{error}</div>}
    </>
  );
}

interface Ref { id: string; code: string; name: string; product_type: string | null; kcal_100: string | null; protein_100: string | null; fat_100: string | null; carbs_100: string | null; shelf_fridge: string | null; verification_status: string; duplicate_group: string | null }

/** Справочник MON CHEF: 1549 ProductID; одинаковые названия не сливаются — выбирает человек. */
function Reference() {
  const { org } = useOrg();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Ref[]>([]);
  const [unit, setUnit] = useState('кг');
  const [created, setCreated] = useState<string | null>(null);
  const { busy, error, run } = useSubmit();
  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(() => { api<Ref[]>(`/orgs/${org.id}/reference?q=${encodeURIComponent(q.trim())}`).then(setFound).catch(() => undefined); }, 250);
    return () => clearTimeout(t);
  }, [q, org.id]);
  return (
    <div className="card">
      <h2>Справочник продуктов MON CHEF</h2>
      <p className="small muted">1549 позиций. Пищевая ценность и сроки — справочные, «на проверке»: перед использованием в документах их подтверждает специалист.</p>
      <input aria-label="Поиск в справочнике" placeholder="Название продукта" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="row" style={{ marginTop: 8 }}><span className="small">Единица учёта нового товара:</span>
        <select aria-label="Единица нового товара" value={unit} onChange={(e) => setUnit(e.target.value)} style={{ width: 'auto' }}>{['кг', 'г', 'л', 'мл', 'шт'].map((u) => <option key={u}>{u}</option>)}</select></div>
      {created && <div className="okbox">Товар «{created}» добавлен.</div>}
      {error && <div className="err">{error}</div>}
      <ul className="list">{found.map((r) => (
        <li key={r.id} className="between">
          <div><b>{r.name}</b> <span className="small muted">{r.code}{r.product_type ? ` · ${r.product_type}` : ''}</span>
            <div className="small">{r.kcal_100 !== null ? `${Number(r.kcal_100)} ккал, Б ${Number(r.protein_100)} · Ж ${Number(r.fat_100)} · У ${Number(r.carbs_100)} на 100 г` : 'КБЖУ нет'}{r.shelf_fridge ? ` · холодильник: ${r.shelf_fridge}` : ''}</div>
            <div className="row" style={{ marginTop: 4 }}><span className="badge warn">на проверке</span>{r.duplicate_group && <span className="badge">есть одноимённые — сверьте</span>}</div></div>
          <button className="btn secondary small" disabled={busy} onClick={() => run(async () => { const p = await api<{ name: string }>(`/orgs/${org.id}/products/from-reference`, { body: { referenceId: r.id, unit } }); setCreated(p.name); })}>Добавить</button>
        </li>
      ))}</ul>
    </div>
  );
}
