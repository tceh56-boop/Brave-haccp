'use client';
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { dt, n } from '@/lib/fmt';

interface CLine { key: string; name: string; unit: string; norm: number; price: number | null; sum: number | null; price_source: string | null }
interface Preview { seq: number; doc_no: string | null; ttk_version: number; basis_label: string; yield_g: number; lines: CLine[]; missing: string[]; cost_1: number | null; raw_100: number | null;
  sale_price: number | null; markup_pct: number | null }
interface Card { id: string; seq: number; calc_date: string; cost_1: string; sale_price: string | null; markup_pct: string | null; approved_at: string; approved_by_name: string; ttk_version: number }

/**
 * Калькуляционная карточка (ОП-1): предпросмотр по текущим ценам, ввод цены с основанием там, где цены партии нет,
 * утверждение — неизменяемый снимок; список калькуляций блюда и печатная форма.
 */
export default function CostingPage({ params }: { params: Promise<{ dishId: string }> }) {
  const { dishId } = use(params);
  const { org, can, sites, siteId, me } = useOrg();
  const [pv, setPv] = useState<Preview | null>(null);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [manual, setManual] = useState<Record<string, { price: string; basis: string }>>({});
  const [f, setF] = useState({ salePrice: '', siteId: siteId || '', chef: me.full_name || '', accountant: '', director: '' });
  const { busy, error, run } = useSubmit();
  const load = useCallback(() => {
    api<Preview>(`/orgs/${org.id}/dishes/${dishId}/costing/preview`).then((p) => { setPv(p); setErr(null); setF((x) => ({ ...x, salePrice: x.salePrice || (p.sale_price ? String(p.sale_price) : '') })); })
      .catch((e) => setErr(e.message));
    api<Card[]>(`/orgs/${org.id}/dishes/${dishId}/costing`).then(setCards).catch(() => setCards([]));
    api<{ dish: { name: string } }>(`/orgs/${org.id}/dishes/${dishId}`).then((d) => setName(d.dish.name)).catch(() => undefined);
  }, [org.id, dishId]);
  useEffect(() => { load(); }, [load]);
  const num = (s: string) => (s.trim() ? Number(s.replace(',', '.')) : null);

  // предпросмотр с ценами, введёнными вручную (на сервере пересчитывается так же)
  const lines = (pv?.lines || []).map((l) => {
    const m = manual[l.key];
    const price = l.price !== null ? l.price : m && num(m.price) ? num(m.price)! : null;
    return { ...l, price, sum: price === null ? null : Math.round(l.norm * price * 100) / 100 };
  });
  const cost = lines.every((l) => l.sum !== null) ? Math.round(lines.reduce((s, l) => s + l.sum!, 0) * 100) / 100 : null;
  const sale = num(f.salePrice);
  const approve = () => run(async () => {
    const prices = Object.entries(manual).filter(([k, v]) => pv!.lines.find((l) => l.key === k)?.price === null && num(v.price)).map(([key, v]) => ({ key, price: num(v.price), basis: v.basis }));
    const r = await api<{ id: string }>(`/orgs/${org.id}/dishes/${dishId}/costing`, { body: { siteId: f.siteId || null, salePrice: sale, prices, signers: { chef: f.chef, accountant: f.accountant, director: f.director } } });
    location.assign(`/app/${org.id}/menu/${dishId}/costing/${r.id}`);
  });

  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/menu/${dishId}`}>← {name || 'Блюдо'}</Link></p>
      <h1>Калькуляция (ОП-1)</h1>
      <p className="small muted">По утверждённой ТТК. Норма — брутто на {pv?.basis_label || '1 блюдо'}; цена — средняя по партиям в остатке, иначе последняя закупка.
        Утверждённая калькуляция не меняется: изменились цены — составьте следующую.</p>
      {err && <div className="err">{err}</div>}

      {cards && cards.length > 0 && (
        <div className="card">
          <h2>Утверждённые калькуляции</h2>
          <ul className="list">{cards.map((c) => (
            <li key={c.id}><Link className="between" href={`/app/${org.id}/menu/${dishId}/costing/${c.id}`}>
              <span><b>№ {c.seq} от {c.calc_date.split('-').reverse().join('.')}</b><span className="small muted"> · ТТК v{c.ttk_version} · {c.approved_by_name}</span></span>
              <span>{n(c.cost_1)} ₽{c.sale_price ? ` → ${n(c.sale_price)} ₽` : ''}{c.markup_pct !== null ? ` · наценка ${n(c.markup_pct)} %` : ''} ›</span>
            </Link></li>))}</ul>
        </div>
      )}

      {pv && (
        <div className="card">
          <h2>Калькуляция № {pv.seq} — по текущим ценам</h2>
          <div className="scroll"><table className="tbl">
            <thead><tr><th>Продукты</th><th>Ед.</th><th>Норма</th><th>Цена</th><th>Сумма</th></tr></thead>
            <tbody>{lines.map((l, i) => {
              const orig = pv.lines[i];
              return (
                <tr key={`${l.key}-${i}`}>
                  <td>{l.name}{orig.price_source && <div className="small muted">{orig.price_source}</div>}
                    {orig.price === null && can('menu.price') && (
                      <div className="row" style={{ marginTop: 4 }}>
                        <input aria-label={`Цена ${l.name}`} inputMode="decimal" placeholder="цена" value={manual[l.key]?.price || ''} style={{ width: 90 }}
                          onChange={(e) => setManual({ ...manual, [l.key]: { basis: manual[l.key]?.basis || '', price: e.target.value } })} />
                        <input aria-label={`Основание цены ${l.name}`} placeholder="основание: прайс, счёт…" value={manual[l.key]?.basis || ''} style={{ flex: 1, minWidth: 140 }}
                          onChange={(e) => setManual({ ...manual, [l.key]: { price: manual[l.key]?.price || '', basis: e.target.value } })} />
                      </div>)}</td>
                  <td>{l.unit}</td><td>{l.norm.toLocaleString('ru-RU', { minimumFractionDigits: 4 })}</td>
                  <td>{l.price === null ? <span className="badge crit">нет цены</span> : n(l.price)}</td><td>{l.sum === null ? '—' : n(l.sum)}</td>
                </tr>);
            })}</tbody>
          </table></div>
          <dl className="kv">
            <dt>Сырьевой набор на 100</dt><dd>{cost === null ? '—' : `${n(Math.round(cost * 100 * 100) / 100)} ₽`}</dd>
            <dt>Себестоимость 1</dt><dd><b>{cost === null ? 'неполная — нет цен' : `${n(cost)} ₽`}</b></dd>
            <dt>Наценка к себестоимости</dt><dd>{cost && sale ? `${n(Math.round((sale - cost) / cost * 10000) / 100)} %` : '—'}</dd>
            <dt>Выход</dt><dd>{pv.basis_label}</dd>
          </dl>
          {can('menu.price') && (
            <form onSubmit={(e) => { e.preventDefault(); approve(); }}>
              <div className="grid2">
                <div><label htmlFor="cs">Цена продажи, ₽</label><input id="cs" inputMode="decimal" value={f.salePrice} onChange={(e) => setF({ ...f, salePrice: e.target.value })} /></div>
                <div><label htmlFor="csite">Структурное подразделение</label>
                  <select id="csite" value={f.siteId} onChange={(e) => setF({ ...f, siteId: e.target.value })}><option value="">—</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
                <div><label htmlFor="cchef">Зав. производством (шеф-повар)</label><input id="cchef" value={f.chef} onChange={(e) => setF({ ...f, chef: e.target.value })} /></div>
                <div><label htmlFor="cacc">Бухгалтер-калькулятор</label><input id="cacc" value={f.accountant} onChange={(e) => setF({ ...f, accountant: e.target.value })} /></div>
                <div><label htmlFor="cdir">Утверждает (руководитель)</label><input id="cdir" value={f.director} onChange={(e) => setF({ ...f, director: e.target.value })} /></div>
              </div>
              {error && <div className="err" role="alert">{error}</div>}
              <button className="btn block" disabled={busy || cost === null}>Утвердить калькуляцию № {pv.seq}</button>
              {cost === null && <p className="small muted">Сначала укажите цены с основанием там, где цены партии нет.</p>}
            </form>
          )}
        </div>
      )}
      {cards && cards[0] && <p className="small muted">Последняя утверждена {dt(cards[0].approved_at, org.timezone)}.</p>}
    </>
  );
}
