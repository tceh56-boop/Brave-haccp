'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useOrg } from '@/lib/org';
import { SitePicker } from '@/components/OrgNav';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { d, n } from '@/lib/fmt';

/**
 * Закупки: «Что заказать» (норма − годный остаток − уже заказанное), заказы поставщикам, нормы запаса.
 * Предложение системы — только подсказка: количество в заказе выбирает человек.
 */

interface Need { product_id: string; name: string; unit: string; norm: { mode: string; min: number; cover_days: number; safety_pct: number; window_days: number; basis: string | null } | null;
  daily: number; stock: number; ordered: number; draft: number; days_left: number | null; suggest: number; last_supplier_id: string | null; last_supplier: string | null; last_price: number | null }
interface Order { id: string; number: number; status: string; status_label: string; expected_at: string | null; created_at: string; supplier: string; lines: number; amount: string | null }
interface Supplier { id: string; name: string; blocked_reason: string | null }
interface Product { id: string; name: string; unit: string }
const TONE: Record<string, string> = { draft: '', sent: 'warn', confirmed: 'warn', received: 'ok', cancelled: '' };
const TABS: [string, string][] = [['needs', 'Что заказать'], ['orders', 'Заказы'], ['norms', 'Нормы']];
const num = (s: string) => s.trim().replace(',', '.');

function Needs({ needs, reload }: { needs: Need[]; reload: () => void }) {
  const { org, siteId, can } = useOrg();
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [picked, setSupplierId] = useState('');
  const { busy, error, run } = useSubmit();
  useEffect(() => { api<Supplier[]>(`/orgs/${org.id}/suppliers`).then(setSuppliers).catch(() => setSuppliers([])); }, [org.id]);
  useEffect(() => {
    setPick(Object.fromEntries(needs.filter((x) => x.suggest > 0).map((x) => [x.product_id, String(x.suggest).replace('.', ',')])));
  }, [needs]);
  // по умолчанию — поставщик последней приёмки позиции к заказу (если он не заблокирован)
  const last = needs.find((x) => x.suggest > 0 && x.last_supplier_id && suppliers.some((s) => s.id === x.last_supplier_id && !s.blocked_reason))?.last_supplier_id || '';
  const supplierId = picked || last;
  const chosen = Object.entries(pick).filter(([, q]) => Number(num(q)) > 0);
  const manage = can('purchase.manage');
  return (
    <>
      {needs.length === 0 && <div className="card"><p className="muted">Нет позиций с нормой запаса или расходом за 4 недели. Задайте нормы на вкладке «Нормы».</p></div>}
      {needs.length > 0 && (
        <div className="card">
          <h2>Остатки и потребность</h2>
          <p className="small muted">{manage ? 'Справа — количество в заказ. ' : ''}«К заказу» = норма − годный остаток − уже заказанное (отправлено, подтверждено). Карантин, просрочка и партии без подтверждённого срока в остаток не входят.</p>
          <ul className="list">{needs.map((x) => (
            <li key={x.product_id}>
              <div className="between" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                <div><b>{x.name}</b>{x.suggest > 0 && <> <span className="badge warn">к заказу {n(x.suggest)} {x.unit}</span></>}
                  <div className="small">остаток {n(x.stock)} {x.unit} · расход {x.daily > 0 ? `${n(x.daily)}/день` : '—'} · хватит {x.days_left === null ? '—' : <b style={x.norm && x.days_left < x.norm.cover_days ? { color: 'var(--crit)' } : undefined}>{n(x.days_left)} дн.</b>}</div>
                  <div className="small muted">норма {x.norm ? `${n(x.norm.min)} ${x.unit} (${x.norm.mode === 'auto' ? `авто: ${n(x.norm.cover_days)} дн. +${n(x.norm.safety_pct)} %` : 'вручную'})` : 'не задана'}
                    {x.ordered ? ` · заказано ${n(x.ordered)}` : ''}{x.draft ? ` · в черновике ${n(x.draft)}` : ''}{x.last_supplier ? ` · ${x.last_supplier}${x.last_price !== null ? `, ${n(x.last_price)} ₽/${x.unit}` : ''}` : ''}</div>
                </div>
                {manage && <input aria-label={`В заказ: ${x.name}`} inputMode="decimal" placeholder="0" style={{ width: 76, flex: 'none' }} value={pick[x.product_id] || ''} onChange={(e) => setPick({ ...pick, [x.product_id]: e.target.value })} />}
              </div>
            </li>))}</ul>
        </div>
      )}
      {manage && needs.length > 0 && (
        <div className="card">
          <h2>Заказ поставщику</h2>
          <label htmlFor="sup">Поставщик</label>
          <select id="sup" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">— выберите —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id} disabled={!!s.blocked_reason}>{s.name}{s.blocked_reason ? ` — заблокирован: ${s.blocked_reason}` : ''}</option>)}
          </select>
          {error && <div className="err" role="alert">{error}</div>}
          <button className="btn block" disabled={busy || !siteId || !supplierId || chosen.length === 0} onClick={() => run(async () => {
            const lines = chosen.map(([productId, q]) => ({ productId, quantity: num(q), price: needs.find((x) => x.product_id === productId)?.last_supplier_id === supplierId ? needs.find((x) => x.product_id === productId)?.last_price ?? null : null }));
            const o = await api<{ id: string }>(`/orgs/${org.id}/purchasing/orders`, { body: { siteId, supplierId, lines } });
            reload(); router.push(`/app/${org.id}/purchasing/${o.id}`);
          })}>Создать черновик заказа ({chosen.length} поз.)</button>
          <p className="small muted">Количество справа можно изменить. Цена подставляется из последней приёмки у этого поставщика.</p>
        </div>
      )}
    </>
  );
}

