'use client';
import { Suspense, use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { dt, n } from '@/lib/fmt';

interface Line { id: string; position: number; name_raw: string; product_id: string | null; sub_dish_id: string | null; product_name: string | null; product_unit: string | null; sub_dish_name: string | null;
  unit: string; brutto: string | null; netto: string | null; note: string | null }
interface Version { id: string; version: number; status: string; status_label: string; yield_g: string | null; portion_g: string | null; technology: string | null; storage_conditions: string | null;
  shelf_life: string | null; shelf_life_hours: string | null; quality: string | null; allergens: string | null; source: string; change_reason: string | null; return_note: string | null; approved_at: string | null }
interface Cost { total: number | null; known: number; complete: boolean; missing: string[]; per_portion: number | null; per_kg: number | null; food_cost_pct: number | null;
  lines: { line_id: string; cost: number | null; price: number | null; price_unit: string | null; source: string | null }[] }
interface Kbju { per100: { kcal: number; protein: number; fat: number; carbs: number } | null; complete: boolean; verified: boolean; missing: string[] }
interface Data { dish: { id: string; name: string; kind: string; kind_label: string; category: string | null; sale_price: string | null };
  versions: { id: string; version: number; status: string; status_label: string; approved_at: string | null; approved_by_name: string | null }[];
  current: { version: Version; lines: Line[]; blockers: string[]; warnings: string[]; cost: Cost | null; kbju: Kbju } | null;
  archive: { source_path: string; issues: string[]; yield_raw: string | null; yield_source: string | null } | null; canSeeCost: boolean }
interface Product { id: string; name: string; unit: string }
interface Dish { id: string; name: string; kind: string }

const UNITS = ['кг', 'г', 'л', 'мл', 'шт', 'порция'];
const TONE: Record<string, string> = { draft: 'warn', review: 'warn', approved: 'ok', archived: '' };

/** Карточка блюда: версии ТТК, состав, технология, себестоимость, КБЖУ, согласование и утверждение. */
export default function DishPage({ params }: { params: Promise<{ dishId: string }> }) {
  return <Suspense fallback={<p className="muted">Загрузка…</p>}><DishView params={params} /></Suspense>;
}

function DishView({ params }: { params: Promise<{ dishId: string }> }) {
  const { dishId } = use(params);
  const { org, can } = useOrg();
  const router = useRouter();
  const versionId = useSearchParams().get('v');
  const [data, setData] = useState<Data | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [semis, setSemis] = useState<Dish[]>([]);
  const { busy, error, run, setError } = useSubmit();
  const load = useCallback(() => api<Data>(`/orgs/${org.id}/dishes/${dishId}${versionId ? `?versionId=${versionId}` : ''}`).then(setData).catch((e) => setError(e.message)), [org.id, dishId, versionId, setError]);
  useEffect(() => { load(); }, [load]);
  const manage = can('ttk.manage');
  useEffect(() => {
    if (!manage) return;
    api<Product[]>(`/orgs/${org.id}/products`).then(setProducts).catch(() => setProducts([]));
    api<Dish[]>(`/orgs/${org.id}/dishes`).then((d) => setSemis(d.filter((x) => x.kind === 'semi' && x.id !== dishId))).catch(() => setSemis([]));
  }, [org.id, manage, dishId]);
  if (!data) return error ? <div className="err">{error}</div> : <p className="muted">Загрузка…</p>;
  const cur = data.current, v = cur?.version;
  const draft = v?.status === 'draft' && manage;
  const act = (fn: () => Promise<unknown>) => run(async () => { await fn(); await load(); });
  const lineCost = new Map((cur?.cost?.lines || []).map((l) => [l.line_id, l]));

  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/menu`}>← Блюда и ТТК</Link></p>
      <h1 style={{ marginBottom: 4 }}>{data.dish.name}</h1>
      <p className="row" style={{ marginTop: 0 }}><span className="badge">{data.dish.kind_label}</span>{data.dish.category && <span className="badge">{data.dish.category}</span>}</p>
      {can('menu.price') && data.dish.kind === 'dish' && <Price dish={data.dish} onDone={load} />}
      {data.versions.length > 1 && (
        <div className="chips">{data.versions.map((x) => <button key={x.id} aria-pressed={v?.id === x.id} onClick={() => router.replace(`/app/${org.id}/menu/${dishId}?v=${x.id}`)}>v{x.version} · {x.status_label}</button>)}</div>
      )}
      {error && <div className="err" role="alert">{error}</div>}
      {cur && v && (
        <>
          <div className="card">
            <div className="between"><b>ТТК, версия {v.version}</b><span className={`badge ${TONE[v.status]}`}>{v.status_label}</span></div>
            <p className="small muted">{v.source}{v.change_reason ? ` · причина: ${v.change_reason}` : ''}{v.approved_at ? ` · утверждена ${dt(v.approved_at, org.timezone)}` : ''}</p>
            {v.return_note && <div className="note"><b>Возвращено на доработку:</b> {v.return_note}</div>}
            {data.archive && data.archive.issues.length > 0 && v.status === 'draft' && (
              <div className="note"><b>Замечания исходной карты:</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{data.archive.issues.map((i) => <li key={i} className="small">{i}</li>)}</ul></div>
            )}
            <Fields v={v} kind={data.dish.kind} editable={draft} onSave={(body) => act(() => api(`/orgs/${org.id}/ttk/${v.id}`, { method: 'PATCH', body }))} busy={busy} />
          </div>

          <div className="card">
            <h2>Состав{v.yield_g ? ` на выход ${n(v.yield_g)} г` : ''}</h2>
            <div className="scroll"><table className="tbl">
              <thead><tr><th>Сырьё</th><th>Ед.</th><th>Брутто</th><th>Нетто</th>{data.canSeeCost && <th>₽</th>}{draft && <th />}</tr></thead>
              <tbody>{cur.lines.map((l) => (
                <LineRow key={l.id} l={l} cost={lineCost.get(l.id)} seeCost={data.canSeeCost} editable={draft} products={products} semis={semis} busy={busy}
                  onSave={(body) => act(() => api(`/orgs/${org.id}/ttk-lines/${l.id}`, { method: 'PATCH', body }))}
                  onMatch={(body) => act(() => api(`/orgs/${org.id}/ttk-lines/${l.id}/match`, { body: { ...body, remember: true } }))}
                  onRemove={() => act(() => api(`/orgs/${org.id}/ttk-lines/${l.id}`, { method: 'DELETE' }))} />
              ))}</tbody>
            </table></div>
            {cur.lines.length === 0 && <p className="small muted">Состав не заполнен.</p>}
            {draft && <AddLine products={products} semis={semis} busy={busy} onAdd={(body) => act(() => api(`/orgs/${org.id}/ttk/${v.id}/lines`, { body }))} />}
          </div>

          {cur.cost && (
            <div className="card">
              <h2>Себестоимость</h2>
              {cur.cost.complete ? (
                <dl className="kv">
                  <dt>Закладка</dt><dd>{n(cur.cost.total)} ₽</dd>
                  {cur.cost.per_portion !== null && <><dt>Порция</dt><dd><b>{n(cur.cost.per_portion)} ₽</b></dd></>}
                  {cur.cost.per_kg !== null && <><dt>1 кг выхода</dt><dd>{n(cur.cost.per_kg)} ₽</dd></>}
                  {cur.cost.food_cost_pct !== null && <><dt>Фудкост</dt><dd><b>{n(cur.cost.food_cost_pct)} %</b> от цены {n(data.dish.sale_price)} ₽</dd></>}
                </dl>
              ) : (
                <div className="note"><b>Себестоимость неполная</b> — известно {n(cur.cost.known)} ₽, но не хватает:<ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{cur.cost.missing.map((m) => <li key={m} className="small">{m}</li>)}</ul></div>
              )}
              <p className="small muted">Цена — средневзвешенная по партиям в остатке, иначе последняя закупка. Неизвестная цена не считается нулём.</p>
            </div>
          )}

          <div className="card">
            <h2>КБЖУ на 100 г</h2>
            {cur.kbju.per100 ? <p><b>{cur.kbju.per100.kcal}</b> ккал · Б {n(cur.kbju.per100.protein)} · Ж {n(cur.kbju.per100.fat)} · У {n(cur.kbju.per100.carbs)}</p> : <p className="muted">Не рассчитано — нет выхода или ни у одного ингредиента нет данных справочника.</p>}
            {!cur.kbju.verified && <p className="small muted">Ориентировочно: по закладке нетто без потерь при тепловой обработке{cur.kbju.missing.length ? '; учтено не всё сырьё' : ''}; данные справочника не проверены специалистом. Для маркировки не использовать.</p>}
            {cur.kbju.missing.length > 0 && <ul style={{ margin: 0, paddingLeft: 18 }}>{cur.kbju.missing.map((m) => <li key={m} className="small">{m}</li>)}</ul>}
          </div>

          <Lifecycle data={data} busy={busy} act={act} onNew={() => router.replace(`/app/${org.id}/menu/${dishId}`)} />
          {data.dish.kind === 'semi' && <ReleaseChecks dishId={dishId} />}
          {data.dish.kind === 'semi' && data.versions.some((x) => x.status === 'approved') && can('production.plan') && (
            <Link className="btn block secondary" href={`/app/${org.id}/production?dish=${dishId}`}>Поставить в производство</Link>)}
        </>
      )}
    </>
  );
}

function Price({ dish, onDone }: { dish: Data['dish']; onDone: () => void }) {
  const { org } = useOrg();
  const [p, setP] = useState(dish.sale_price ? String(Number(dish.sale_price)) : '');
  const { busy, error, run } = useSubmit();
  return (
    <form className="card row" onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/orgs/${org.id}/dishes/${dish.id}`, { method: 'PATCH', body: { salePrice: p ? Number(p.replace(',', '.')) : null } }); onDone(); }); }}>
      <label htmlFor="sp" style={{ margin: 0 }}>Цена продажи, ₽</label>
      <input id="sp" inputMode="decimal" value={p} onChange={(e) => setP(e.target.value)} style={{ width: 120 }} />
      <button className="btn small secondary" disabled={busy}>Сохранить</button>
      {error && <div className="err">{error}</div>}
    </form>
  );
}

