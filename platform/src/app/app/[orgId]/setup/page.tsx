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
  const [products, setProducts] = useState<{ id: string; name: string; unit: string; category: string | null }[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string; inn: string | null }[]>([]);
  const [p, setP] = useState({ name: '', unit: 'кг', category: '' });
  const [s, setS] = useState({ name: '', inn: '' });
  const { busy, error, run } = useSubmit();
  const load = useCallback(() => { api<typeof products>(`/orgs/${org.id}/products`).then(setProducts); api<typeof suppliers>(`/orgs/${org.id}/suppliers`).then(setSuppliers); }, [org.id]);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <div className="card">
        <h2>Товары</h2>
        <p className="small muted">Временный справочник для приёмки. Единый каталог (1549 позиций MON CHEF, без автоматического слияния дублей) подключается на этапе 3.</p>
        <ul className="list">{products.map((x) => <li key={x.id}>{x.name} <span className="small muted">({x.unit}{x.category ? `, ${x.category}` : ''})</span></li>)}</ul>
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
        <ul className="list">{suppliers.map((x) => <li key={x.id}>{x.name} {x.inn && <span className="small muted">ИНН {x.inn}</span>}</li>)}</ul>
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