function Orders({ orders }: { orders: Order[] }) {
  const { org } = useOrg();
  if (orders.length === 0) return <div className="card"><p className="muted">Заказов пока нет. Создайте черновик на вкладке «Что заказать».</p></div>;
  return (
    <div className="card">
      {orders.map((o) => (
        <Link key={o.id} href={`/app/${org.id}/purchasing/${o.id}`} className="objrow">
          <div><b>№ {o.number} · {o.supplier}</b>
            <div className="small muted">{d(o.created_at, org.timezone)} · {o.lines} поз.{o.amount !== null ? ` · ${n(o.amount)} ₽` : ''}{o.expected_at ? ` · поставка ${o.expected_at.slice(0, 10).split('-').reverse().join('.')}` : ''}</div></div>
          <span className={`badge ${TONE[o.status]}`}>{o.status_label}</span>
        </Link>))}
    </div>
  );
}

function Norms({ needs, reload }: { needs: Need[]; reload: () => void }) {
  const { org, siteId, can } = useOrg();
  const [products, setProducts] = useState<Product[]>([]);
  const [f, setF] = useState({ productId: '', mode: 'auto', minQty: '', basis: '', coverDays: '3', safetyPct: '20', windowDays: '28' });
  const { busy, error, run } = useSubmit();
  useEffect(() => { api<Product[]>(`/orgs/${org.id}/products`).then(setProducts).catch(() => setProducts([])); }, [org.id]);
  const withNorm = needs.filter((x) => x.norm);
  const edit = (x: Need) => setF({ productId: x.product_id, mode: x.norm!.mode, minQty: x.norm!.mode === 'manual' ? String(x.norm!.min) : '', basis: x.norm!.basis || '',
    coverDays: String(x.norm!.cover_days), safetyPct: String(x.norm!.safety_pct), windowDays: String(x.norm!.window_days) });
  const save = (mode: string) => run(async () => {
    await api(`/orgs/${org.id}/purchasing/norms`, { body: { siteId, productId: f.productId, mode, minQty: mode === 'manual' ? num(f.minQty) : null, basis: f.basis || null,
      coverDays: num(f.coverDays), safetyPct: num(f.safetyPct), windowDays: num(f.windowDays) } });
    setF({ ...f, productId: '', minQty: '', basis: '' }); reload();
  });
  const unit = products.find((p) => p.id === f.productId)?.unit || '';
  return (
    <>
      <div className="card">
        <h2>Нормы запаса · {withNorm.length}</h2>
        {withNorm.length === 0 && <p className="small muted">Норм пока нет.</p>}
        {withNorm.map((x) => (
          <div key={x.product_id} className="objrow">
            <div><b>{x.name}</b>
              <div className="small muted">{x.norm!.mode === 'auto' ? `авто: расход ${n(x.daily)}/день за ${x.norm!.window_days} дн. × ${n(x.norm!.cover_days)} дн. + ${n(x.norm!.safety_pct)} %` : `вручную: ${x.norm!.basis}`}</div></div>
            <div className="row"><b>{n(x.norm!.min)} {x.unit}</b>{can('purchase.manage') && <button className="btn secondary small" onClick={() => edit(x)}>Изменить</button>}</div>
          </div>))}
      </div>
      {can('purchase.manage') && (
        <div className="card">
          <h2>{withNorm.some((x) => x.product_id === f.productId) ? 'Изменить норму' : 'Новая норма'}</h2>
          <label htmlFor="np">Товар</label>
          <select id="np" value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })}>
            <option value="">— выберите —</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
          </select>
          <div className="chips" role="radiogroup" style={{ marginTop: 10 }}>
            {[['auto', 'По расходу'], ['manual', 'Вручную']].map(([k, l]) => <button key={k} type="button" aria-pressed={f.mode === k} onClick={() => setF({ ...f, mode: k })}>{l}</button>)}
          </div>
          {f.mode === 'auto' ? (
            <div className="grid2">
              <div><label htmlFor="cd">Запас на, дней</label><input id="cd" inputMode="decimal" value={f.coverDays} onChange={(e) => setF({ ...f, coverDays: e.target.value })} /></div>
              <div><label htmlFor="sp">Страховой запас, %</label><input id="sp" inputMode="decimal" value={f.safetyPct} onChange={(e) => setF({ ...f, safetyPct: e.target.value })} /></div>
              <div><label htmlFor="wd">Считать расход за, дней</label><input id="wd" inputMode="numeric" value={f.windowDays} onChange={(e) => setF({ ...f, windowDays: e.target.value })} /></div>
            </div>
          ) : (
            <div className="grid2">
              <div><label htmlFor="mq">Минимум{unit ? `, ${unit}` : ''}</label><input id="mq" inputMode="decimal" value={f.minQty} onChange={(e) => setF({ ...f, minQty: e.target.value })} /></div>
              <div><label htmlFor="nb">Основание</label><input id="nb" value={f.basis} onChange={(e) => setF({ ...f, basis: e.target.value })} placeholder="поставка раз в неделю" /></div>
            </div>
          )}
          {f.mode === 'auto' && <p className="small muted">Норма = средний расход в день (списания, продажи, производство) × дни запаса × (1 + страховой %). Нет расхода — норма 0, пока не появятся данные.</p>}
          {error && <div className="err" role="alert">{error}</div>}
          <button className="btn block" disabled={busy || !f.productId || !siteId} onClick={() => save(f.mode)}>Сохранить норму</button>
          {withNorm.some((x) => x.product_id === f.productId) && <button className="btn block secondary" disabled={busy} onClick={() => save('off')}>Снять норму</button>}
        </div>
      )}
    </>
  );
}