interface RCheck { id: string; name: string; unit: string; limits: string; basis: string }

/** Контроль при выпуске п/ф (ККТ): параметры с пределами и основанием; выпуск закрыт без замера в пределах. */
function ReleaseChecks({ dishId }: { dishId: string }) {
  const { org, can } = useOrg();
  const [list, setList] = useState<RCheck[]>([]);
  const [f, setF] = useState({ name: 'Температура в толще продукта', unit: '°C', min: '', max: '', basis: '' });
  const { busy, error, run } = useSubmit();
  const load = useCallback(() => api<RCheck[]>(`/orgs/${org.id}/dishes/${dishId}/release-checks`).then(setList).catch(() => setList([])), [org.id, dishId]);
  useEffect(() => { load(); }, [load]);
  const manage = can('haccp.manage');
  const num = (s: string) => (s.trim() ? s.replace(',', '.') : null);
  return (
    <div className="card">
      <h2>Контроль при выпуске (ККТ)</h2>
      <p className="small muted">Пока последний замер по каждому параметру не в пределах, партию п/ф не выпустить. Замер вне предела — отклонение ответственному ХАССП.</p>
      {list.length === 0 ? <p className="small">Параметры не заданы — п/ф выпускается без замеров.</p> : (
        <ul className="list">{list.map((c) => (
          <li key={c.id} className="between"><div><b>{c.name}</b>: {c.limits}<div className="small muted">{c.basis}</div></div>
            {manage && <button className="btn small secondary" disabled={busy} onClick={() => { const reason = prompt('Основание снятия параметра (например, новая версия плана ХАССП):'); if (reason) run(async () => { await api(`/orgs/${org.id}/release-checks/${c.id}/archive`, { body: { reason } }); await load(); }); }}>Снять</button>}
          </li>))}</ul>
      )}
      {manage && (
        <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/orgs/${org.id}/dishes/${dishId}/release-checks`, { body: { ...f, min: num(f.min), max: num(f.max) } }); setF({ ...f, min: '', max: '', basis: '' }); await load(); }); }}>
          <h3 style={{ marginTop: 12 }}>Добавить параметр</h3>
          <label htmlFor="rcn">Что измеряется</label><input id="rcn" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <div className="grid2">
            <div><label htmlFor="rcmin">Не ниже</label><input id="rcmin" inputMode="decimal" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} placeholder="75" /></div>
            <div><label htmlFor="rcmax">Не выше</label><input id="rcmax" inputMode="decimal" value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} /></div>
          </div>
          <label htmlFor="rcu">Единица</label><input id="rcu" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} />
          <label htmlFor="rcb">Основание</label><input id="rcb" required value={f.basis} onChange={(e) => setF({ ...f, basis: e.target.value })} placeholder="План ХАССП: ККТ-1, тепловая обработка" />
          {error && <div className="err">{error}</div>}
          <button className="btn block secondary" disabled={busy}>Добавить параметр</button>
        </form>
      )}
    </div>
  );
}

function Fields({ v, kind, editable, onSave, busy }: { v: Version; kind: string; editable: boolean; onSave: (b: object) => void; busy: boolean }) {
  const init = () => ({ yieldG: v.yield_g ? String(Number(v.yield_g)) : '', portionG: v.portion_g ? String(Number(v.portion_g)) : '', technology: v.technology || '', storageConditions: v.storage_conditions || '',
    shelfLife: v.shelf_life || '', quality: v.quality || '', allergens: v.allergens || '', shelfLifeHours: v.shelf_life_hours ? String(Number(v.shelf_life_hours)) : '' });
  const [f, setF] = useState(init);
  useEffect(() => { setF(init()); }, [v.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!editable) {
    return (
      <dl className="kv small">
        <dt>Выход</dt><dd>{v.yield_g ? `${n(v.yield_g)} г` : '—'}{v.portion_g ? ` · порция ${n(v.portion_g)} г` : ''}</dd>
        <dt>Технология</dt><dd style={{ whiteSpace: 'pre-line' }}>{v.technology || '—'}</dd>
        <dt>Хранение</dt><dd>{v.storage_conditions || '—'}</dd>
        <dt>Срок</dt><dd>{v.shelf_life || '—'}</dd>
        {kind === 'semi' && <><dt>Срок партии</dt><dd>{v.shelf_life_hours ? `${n(v.shelf_life_hours)} ч от выпуска` : 'не задан — партия п/ф получит «срок не подтверждён»'}</dd></>}
        {v.quality && <><dt>Качество</dt><dd>{v.quality}</dd></>}
        {v.allergens && <><dt>Аллергены</dt><dd>{v.allergens}</dd></>}
      </dl>
    );
  }
  const num = (s: string) => (s ? Number(s.replace(',', '.')) : null);
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ ...f, yieldG: num(f.yieldG), portionG: num(f.portionG), quality: f.quality || null, allergens: f.allergens || null, shelfLifeHours: num(f.shelfLifeHours) }); }}>
      <div className="grid2">
        <div><label htmlFor="yg">Выход закладки, г</label><input id="yg" inputMode="decimal" value={f.yieldG} onChange={(e) => setF({ ...f, yieldG: e.target.value })} /></div>
        {kind === 'dish' && <div><label htmlFor="pg">Выход порции, г</label><input id="pg" inputMode="decimal" value={f.portionG} onChange={(e) => setF({ ...f, portionG: e.target.value })} /></div>}
      </div>
      <label htmlFor="tc">Технология приготовления</label>
      <textarea id="tc" rows={5} value={f.technology} onChange={(e) => setF({ ...f, technology: e.target.value })} />
      <div className="grid2">
        <div><label htmlFor="sc">Условия хранения</label><input id="sc" value={f.storageConditions} onChange={(e) => setF({ ...f, storageConditions: e.target.value })} placeholder="например, при +2…+6 °C" /></div>
        <div><label htmlFor="sl">Срок годности (реализации)</label><input id="sl" value={f.shelfLife} onChange={(e) => setF({ ...f, shelfLife: e.target.value })} placeholder="по утверждённому основанию" /></div>
        <div><label htmlFor="ql">Показатели качества</label><input id="ql" value={f.quality} onChange={(e) => setF({ ...f, quality: e.target.value })} /></div>
        <div><label htmlFor="al">Аллергены</label><input id="al" value={f.allergens} onChange={(e) => setF({ ...f, allergens: e.target.value })} /></div>
        {kind === 'semi' && <div><label htmlFor="slh">Срок партии п/ф, ч от выпуска</label><input id="slh" inputMode="decimal" value={f.shelfLifeHours} onChange={(e) => setF({ ...f, shelfLifeHours: e.target.value })} placeholder="по утверждённому основанию" /></div>}
      </div>
      <button className="btn block secondary" disabled={busy}>Сохранить</button>
    </form>
  );
}

function Pick({ value, onChange, products, semis, id }: { value: string; onChange: (v: string) => void; products: Product[]; semis: Dish[]; id: string }) {
  return (
    <select id={id} aria-label="Товар или полуфабрикат" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— выберите —</option>
      {semis.length > 0 && <optgroup label="Полуфабрикаты">{semis.map((s) => <option key={s.id} value={`s:${s.id}`}>{s.name}</option>)}</optgroup>}
      <optgroup label="Товары">{products.map((p) => <option key={p.id} value={`p:${p.id}`}>{p.name} ({p.unit})</option>)}</optgroup>
    </select>
  );
}
const refBody = (pick: string) => (pick.startsWith('s:') ? { subDishId: pick.slice(2), productId: null } : { productId: pick.slice(2), subDishId: null });

function LineRow({ l, cost, seeCost, editable, products, semis, busy, onSave, onMatch, onRemove }: { l: Line; cost?: Cost['lines'][number]; seeCost: boolean; editable: boolean; products: Product[]; semis: Dish[]; busy: boolean;
  onSave: (b: object) => void; onMatch: (b: object) => void; onRemove: () => void }) {
  const [edit, setEdit] = useState<{ unit: string; brutto: string; netto: string } | null>(null);
  const [pick, setPick] = useState('');
  const target = l.product_name ? `${l.product_name}` : l.sub_dish_name ? `п/ф: ${l.sub_dish_name}` : null;
  return (
    <tr>
      <td>{l.name_raw}{target && target !== l.name_raw && <div className="small muted">→ {target}</div>}
        {!target && (editable ? (
          <div className="row" style={{ marginTop: 4 }}><Pick id={`m-${l.id}`} value={pick} onChange={setPick} products={products} semis={semis} />
            <button className="btn small" disabled={busy || !pick} onClick={() => onMatch(refBody(pick))}>OK</button></div>
        ) : <div><span className="badge crit">не сопоставлено</span></div>)}
        {l.note && <div className="small muted">{l.note}</div>}</td>
      {edit ? (
        <>
          <td><select aria-label="Единица" value={edit.unit} onChange={(e) => setEdit({ ...edit, unit: e.target.value })} style={{ width: 80 }}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select></td>
          <td><input aria-label="Брутто" inputMode="decimal" value={edit.brutto} onChange={(e) => setEdit({ ...edit, brutto: e.target.value })} style={{ width: 80 }} /></td>
          <td><input aria-label="Нетто" inputMode="decimal" value={edit.netto} onChange={(e) => setEdit({ ...edit, netto: e.target.value })} style={{ width: 80 }} /></td>
        </>
      ) : <><td>{l.unit}</td><td>{n(l.brutto)}</td><td>{n(l.netto)}</td></>}
      {seeCost && <td title={cost?.source || ''}>{cost?.cost != null ? n(cost.cost) : '—'}</td>}
      {editable && <td style={{ whiteSpace: 'nowrap' }}>{edit ? (
        <><button className="btn small" disabled={busy} onClick={() => { onSave({ unit: edit.unit, brutto: edit.brutto ? Number(edit.brutto.replace(',', '.')) : null, netto: edit.netto ? Number(edit.netto.replace(',', '.')) : null }); setEdit(null); }}>OK</button>
          <button className="btn small secondary" onClick={() => setEdit(null)}>×</button></>
      ) : (
        <><button className="btn small secondary" onClick={() => setEdit({ unit: l.unit, brutto: l.brutto ? String(Number(l.brutto)) : '', netto: l.netto ? String(Number(l.netto)) : '' })} aria-label={`Изменить ${l.name_raw}`}>✎</button>
          <button className="btn small secondary" disabled={busy} onClick={() => { if (confirm(`Удалить «${l.name_raw}»?`)) onRemove(); }} aria-label={`Удалить ${l.name_raw}`}>🗑</button></>
      )}</td>}
    </tr>
  );
}

function AddLine({ products, semis, busy, onAdd }: { products: Product[]; semis: Dish[]; busy: boolean; onAdd: (b: object) => void }) {
  const [f, setF] = useState({ pick: '', unit: 'г', brutto: '', netto: '' });
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!f.pick) return; onAdd({ ...refBody(f.pick), unit: f.unit, brutto: f.brutto ? Number(f.brutto.replace(',', '.')) : null, netto: f.netto ? Number(f.netto.replace(',', '.')) : null }); setF({ pick: '', unit: f.unit, brutto: '', netto: '' }); }}>
      <h3>Добавить строку</h3>
      <Pick id="al-pick" value={f.pick} onChange={(pick) => setF({ ...f, pick })} products={products} semis={semis} />
      <div className="grid2" style={{ marginTop: 6 }}>
        <div><label htmlFor="al-u">Единица</label><select id="al-u" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select></div>
        <div><label htmlFor="al-b">Брутто</label><input id="al-b" inputMode="decimal" value={f.brutto} onChange={(e) => setF({ ...f, brutto: e.target.value })} /></div>
        <div><label htmlFor="al-n">Нетто</label><input id="al-n" inputMode="decimal" value={f.netto} onChange={(e) => setF({ ...f, netto: e.target.value })} /></div>
      </div>
      <button className="btn block secondary" disabled={busy || !f.pick}>Добавить</button>
    </form>
  );
}

function Lifecycle({ data, busy, act, onNew }: { data: Data; busy: boolean; act: (fn: () => Promise<unknown>) => void; onNew: () => void }) {
  const { org, can } = useOrg();
  const v = data.current!.version, blockers = data.current!.blockers;
  const [note, setNote] = useState('');
  const [reason, setReason] = useState<string | null>(null);
  const hasOpen = data.versions.some((x) => x.status === 'draft' || x.status === 'review');
  return (
    <div className="card">
      <h2>Согласование</h2>
      {data.current!.warnings.map((w) => <div key={w} className="note small">{w}</div>)}
      {v.status === 'draft' && (blockers.length ? (
        <div className="note"><b>Чтобы отправить на согласование, осталось:</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{blockers.map((b) => <li key={b} className="small">{b}</li>)}</ul></div>
      ) : <div className="okbox">Всё заполнено — можно отправлять на согласование.</div>)}
      {v.status === 'draft' && can('ttk.manage') && <button className="btn block" disabled={busy || blockers.length > 0} onClick={() => act(() => api(`/orgs/${org.id}/ttk/${v.id}/submit`, { body: {} }))}>Отправить на согласование</button>}
      {v.status === 'review' && (can('ttk.approve') ? (
        <>
          <button className="btn block" disabled={busy} onClick={() => act(() => api(`/orgs/${org.id}/ttk/${v.id}/approve`, { body: {} }))}>Утвердить версию {v.version}</button>
          <label htmlFor="rn">Или вернуть на доработку</label>
          <input id="rn" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Что доработать" />
          <button className="btn block secondary" disabled={busy || note.trim().length < 5} onClick={() => act(() => api(`/orgs/${org.id}/ttk/${v.id}/return`, { body: { note } }))}>Вернуть</button>
        </>
      ) : <p className="small muted">На согласовании у шефа, технолога или руководителя.</p>)}
      {(v.status === 'approved' || v.status === 'archived') && can('ttk.manage') && !hasOpen && (reason === null
        ? <button className="btn block secondary" onClick={() => setReason('')}>Изменить — новая версия</button>
        : (
          <form onSubmit={(e) => { e.preventDefault(); act(async () => { await api(`/orgs/${org.id}/dishes/${data.dish.id}/versions`, { body: { changeReason: reason } }); onNew(); }); }}>
            <label htmlFor="cr">Причина изменения</label><input id="cr" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="новый поставщик, изменение выхода, замена сырья" />
            <button className="btn block" disabled={busy}>Создать черновик новой версии</button>
            <p className="small muted">Утверждённая версия продолжает действовать, пока новая не утверждена.</p>
          </form>
        ))}
    </div>
  );
}
