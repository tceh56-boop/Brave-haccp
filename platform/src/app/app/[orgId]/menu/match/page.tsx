'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';

interface Name { name: string; line_id: string; units: string[]; dishes: string[]; count: number }
interface Product { id: string; name: string; unit: string }
interface Dish { id: string; name: string; kind: string }

/** Сопоставление сырья: каждое название из карт — один раз; применяется ко всем черновикам и будущим импортам. */
export default function MatchPage() {
  const { org } = useOrg();
  const [names, setNames] = useState<Name[] | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [semis, setSemis] = useState<Dish[]>([]);
  const load = useCallback(async () => {
    setNames(await api<Name[]>(`/orgs/${org.id}/ttk-unmatched`));
    setProducts(await api<Product[]>(`/orgs/${org.id}/products`));
    setSemis((await api<Dish[]>(`/orgs/${org.id}/dishes`)).filter((d) => d.kind === 'semi'));
  }, [org.id]);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/menu`}>← Блюда и ТТК</Link></p>
      <h1>Сопоставить сырьё</h1>
      <p className="small muted">Название из карты → товар склада или полуфабрикат. Сопоставление запоминается: следующие импорты подставят его сами.</p>
      {!names ? <p className="muted">Загрузка…</p> : names.length === 0 ? <div className="okbox">Всё сырьё в черновиках сопоставлено.</div>
        : names.map((x) => <Row key={x.line_id} x={x} products={products} semis={semis} onDone={load} />)}
    </>
  );
}

function Row({ x, products, semis, onDone }: { x: Name; products: Product[]; semis: Dish[]; onDone: () => void }) {
  const { org } = useOrg();
  const [pick, setPick] = useState('');
  const [unit, setUnit] = useState(x.units.find((u) => ['кг', 'г', 'л', 'мл', 'шт'].includes(u)) === 'л' ? 'л' : 'кг');
  const { busy, error, run } = useSubmit();
  const needle = x.name.toLowerCase().split(/\s+/)[0].slice(0, 5);
  const sorted = [...products].sort((a, b) => Number(b.name.toLowerCase().includes(needle)) - Number(a.name.toLowerCase().includes(needle)) || a.name.localeCompare(b.name, 'ru'));
  const match = (body: object) => run(async () => { await api(`/orgs/${org.id}/ttk-lines/${x.line_id}/match`, { body: { ...body, remember: true } }); onDone(); });
  return (
    <div className="card">
      <div className="between"><b>{x.name}</b><span className="badge">в {x.count} строк{x.count === 1 ? 'е' : 'ах'}</span></div>
      <div className="small muted">{x.dishes.join(', ')}{x.count > x.dishes.length ? '…' : ''} · ед.: {x.units.join(', ')}</div>
      {error && <div className="err">{error}</div>}
      <label htmlFor={`p-${x.line_id}`}>Товар или полуфабрикат</label>
      <select id={`p-${x.line_id}`} value={pick} onChange={(e) => setPick(e.target.value)}>
        <option value="">— выберите —</option>
        {semis.length > 0 && <optgroup label="Полуфабрикаты">{semis.map((s) => <option key={s.id} value={`s:${s.id}`}>{s.name}</option>)}</optgroup>}
        <optgroup label="Товары">{sorted.map((p) => <option key={p.id} value={`p:${p.id}`}>{p.name} ({p.unit})</option>)}</optgroup>
      </select>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn small" disabled={busy || !pick} onClick={() => match(pick.startsWith('s:') ? { subDishId: pick.slice(2) } : { productId: pick.slice(2) })}>Сопоставить</button>
        <span className="small muted">или новый товар:</span>
        <select aria-label="Единица нового товара" value={unit} onChange={(e) => setUnit(e.target.value)} style={{ width: 80 }}>{['кг', 'л', 'шт'].map((u) => <option key={u}>{u}</option>)}</select>
        <button className="btn small secondary" disabled={busy} onClick={() => run(async () => {
          const p = await api<Product>(`/orgs/${org.id}/products`, { body: { name: x.name.replace(/\s+/g, ' ').trim(), unit } });
          await api(`/orgs/${org.id}/ttk-lines/${x.line_id}/match`, { body: { productId: p.id, remember: true } }); onDone();
        })}>Создать «{x.name.trim()}»</button>
      </div>
    </div>
  );
}
