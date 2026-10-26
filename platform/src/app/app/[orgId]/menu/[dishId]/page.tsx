'use client';
import { Suspense, use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { dt, n } from '@/lib/fmt';
import { chain, type From } from '@/server/recipes/chain';

interface Line { id: string; position: number; name_raw: string; product_id: string | null; sub_dish_id: string | null; product_name: string | null; product_unit: string | null; sub_dish_name: string | null;
  kind: 'item' | 'heading'; unit: string; brutto: string | null; netto: string | null; ready: string | null; in_yield: boolean; calc_from: From | null; note: string | null; steps: Step[] }
interface Step { method_code: string; method_name: string; kind: 'cold' | 'thermal'; loss_pct: number; norm_id: string | null; basis: string }
interface Method { code: string; name: string; kind: 'cold' | 'thermal' }
interface TodayNorm { id: string; loss_pct: number; basis: string; season: string }
interface Version { id: string; version: number; status: string; status_label: string; card_date: string | null; semi_yield_g: string | null;
  organoleptic: { appearance?: string | null; color?: string | null; consistency?: string | null; taste?: string | null } | null; serving: string | null; menu_description: string | null; yield_g: string | null; portion_g: string | null; technology: string | null; storage_conditions: string | null;
  shelf_life: string | null; shelf_life_hours: string | null; quality: string | null; allergens: string | null; source: string; change_reason: string | null; return_note: string | null; approved_at: string | null }
interface Cost { total: number | null; known: number; complete: boolean; missing: string[]; per_portion: number | null; per_kg: number | null; food_cost_pct: number | null;
  lines: { line_id: string; cost: number | null; price: number | null; price_unit: string | null; source: string | null }[] }
interface Kbju { per100: { kcal: number; protein: number; fat: number; carbs: number } | null; complete: boolean; verified: boolean; missing: string[]; losses: 'none' | 'partial' | 'all' }
interface Data { dish: { id: string; name: string; kind: string; kind_label: string; category: string | null; sale_price: string | null; card_no: string | null };
  versions: { id: string; version: number; status: string; status_label: string; approved_at: string | null; approved_by_name: string | null }[];
  current: { version: Version; lines: Line[]; blockers: string[]; warnings: string[]; cost: Cost | null; kbju: Kbju; output: { netto_g: number | null; ready_g: number | null; sections: { list: { title: string | null; ready_g: number | null }[]; label: string } | null } } | null;
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
  const [methods, setMethods] = useState<Method[]>([]);
  const [stepsFor, setStepsFor] = useState<string | null>(null);
  const { busy, error, run, setError } = useSubmit();
  const load = useCallback(() => api<Data>(`/orgs/${org.id}/dishes/${dishId}${versionId ? `?versionId=${versionId}` : ''}`).then(setData).catch((e) => setError(e.message)), [org.id, dishId, versionId, setError]);
  useEffect(() => { load(); }, [load]);
  const manage = can('ttk.manage');
  useEffect(() => {
    if (!manage) return;
    api<Product[]>(`/orgs/${org.id}/products`).then(setProducts).catch(() => setProducts([]));
    api<Method[]>(`/orgs/${org.id}/processing/methods`).then(setMethods).catch(() => setMethods([]));
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
            <div className="between"><b>Рецептура № {data.dish.card_no || '—'}{v.card_date ? ` от ${v.card_date.slice(0, 10).split('-').reverse().join('.')}` : ''} · версия {v.version}</b><span className={`badge ${TONE[v.status]}`}>{v.status_label}</span></div>
            {can('ttk.manage') && <CardNo dish={data.dish} onDone={load} />}
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
              <thead><tr><th>Сырьё</th><th>Ед.</th><th>Брутто</th><th>Нетто</th><th>Выход</th>{data.canSeeCost && <th>₽</th>}{draft && <th />}</tr></thead>
              <tbody>{cur.lines.map((l, i) => l.kind === 'heading' ? (
                <HeadingRow key={l.id} l={l} cols={5 + (data.canSeeCost ? 1 : 0)} editable={draft} busy={busy}
                  onRename={(title) => act(() => api(`/orgs/${org.id}/ttk-lines/${l.id}/heading`, { method: 'PATCH', body: { title } }))}
                  onMove={(dir) => act(() => api(`/orgs/${org.id}/ttk-lines/${l.id}/move`, { body: { dir } }))} first={i === 0} last={i === cur.lines.length - 1}
                  onRemove={() => act(() => api(`/orgs/${org.id}/ttk-lines/${l.id}`, { method: 'DELETE' }))} />
              ) : (
                <LineRow first={i === 0} last={i === cur.lines.length - 1} onMove={(dir) => act(() => api(`/orgs/${org.id}/ttk-lines/${l.id}/move`, { body: { dir } }))} key={l.id} l={l} cost={lineCost.get(l.id)} seeCost={data.canSeeCost} editable={draft} products={products} semis={semis} busy={busy}
                  onSave={(body) => act(() => api(`/orgs/${org.id}/ttk-lines/${l.id}`, { method: 'PATCH', body }))}
                  stepsOpen={stepsFor === l.id} onToggleSteps={() => setStepsFor(stepsFor === l.id ? null : l.id)}
                  onMatch={(body) => act(() => api(`/orgs/${org.id}/ttk-lines/${l.id}/match`, { body: { ...body, remember: true } }))}
                  onRemove={() => act(() => api(`/orgs/${org.id}/ttk-lines/${l.id}`, { method: 'DELETE' }))} />
              ))}</tbody>
            </table></div>
            {draft && stepsFor && cur.lines.some((l) => l.id === stepsFor) && (
              <StepsEditor key={stepsFor} l={cur.lines.find((l) => l.id === stepsFor)!} methods={methods} busy={busy} onClose={() => setStepsFor(null)}
                onSave={(body) => act(async () => { await api(`/orgs/${org.id}/ttk-lines/${stepsFor}/steps`, { body }); setStepsFor(null); })} />
            )}
            {cur.lines.length === 0 && <p className="small muted">Состав не заполнен.</p>}
            {cur.output.sections && <p><b>Выход по разделам: {cur.output.sections.label} г</b> <span className="small muted">({cur.output.sections.list.map((x) => `${x.title || 'без подзаголовка'} — ${x.ready_g === null ? '?' : x.ready_g}`).join('; ')})</span></p>}
            {cur.lines.length > 0 && <p className="small">Сумма нетто: {cur.output.netto_g !== null ? `${n(cur.output.netto_g)} г` : '—'} · выход по обработке сырья: {cur.output.ready_g !== null ? `${n(cur.output.ready_g)} г` : 'не по всем строкам'}</p>}
            <p className="small muted">Брутто → холодная обработка → нетто → тепловая → выход. Нормы — в разделе <Link href={`/app/${org.id}/menu/processing`}>«Обработка сырья»</Link>; ингредиенты без отметки «в выходе» (соль, специи) в выход и КБЖУ не входят.</p>
            {draft && <AddLine products={products} semis={semis} busy={busy} onAdd={(body) => act(() => api(`/orgs/${org.id}/ttk/${v.id}/lines`, { body }))} />}
            {draft && <div className="row" style={{ marginTop: 8 }}>
              <button className="btn small secondary" disabled={busy} onClick={() => { const title = prompt('Подзаголовок (например, «Выход жареного мяса — 120 г»):'); if (title) act(() => api(`/orgs/${org.id}/ttk/${v.id}/headings`, { body: { title } })); }}>+ подзаголовок</button>
              <InsertFrom dishId={dishId} busy={busy} onPick={(id) => act(() => api(`/orgs/${org.id}/ttk/${v.id}/insert`, { body: { dishId: id } }))} />
            </div>}
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
            {!cur.kbju.verified && <p className="small muted">Ориентировочно: по закладке нетто{cur.kbju.losses === 'all' ? ' с потерями нутриентов по нормам тепловой обработки' : cur.kbju.losses === 'partial' ? '; потери нутриентов при тепловой обработке заданы не для всех строк' : ' без потерь нутриентов при тепловой обработке'}{cur.kbju.missing.length ? '; учтено не всё сырьё' : ''}; данные справочника не проверены специалистом. Для маркировки не использовать.</p>}
            {cur.kbju.missing.length > 0 && <ul style={{ margin: 0, paddingLeft: 18 }}>{cur.kbju.missing.map((m) => <li key={m} className="small">{m}</li>)}</ul>}
          </div>

          <Lifecycle data={data} busy={busy} act={act} onNew={() => router.replace(`/app/${org.id}/menu/${dishId}`)} />
          <Link className="btn block" href={`/app/${org.id}/menu/${dishId}/ttk-docs?v=${v.id}`}>Документы ТТК: карта по ГОСТ 31987, обоснование расчётов</Link>
          <Link className="btn block secondary" href={`/app/${org.id}/menu/${dishId}/acts`}>Акты контрольной проработки</Link>
          {data.versions.some((x) => x.status === 'approved') && can('cost.read') && <Link className="btn block secondary" href={`/app/${org.id}/menu/${dishId}/costing`}>Калькуляционная карточка (ОП-1)</Link>}
          {data.versions.some((x) => x.status === 'approved') && <Link className="btn block secondary" href={`/app/${org.id}/menu/${dishId}/tu`}>Технические условия (ТУ)</Link>}
          {data.versions.some((x) => x.status === 'approved') && <Link className="btn block secondary" href={`/app/${org.id}/menu/${dishId}/ti`}>Технологическая инструкция (ТИ)</Link>}
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
    shelfLife: v.shelf_life || '', quality: v.quality || '', allergens: v.allergens || '', shelfLifeHours: v.shelf_life_hours ? String(Number(v.shelf_life_hours)) : '',
    cardDate: v.card_date ? v.card_date.slice(0, 10) : '', semiYieldG: v.semi_yield_g ? String(Number(v.semi_yield_g)) : '',
    appearance: v.organoleptic?.appearance || '', color: v.organoleptic?.color || '', consistency: v.organoleptic?.consistency || '', taste: v.organoleptic?.taste || '',
    serving: v.serving || '', menuDescription: v.menu_description || '' });
  const [f, setF] = useState(init);
  useEffect(() => { setF(init()); }, [v.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!editable) {
    return (
      <dl className="kv small">
        <dt>Выход</dt><dd>{v.yield_g ? `${n(v.yield_g)} г` : '—'}{v.portion_g ? ` · порция ${n(v.portion_g)} г` : ''}{Number(v.semi_yield_g) > 0 ? ` · п/ф ${n(v.semi_yield_g)} г` : ''}</dd>
        <dt>Технология</dt><dd style={{ whiteSpace: 'pre-line' }}>{v.technology || '—'}</dd>
        <dt>Хранение</dt><dd>{v.storage_conditions || '—'}</dd>
        <dt>Срок</dt><dd>{v.shelf_life || '—'}</dd>
        {kind === 'semi' && <><dt>Срок партии</dt><dd>{v.shelf_life_hours ? `${n(v.shelf_life_hours)} ч от выпуска` : 'не задан — партия п/ф получит «срок не подтверждён»'}</dd></>}
        {v.quality && <><dt>Качество</dt><dd>{v.quality}</dd></>}
        {v.serving && <><dt>Подача</dt><dd>{v.serving}</dd></>}
        {v.organoleptic && Object.values(v.organoleptic).some(Boolean) && <><dt>Органолептика</dt><dd>{[['Внешний вид', v.organoleptic.appearance], ['Цвет', v.organoleptic.color], ['Консистенция', v.organoleptic.consistency], ['Вкус и запах', v.organoleptic.taste]].filter(([, x]) => x).map(([k, x]) => `${k}: ${x}`).join('; ')}</dd></>}
        {v.allergens && <><dt>Аллергены</dt><dd>{v.allergens}</dd></>}
      </dl>
    );
  }
  const num = (s: string) => (s ? Number(s.replace(',', '.')) : null);
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ ...f, yieldG: num(f.yieldG), portionG: num(f.portionG), quality: f.quality || null, allergens: f.allergens || null, shelfLifeHours: num(f.shelfLifeHours), cardDate: f.cardDate || undefined, semiYieldG: num(f.semiYieldG),
      organoleptic: { appearance: f.appearance || null, color: f.color || null, consistency: f.consistency || null, taste: f.taste || null }, serving: f.serving || null, menuDescription: f.menuDescription || null }); }}>
      <div className="grid2">
        <div><label htmlFor="cd">Дата рецептуры</label><input id="cd" type="date" value={f.cardDate} onChange={(e) => setF({ ...f, cardDate: e.target.value })} /></div>
        <div><label htmlFor="syg">Выход п/ф, г</label><input id="syg" inputMode="decimal" value={f.semiYieldG} onChange={(e) => setF({ ...f, semiYieldG: e.target.value })} placeholder="0 — без п/ф" /></div>
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
      <label htmlFor="sv">Подача (оформление, температура подачи)</label><textarea id="sv" rows={2} value={f.serving} onChange={(e) => setF({ ...f, serving: e.target.value })} />
      <h3 style={{ marginTop: 10 }}>Органолептические показатели (для ТТК)</h3>
      <div className="grid2">
        <div><label htmlFor="oa">Внешний вид</label><textarea id="oa" rows={2} value={f.appearance} onChange={(e) => setF({ ...f, appearance: e.target.value })} /></div>
        <div><label htmlFor="oc">Цвет</label><textarea id="oc" rows={2} value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} /></div>
        <div><label htmlFor="ok">Консистенция</label><textarea id="ok" rows={2} value={f.consistency} onChange={(e) => setF({ ...f, consistency: e.target.value })} /></div>
        <div><label htmlFor="ot">Вкус и запах</label><textarea id="ot" rows={2} value={f.taste} onChange={(e) => setF({ ...f, taste: e.target.value })} /></div>
      </div>
      <label htmlFor="md">Описание для меню (информационный лист)</label><textarea id="md" rows={2} value={f.menuDescription} onChange={(e) => setF({ ...f, menuDescription: e.target.value })} />
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

