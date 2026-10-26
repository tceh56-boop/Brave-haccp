'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { n } from '@/lib/fmt';

interface Method { code: string; name: string; kind: 'cold' | 'thermal' }
interface Norm { id: string; product_id: string; product_name: string; method_code: string; method_name: string; method_kind: string; loss_pct: number; season: string;
  protein_loss_pct: number | null; fat_loss_pct: number | null; carbs_loss_pct: number | null; basis: string; note: string | null; status: string; is_default: boolean; approved_by_name: string | null; archive_reason: string | null }
interface Product { id: string; name: string; unit: string }
interface Stat { n: number; min: number; median: number; max: number; cards: string[] }
interface Suggest { product: string; lines: number; cold: Stat | null; thermal: Stat | null }

const STATUS: Record<string, [string, string]> = { draft: ['черновик', 'warn'], approved: ['утверждена', 'ok'], archived: ['архив', ''] };
const EMPTY = { method: '', lossPct: '', seasonal: false, seasonFrom: '', seasonTo: '', p: '', f: '', c: '', basis: '', note: '' };

/**
 * Обработка сырья (ГОСТ 31988-2012): нормы отходов при холодной и потерь при тепловой обработке по каждому товару.
 * Норму вносят по основанию — таблица Сборника рецептур или акт контрольной проработки; утверждает человек.
 * Подсказка из архива ТТК — статистика собственных карт, не норма.
 */