function Purchasing() {
  const { org, siteId } = useOrg();
  const sp = useSearchParams();
  const [tab, setTab] = useState(sp.get('tab') || 'needs');
  const [needs, setNeeds] = useState<Need[] | null>(null);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!siteId) return;
    api<Need[]>(`/orgs/${org.id}/purchasing/needs?siteId=${siteId}`).then(setNeeds).catch((e) => setError(e.message));
    api<Order[]>(`/orgs/${org.id}/purchasing/orders?siteId=${siteId}`).then(setOrders).catch((e) => setError(e.message));
  }, [org.id, siteId]);
  useEffect(() => { load(); }, [load]);
  const open = (orders || []).filter((o) => ['draft', 'sent', 'confirmed'].includes(o.status)).length;
  const toOrder = (needs || []).filter((x) => x.suggest > 0).length;
  return (
    <>
      <h1>Закупки</h1>
      <SitePicker />
      <div className="tabs" role="tablist">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}{k === 'needs' && toOrder ? ` · ${toOrder}` : ''}{k === 'orders' && open ? ` · ${open}` : ''}</button>)}
      </div>
      {error && <div className="err">{error}</div>}
      {!needs || !orders ? <p className="muted">Загрузка…</p> : tab === 'needs' ? <Needs needs={needs} reload={load} /> : tab === 'orders' ? <Orders orders={orders} /> : <Norms needs={needs} reload={load} />}
    </>
  );
}

export default function Page() { return <Suspense><Purchasing /></Suspense>; }