/** Подзаголовок рецептуры: делит состав на разделы, выход каждого — через «/». */
function HeadingRow({ l, cols, editable, busy, onRename, onMove, onRemove, first, last }: { l: Line; cols: number; editable: boolean; busy: boolean; onRename: (t: string) => void;
  onMove: (dir: 'up' | 'down') => void; onRemove: () => void; first: boolean; last: boolean }) {
  return (
    <tr className="heading">
      <td colSpan={cols} style={{ background: 'var(--bg2, #f6efe4)' }}><b>{l.name_raw}</b></td>
      {editable && <td style={{ whiteSpace: 'nowrap', background: 'var(--bg2, #f6efe4)' }}>
        <button className="btn small secondary" disabled={busy} onClick={() => { const t = prompt('Подзаголовок:', l.name_raw); if (t) onRename(t); }} aria-label={`Переименовать ${l.name_raw}`}>✎</button>
        <button className="btn small secondary" disabled={busy || first} onClick={() => onMove('up')} aria-label={`Выше ${l.name_raw}`}>↑</button>
        <button className="btn small secondary" disabled={busy || last} onClick={() => onMove('down')} aria-label={`Ниже ${l.name_raw}`}>↓</button>
        <button className="btn small secondary" disabled={busy} onClick={() => { if (confirm(`Удалить подзаголовок «${l.name_raw}»?`)) onRemove(); }} aria-label={`Удалить ${l.name_raw}`}>🗑</button>
      </td>}
    </tr>
  );
}