export default function ProcessingPage() {
  const { org, can } = useOrg();
  const [methods, setMethods] = useState<Method[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [norms, setNorms] = useState<Norm[] | null>(null);
  const [productId, setProductId] = useState('');
  const [archived, setArchived] = useState(false);
  const [sug, setSug] = useState<Suggest | null>(null);
  const [f, setF] = useState(EMPTY);
  const [applied, setApplied] = useState<Record<string, number>>({});
  const { busy, error, run } = useSubmit();
  const manage = can('ttk.manage'), approve = can('ttk.approve');

  useEffect(() => {
    api<Method[]>(`/orgs/${org.id}/processing/methods`).then(setMethods).catch(() => setMethods([]));
    api<Product[]>(`/orgs/${org.id}/products`).then(setProducts).catch(() => setProducts([]));
  }, [org.id]);
  const load = useCallback(() => api<{ norms: Norm[] }>(`/orgs/${org.id}/processing/norms?${new URLSearchParams({ ...(productId ? { productId } : {}), ...(archived ? { archived: '1' } : {}) })}`)
    .then((r) => setNorms(r.norms)).catch(() => setNorms([])), [org.id, productId, archived]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    setSug(null);
    if (productId && manage) api<Suggest>(`/orgs/${org.id}/processing/suggest?productId=${productId}`).then(setSug).catch(() => setSug(null));
  }, [org.id, productId, manage]);

  const method = methods.find((m) => m.code === f.method);
  const num = (s: string) => (s.trim() ? Number(s.replace(',', '.')) : null);
  const save = () => run(async () => {
    await api(`/orgs/${org.id}/processing/norms`, { body: {
      productId, method: f.method, lossPct: num(f.lossPct), seasonFrom: f.seasonal ? f.seasonFrom : null, seasonTo: f.seasonal ? f.seasonTo : null,
      proteinLossPct: method?.kind === 'thermal' ? num(f.p) : null, fatLossPct: method?.kind === 'thermal' ? num(f.f) : null, carbsLossPct: method?.kind === 'thermal' ? num(f.c) : null,
      basis: f.basis, note: f.note || null } });
    setF({ ...EMPTY, basis: f.basis });
    await load();
  });
  const op = (id: string, o: string, body: object = {}) => run(async () => {
    const r = await api<{ lines?: number }>(`/orgs/${org.id}/processing/norms/${id}/${o}`, { body });
    if (o === 'apply-drafts') setApplied({ ...applied, [id]: r.lines || 0 });
    await load();
  });

  const byProduct = new Map<string, Norm[]>();
  for (const x of norms || []) byProduct.set(x.product_name, [...(byProduct.get(x.product_name) || []), x]);

  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/menu`}>← Блюда и ТТК</Link></p>
      <h1>Обработка сырья</h1>
      <p className="small muted">Отходы при холодной обработке и потери при тепловой — по каждому товару. По ним в ТТК считаются брутто, нетто и выход.
        Процент берут из Сборника рецептур или из акта контрольной проработки: П = (М1 − М2) / М1 × 100. Система норм не придумывает.</p>

      <div className="card">
        <label htmlFor="pp">Товар</label>
        <select id="pp" value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">— все товары с нормами —</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
        </select>
        <label className="row" style={{ marginTop: 8, fontWeight: 400 }}><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} style={{ width: 22, minHeight: 22 }} /> <span style={{ flex: 1 }}>показывать архивные</span></label>
      </div>

      {error && <div className="err" role="alert">{error}</div>}
      {!norms ? <p className="muted">Загрузка…</p> : norms.length === 0 ? <div className="card"><p className="muted">{productId ? 'Для этого товара норм пока нет.' : 'Норм обработки пока нет. Выберите товар, чтобы внести норму.'}</p></div> : (
        [...byProduct.entries()].map(([name, list]) => (
          <div className="card" key={name}>
            <h2>{name}</h2>
            <ul className="list">{list.map((x) => (
              <li key={x.id}>
                <div className="between">
                  <b>{x.method_name}: {x.loss_pct < 0 ? `привар ${n(-x.loss_pct)} %` : `${x.method_kind === 'cold' ? 'отход' : 'потери'} ${n(x.loss_pct)} %`}</b>
                  <span className="row">{x.is_default && <span className="badge">по умолчанию</span>}<span className={`badge ${STATUS[x.status][1]}`}>{STATUS[x.status][0]}</span></span>
                </div>
                <div className="small">{x.season}{x.protein_loss_pct !== null ? ` · потери Б/Ж/У ${n(x.protein_loss_pct)}/${n(x.fat_loss_pct)}/${n(x.carbs_loss_pct)} %` : x.method_kind === 'thermal' ? ' · потери нутриентов не заданы' : ''}</div>
                <div className="small muted">Основание: {x.basis}{x.approved_by_name ? ` · утвердил ${x.approved_by_name}` : ''}{x.archive_reason ? ` · в архиве: ${x.archive_reason}` : ''}</div>
                {x.status !== 'archived' && (manage || approve) && (
                  <div className="row" style={{ marginTop: 6 }}>
                    {x.status === 'draft' && approve && <button className="btn small" disabled={busy} onClick={() => op(x.id, 'approve')}>Утвердить</button>}
                    {x.status === 'approved' && manage && <button className="btn small secondary" disabled={busy} onClick={() => op(x.id, 'default', { isDefault: !x.is_default })}>{x.is_default ? 'Не по умолчанию' : 'По умолчанию в ТТК'}</button>}
                    {x.status === 'approved' && manage && <button className="btn small secondary" disabled={busy} onClick={() => { if (confirm('Пересчитать черновики ТТК с этим товаром по этой норме? Выход строк сохранится, брутто и нетто пересчитаются.')) op(x.id, 'apply-drafts'); }}>Пересчитать черновики</button>}
                    {approve && <button className="btn small secondary" disabled={busy} onClick={() => { const reason = prompt('Причина переноса нормы в архив:'); if (reason) op(x.id, 'archive', { reason }); }}>В архив</button>}
                    {applied[x.id] !== undefined && <span className="small">пересчитано строк: {applied[x.id]}</span>}
                  </div>
                )}
              </li>
            ))}</ul>
          </div>
        ))
      )}

      {manage && productId && (
        <div className="card">
          <h2>Новая норма</h2>
          {sug && (sug.cold || sug.thermal) && (
            <div className="note small">
              <b>В ваших картах архива ТТК</b> (строк: {sug.lines}) — это подсказка, не норма:
              {sug.cold && <div>холодная обработка: {n(sug.cold.min)}–{n(sug.cold.max)} %, медиана {n(sug.cold.median)} % ({sug.cold.n} стр.; {sug.cold.cards.slice(0, 3).join(', ')})</div>}
              {sug.thermal && <div>тепловая: {n(sug.thermal.min)}–{n(sug.thermal.max)} %, медиана {n(sug.thermal.median)} % ({sug.thermal.n} стр.)</div>}
            </div>
          )}
          <form onSubmit={(e) => { e.preventDefault(); save(); }}>
            <label htmlFor="nm">Способ обработки</label>
            <select id="nm" required value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
              <option value="">— выберите —</option>
              <optgroup label="Холодная">{methods.filter((m) => m.kind === 'cold').map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</optgroup>
              <optgroup label="Тепловая">{methods.filter((m) => m.kind === 'thermal').map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</optgroup>
            </select>
            <label htmlFor="nl">{method?.kind === 'thermal' ? 'Потери массы, % (привар — со знаком минус)' : 'Отход, %'}</label>
            <input id="nl" required inputMode="decimal" value={f.lossPct} onChange={(e) => setF({ ...f, lossPct: e.target.value })} placeholder="например, 20" />
            <label className="row" style={{ marginTop: 8, fontWeight: 400 }}><input type="checkbox" checked={f.seasonal} onChange={(e) => setF({ ...f, seasonal: e.target.checked })} style={{ width: 22, minHeight: 22 }} /> <span style={{ flex: 1 }}>сезонная норма (например, морковь до и после 1 января)</span></label>
            {f.seasonal && (
              <div className="grid2">
                <div><label htmlFor="sf">С (ДД.ММ)</label><input id="sf" required value={f.seasonFrom} onChange={(e) => setF({ ...f, seasonFrom: e.target.value })} placeholder="01.09" /></div>
                <div><label htmlFor="st">По (ДД.ММ)</label><input id="st" required value={f.seasonTo} onChange={(e) => setF({ ...f, seasonTo: e.target.value })} placeholder="31.12" /></div>
              </div>
            )}
            {method?.kind === 'thermal' && (
              <>
                <p className="small muted" style={{ marginBottom: 0 }}>Потери пищевых веществ, % — по справочнику «Химический состав пищевых продуктов». Не знаете — оставьте пустыми: КБЖУ посчитается без потерь и будет помечено.</p>
                <div className="grid2">
                  <div><label htmlFor="lp">Белки</label><input id="lp" inputMode="decimal" value={f.p} onChange={(e) => setF({ ...f, p: e.target.value })} /></div>
                  <div><label htmlFor="lf">Жиры</label><input id="lf" inputMode="decimal" value={f.f} onChange={(e) => setF({ ...f, f: e.target.value })} /></div>
                  <div><label htmlFor="lc">Углеводы</label><input id="lc" inputMode="decimal" value={f.c} onChange={(e) => setF({ ...f, c: e.target.value })} /></div>
                </div>
              </>
            )}
            <label htmlFor="nb">Основание</label>
            <input id="nb" required value={f.basis} onChange={(e) => setF({ ...f, basis: e.target.value })} placeholder="Сборник рецептур, табл. … / акт контрольной проработки № … от …" />
            <label htmlFor="nn">Примечание</label><input id="nn" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
            <button className="btn block" disabled={busy}>Внести норму (черновик)</button>
            <p className="small muted">Действует после утверждения шефом, технологом или руководителем. Значения не меняются — новая норма заменяет прежнюю.</p>
          </form>
        </div>
      )}
    </>
  );
}