/** Вставить весь состав другой рецептуры (однотипные блюда: тот же салат с другой заправкой). */
function InsertFrom({ dishId, busy, onPick }: { dishId: string; busy: boolean; onPick: (id: string) => void }) {
  const { org } = useOrg();
  const [list, setList] = useState<Dish[] | null>(null);
  const [id, setId] = useState('');
  if (!list) return <button className="btn small secondary" onClick={() => api<Dish[]>(`/orgs/${org.id}/dishes`).then((d) => setList(d.filter((x) => x.id !== dishId))).catch(() => setList([]))}>Вставить из рецептуры…</button>;
  return (
    <span className="row">
      <select aria-label="Рецептура для вставки" value={id} onChange={(e) => setId(e.target.value)} style={{ maxWidth: 240 }}>
        <option value="">— рецептура —</option>{list.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <button className="btn small" disabled={busy || !id} onClick={() => { onPick(id); setList(null); setId(''); }}>Вставить</button>
    </span>
  );
}

function CardNo({ dish, onDone }: { dish: Data['dish']; onDone: () => void }) {
  const { org } = useOrg();
  const { busy, error, run } = useSubmit();
  return (
    <p className="small" style={{ margin: '4px 0' }}>
      <button className="btn small secondary" disabled={busy} onClick={() => { const no = prompt('Номер рецептуры (ТТК № …):', dish.card_no || ''); if (no) run(async () => { await api(`/orgs/${org.id}/dishes/${dish.id}`, { method: 'PATCH', body: { cardNo: no } }); onDone(); }); }}>Изменить номер</button>
      {error && <span className="err">{error}</span>}
    </p>
  );
}

const dec = (v: string | null) => (v === null || v === '' ? '' : String(Number(v)));
const num = (v: string) => (v.trim() ? Number(v.replace(',', '.')) : null);
const pctLabel = (s: { kind: string; loss_pct: number }) => (s.loss_pct < 0 ? `+${n(-s.loss_pct)} %` : `−${n(s.loss_pct)} %`);

function LineRow({ l, cost, seeCost, editable, products, semis, busy, stepsOpen, onToggleSteps, onSave, onMatch, onRemove, onMove, first, last }: { l: Line; cost?: Cost['lines'][number]; seeCost: boolean; editable: boolean; products: Product[]; semis: Dish[];
  busy: boolean; stepsOpen: boolean; onToggleSteps: () => void; onSave: (b: object) => void; onMatch: (b: object) => void; onRemove: () => void; onMove: (dir: 'up' | 'down') => void; first: boolean; last: boolean }) {
  const [edit, setEdit] = useState<{ unit: string; brutto: string; netto: string; ready: string; inYield: boolean } | null>(null);
  const [pick, setPick] = useState('');
  const target = l.product_name ? `${l.product_name}` : l.sub_dish_name ? `п/ф: ${l.sub_dish_name}` : null;
  return (
      <tr>
        <td>{l.name_raw}{target && target !== l.name_raw && <div className="small muted">→ {target}</div>}
          {!target && (editable ? (
            <div className="row" style={{ marginTop: 4 }}><Pick id={`m-${l.id}`} value={pick} onChange={setPick} products={products} semis={semis} />
              <button className="btn small" disabled={busy || !pick} onClick={() => onMatch(refBody(pick))}>OK</button></div>
          ) : <div><span className="badge crit">не сопоставлено</span></div>)}
          {l.steps.length > 0 && <div className="small" title={l.steps.map((s) => `${s.method_name}: ${s.basis}`).join('\n')}>{l.steps.map((s) => `${s.method_name.toLowerCase()} ${pctLabel(s)}`).join(' → ')}</div>}
          {!l.in_yield && <div className="small muted">не входит в выход</div>}
          {l.note && <div className="small muted">{l.note}</div>}</td>
        {edit ? (
          <>
            <td><select aria-label="Единица" value={edit.unit} onChange={(e) => setEdit({ ...edit, unit: e.target.value })} style={{ width: 80 }}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select></td>
            <td><input aria-label="Брутто" inputMode="decimal" value={edit.brutto} onChange={(e) => setEdit({ ...edit, brutto: e.target.value })} style={{ width: 80 }} /></td>
            <td><input aria-label="Нетто" inputMode="decimal" value={edit.netto} onChange={(e) => setEdit({ ...edit, netto: e.target.value })} style={{ width: 80 }} /></td>
            <td><input aria-label="Выход" inputMode="decimal" value={edit.ready} onChange={(e) => setEdit({ ...edit, ready: e.target.value })} style={{ width: 80 }} />
              <label className="small row" style={{ margin: '4px 0 0', fontWeight: 400 }}><input type="checkbox" checked={edit.inYield} onChange={(e) => setEdit({ ...edit, inYield: e.target.checked })} style={{ width: 22, minHeight: 22 }} /> <span style={{ flex: 1 }}>в выходе</span></label></td>
          </>
        ) : <><td>{l.unit}</td><td>{n(l.brutto)}</td><td>{n(l.netto)}</td><td>{l.in_yield ? n(l.ready) : '—'}</td></>}
        {seeCost && <td title={cost?.source || ''}>{cost?.cost != null ? n(cost.cost) : '—'}</td>}
        {editable && <td style={{ whiteSpace: 'nowrap' }}>{edit ? (
          <><button className="btn small" disabled={busy} onClick={() => { onSave({ unit: edit.unit, brutto: num(edit.brutto), netto: num(edit.netto), ready: num(edit.ready), inYield: edit.inYield }); setEdit(null); }}>OK</button>
            <button className="btn small secondary" onClick={() => setEdit(null)}>×</button>
            <button className="btn small secondary" disabled={busy || first} onClick={() => onMove('up')} aria-label={`Выше ${l.name_raw}`}>↑</button>
            <button className="btn small secondary" disabled={busy || last} onClick={() => onMove('down')} aria-label={`Ниже ${l.name_raw}`}>↓</button></>
        ) : (
          <><button className="btn small secondary" onClick={() => setEdit({ unit: l.unit, brutto: dec(l.brutto), netto: dec(l.netto), ready: dec(l.ready), inYield: l.in_yield })} aria-label={`Изменить ${l.name_raw}`}>✎</button>
            {(l.product_id || l.sub_dish_id) && !['шт', 'порция'].includes(l.unit) && <button className="btn small secondary" aria-pressed={stepsOpen} onClick={onToggleSteps} aria-label={`Обработка ${l.name_raw}`}>⚙</button>}
            <button className="btn small secondary" disabled={busy} onClick={() => { if (confirm(`Удалить «${l.name_raw}»?`)) onRemove(); }} aria-label={`Удалить ${l.name_raw}`}>🗑</button></>
        )}</td>}
      </tr>
  );
}

interface Draft { method: string; manual: boolean; lossPct: string; basis: string }

/** Шаги обработки строки: процент — по утверждённой норме товара (сегодня, по сезону) или вручную с основанием. */
function StepsEditor({ l, methods, busy, onSave, onClose }: { l: Line; methods: Method[]; busy: boolean; onSave: (b: object) => void; onClose: () => void }) {
  const { org } = useOrg();
  const [norms, setNorms] = useState<Record<string, TodayNorm>>({});
  const [list, setList] = useState<Draft[]>(() => l.steps.map((s) => ({ method: s.method_code, manual: !s.norm_id, lossPct: s.norm_id ? '' : String(s.loss_pct), basis: s.norm_id ? '' : s.basis })));
  // при смене обработки выход строки сохраняется (как в Шеф Эксперте); выхода нет — считаем от нетто
  const [from, setFrom] = useState<From>(l.ready !== null && Number(l.ready) > 0 ? 'ready' : l.calc_from || (l.netto !== null ? 'netto' : 'brutto'));
  const [value, setValue] = useState(() => dec(l[from === 'ready' ? 'ready' : from]));
  useEffect(() => {
    if (l.product_id) api<{ norms: Record<string, TodayNorm> }>(`/orgs/${org.id}/processing/today?productId=${l.product_id}`).then((r) => setNorms(r.norms)).catch(() => setNorms({}));
  }, [org.id, l.product_id]);
  const kindOf = (code: string) => methods.find((m) => m.code === code)?.kind || 'cold';
  const pctOf = (d: Draft) => (d.manual || !norms[d.method] ? num(d.lossPct) : norms[d.method].loss_pct);
  const ready = list.every((d) => d.method && pctOf(d) !== null);
  const preview = ready && num(value) ? chain(list.map((d) => ({ kind: kindOf(d.method), loss_pct: pctOf(d)! })), from, num(value)!) : null;
  const set = (i: number, p: Partial<Draft>) => setList(list.map((d, j) => (j === i ? { ...d, ...p } : d)));
  return (
    <div className="note" style={{ margin: '4px 0' }}>
      <b>Обработка: {l.product_name || l.sub_dish_name || l.name_raw}</b>
      {list.length === 0 && <p className="small muted" style={{ margin: '4px 0' }}>Без обработки — брутто, нетто и выход вводятся вручную.</p>}
      {list.map((d, i) => {
        const nm = norms[d.method];
        return (
          <div key={i} style={{ borderTop: '1px solid var(--line, #ddd)', paddingTop: 6, marginTop: 6 }}>
            <div className="row">
              <select aria-label={`Шаг ${i + 1}`} value={d.method} onChange={(e) => set(i, { method: e.target.value })} style={{ flex: 2 }}>
                <option value="">— способ —</option>
                <optgroup label="Холодная">{methods.filter((m) => m.kind === 'cold').map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</optgroup>
                <optgroup label="Тепловая">{methods.filter((m) => m.kind === 'thermal').map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</optgroup>
              </select>
              <button type="button" className="btn small secondary" disabled={i === 0} onClick={() => { const x = [...list]; [x[i - 1], x[i]] = [x[i], x[i - 1]]; setList(x); }} aria-label="Выше">↑</button>
              <button type="button" className="btn small secondary" onClick={() => setList(list.filter((_, j) => j !== i))} aria-label="Убрать шаг">×</button>
            </div>
            {d.method && (nm && !d.manual ? (
              <div className="small">по норме: {nm.loss_pct < 0 ? `привар ${n(-nm.loss_pct)}` : n(nm.loss_pct)} % · {nm.season} · {nm.basis} <button type="button" className="btn small secondary" onClick={() => set(i, { manual: true })}>вручную</button></div>
            ) : (
              <div className="grid2">
                <div><label htmlFor={`sp-${l.id}-${i}`}>{nm ? 'Процент вручную' : 'Нормы нет — процент'}</label><input id={`sp-${l.id}-${i}`} inputMode="decimal" value={d.lossPct} onChange={(e) => set(i, { lossPct: e.target.value })} placeholder="привар — со знаком минус" /></div>
                <div><label htmlFor={`sb-${l.id}-${i}`}>Основание</label><input id={`sb-${l.id}-${i}`} value={d.basis} onChange={(e) => set(i, { basis: e.target.value })} placeholder="акт контрольной проработки № …" /></div>
                {nm && <button type="button" className="btn small secondary" onClick={() => set(i, { manual: false })}>по норме</button>}
              </div>
            ))}
          </div>
        );
      })}
      <button type="button" className="btn small secondary" style={{ marginTop: 6 }} onClick={() => setList([...list, { method: '', manual: false, lossPct: '', basis: '' }])}>+ шаг обработки</button>
      <div className="grid2" style={{ marginTop: 8 }}>
        <div><label htmlFor={`sf-${l.id}`}>Считать от</label>
          <select id={`sf-${l.id}`} value={from} onChange={(e) => { const f = e.target.value as From; setFrom(f); setValue(dec(l[f])); }}>
            <option value="brutto">брутто</option><option value="netto">нетто</option><option value="ready">выхода</option>
          </select></div>
        <div><label htmlFor={`sv-${l.id}`}>Количество, {l.unit}</label><input id={`sv-${l.id}`} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></div>
      </div>
      {preview && <p className="small"><b>Брутто {n(preview.brutto)} → нетто {n(preview.netto)} → выход {n(preview.ready)} {l.unit}</b></p>}
      <div className="row">
        <button type="button" className="btn small" disabled={busy || !ready || !num(value)} onClick={() => onSave({ steps: list.map((d) => (d.manual || !norms[d.method] ? { method: d.method, lossPct: num(d.lossPct), basis: d.basis || null } : { method: d.method, normId: norms[d.method].id })), from, value: num(value) })}>Пересчитать и сохранить</button>
        <button type="button" className="btn small secondary" onClick={onClose}>Закрыть</button>
      </div>
    </div>
  );
}

function AddLine({ products, semis, busy, onAdd }: { products: Product[]; semis: Dish[]; busy: boolean; onAdd: (b: object) => void }) {
  const [f, setF] = useState({ pick: '', unit: 'г', brutto: '', netto: '', ready: '', inYield: true });
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!f.pick) return; onAdd({ ...refBody(f.pick), unit: f.unit, brutto: num(f.brutto), netto: num(f.netto), ready: num(f.ready), inYield: f.inYield }); setF({ ...f, pick: '', brutto: '', netto: '', ready: '', inYield: true }); }}>
      <h3>Добавить строку</h3>
      <Pick id="al-pick" value={f.pick} onChange={(pick) => setF({ ...f, pick })} products={products} semis={semis} />
      <div className="grid2" style={{ marginTop: 6 }}>
        <div><label htmlFor="al-u">Единица</label><select id="al-u" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select></div>
        <div><label htmlFor="al-b">Брутто</label><input id="al-b" inputMode="decimal" value={f.brutto} onChange={(e) => setF({ ...f, brutto: e.target.value })} /></div>
        <div><label htmlFor="al-n">Нетто</label><input id="al-n" inputMode="decimal" value={f.netto} onChange={(e) => setF({ ...f, netto: e.target.value })} /></div>
        <div><label htmlFor="al-r">Выход</label><input id="al-r" inputMode="decimal" value={f.ready} onChange={(e) => setF({ ...f, ready: e.target.value })} /></div>
      </div>
      <label className="row small" style={{ fontWeight: 400 }}><input type="checkbox" checked={f.inYield} onChange={(e) => setF({ ...f, inYield: e.target.checked })} style={{ width: 22, minHeight: 22 }} /> <span style={{ flex: 1 }}>учитывать в выходе готового изделия (снимите для соли и специй)</span></label>
      <p className="small muted">Достаточно одной величины: если у товара есть обработка по умолчанию, остальные посчитаются по нормам.</p>
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
