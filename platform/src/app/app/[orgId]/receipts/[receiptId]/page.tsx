'use client';
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { d, n } from '@/lib/fmt';
import { Evidence } from '@/components/Evidence';
import { RecognizeDocument } from '@/components/RecognizeDocument';

interface Line { id: string; product_id: string; product: string; quantity: string; unit: string; lot_no: string | null; expires_at: string | null; expiry_basis: string | null; temperature: string | null; decision: string; decision_reason: string | null; storage_name: string | null; lot_id: string | null }
interface OrderLine { product_id: string; product: string; quantity: string; unit: string; price: string | null }
interface R { receipt: { id: string; status: string; status_label: string; document_no: string | null; supplier: string | null; site_id: string }; lines: Line[];
  order: { id: string; number: number; lines: OrderLine[] } | null }
interface Product { id: string; name: string; unit: string }
interface Obj { id: string; name: string }

const CHECKS: [string, string][] = [['packaging', 'Упаковка цела'], ['labeling', 'Маркировка есть и читается'], ['documents', 'Документы в порядке'], ['quality', 'Качество (вид, запах)']];
const DEC: Record<string, [string, string]> = { accepted: ['принято', 'ok'], quarantine: ['карантин', 'warn'], rejected: ['отказ', 'crit'] };
const empty = { productId: '', quantity: '', lotNo: '', manufacturedAt: '', expiresAt: '', expiryBasis: 'маркировка изготовителя', temperature: '', storageObjectId: '', decisionReason: '', unitPrice: '' };

export default function ReceiptPage({ params }: { params: Promise<{ receiptId: string }> }) {
  const { receiptId } = use(params);
  const { org, can } = useOrg();
  const router = useRouter();
  const [r, setR] = useState<R | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [objects, setObjects] = useState<Obj[]>([]);
  const [f, setF] = useState(empty);
  const [checks, setChecks] = useState<Record<string, boolean | null>>({ packaging: null, labeling: null, documents: null, quality: null });
  const [summary, setSummary] = useState<Record<string, number | string> | null>(null);
  const [newProduct, setNewProduct] = useState({ name: '', unit: 'кг' });
  const { busy, error, run, setError } = useSubmit();
  const load = useCallback(async () => {
    const x = await api<R>(`/orgs/${org.id}/receipts/${receiptId}`); setR(x);
    setObjects(await api<Obj[]>(`/orgs/${org.id}/sites/${x.receipt.site_id}/objects`).catch(() => []));
  }, [org.id, receiptId]);
  useEffect(() => { load().catch((e) => setError(e.message)); api<Product[]>(`/orgs/${org.id}/products`).then(setProducts).catch(() => undefined); }, [load, org.id, setError]);
  if (!r) return error ? <div className="err">{error}</div> : <p className="muted">Загрузка…</p>;
  const draft = r.receipt.status === 'draft';
  const allOk = CHECKS.every(([k]) => checks[k] === true);
  const unit = products.find((p) => p.id === f.productId)?.unit || '';

  const add = (decision: 'accepted' | 'quarantine' | 'rejected') => run(async () => {
    await api(`/orgs/${org.id}/receipts/${receiptId}/lines`, { body: {
      productId: f.productId, quantity: f.quantity.replace(',', '.'), lotNo: f.lotNo || null, manufacturedAt: f.manufacturedAt || null,
      expiresAt: f.expiresAt || null, expiryBasis: f.expiresAt ? f.expiryBasis : null, temperature: f.temperature ? f.temperature.replace(',', '.') : null,
      checks, decision, decisionReason: decision === 'accepted' ? null : f.decisionReason, storageObjectId: f.storageObjectId || null,
      unitPrice: f.unitPrice ? f.unitPrice.replace(',', '.') : null,
    } });
    setF({ ...empty, storageObjectId: f.storageObjectId }); setChecks({ packaging: null, labeling: null, documents: null, quality: null }); await load();
  });

  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/shift`}>← Смена</Link></p>
      <div className="between"><h1 style={{ margin: 0 }}>Приёмка {r.receipt.document_no || ''}</h1><span className="badge">{r.receipt.status_label}</span></div>
      <p className="muted">{r.receipt.supplier || 'Поставщик не указан'}</p>

      {r.order && (
        <div className="card">
          <div className="between"><h2 style={{ margin: 0 }}>По заказу № {r.order.number}</h2><Link className="small" href={`/app/${org.id}/purchasing/${r.order.id}`}>заказ</Link></div>
          <p className="small muted">{draft ? 'Нажмите позицию — товар, количество и цена подставятся в форму. Проверки и срок — по факту, как при обычной приёмке.' : 'Заказано / принято.'}</p>
          <ul className="list">{r.order.lines.map((ol) => {
            const got = r.lines.filter((l) => l.product_id === ol.product_id && l.decision !== 'rejected').reduce((s, l) => s + Number(l.quantity), 0);
            const tone = got === 0 ? '' : Math.abs(got - Number(ol.quantity)) < 1e-9 ? 'ok' : 'warn';
            return (
              <li key={ol.product_id}>
                <div className="between">
                  {draft ? <button type="button" className="linkbtn" onClick={() => setF({ ...empty, storageObjectId: f.storageObjectId, productId: ol.product_id,
                    quantity: String(Math.max(0, Number(ol.quantity) - got) || ol.quantity).replace('.', ','), unitPrice: ol.price === null ? '' : String(ol.price).replace('.', ',') })}>{ol.product}</button> : <b>{ol.product}</b>}
                  <span className={`badge ${tone}`}>{n(got)} / {n(ol.quantity)} {ol.unit}</span>
                </div>
              </li>);
          })}</ul>
        </div>
      )}

      {r.lines.length > 0 && (
        <div className="card">
          <h2>Позиции</h2>
          <ul className="list">{r.lines.map((l) => (
            <li key={l.id}>
              <div className="between">
                <div><b>{l.product}</b> · {n(l.quantity)} {l.unit}{l.lot_no ? ` · партия ${l.lot_no}` : ''}
                  <div className="small muted">{l.expires_at ? `годен до ${d(l.expires_at, org.timezone)} (${l.expiry_basis})` : 'срок не указан'}{l.temperature !== null ? ` · ${n(l.temperature)} °C` : ''}{l.storage_name ? ` · ${l.storage_name}` : ''}</div>
                  {l.decision_reason && <div className="small">{l.decision_reason}</div>}
                </div>
                <div className="row"><span className={`badge ${DEC[l.decision][1]}`}>{DEC[l.decision][0]}</span>
                  {draft && <button className="btn secondary small" aria-label="Удалить позицию" onClick={() => run(async () => { await api(`/orgs/${org.id}/receipts/${receiptId}/lines/${l.id}`, { method: 'DELETE' }); await load(); })}>✕</button>}
                  {l.lot_id && <Link className="small" href={`/app/${org.id}/lots/${l.lot_id}`}>партия</Link>}
                </div>
              </div>
            </li>
          ))}</ul>
          {draft && <button className="btn block" disabled={busy} onClick={() => run(async () => { setSummary(await api(`/orgs/${org.id}/receipts/${receiptId}/complete`, { body: {} })); await load(); })}>Завершить приёмку</button>}
          {!draft && can('label.print') && r.lines.some((l) => l.lot_id) && (
            <button className="btn block secondary" disabled={busy} onClick={() => run(async () => {
              const labels = await api<{ id: string }[]>(`/orgs/${org.id}/labels`, { body: { lotIds: r.lines.filter((l) => l.lot_id).map((l) => l.lot_id) } });
              router.push(`/app/${org.id}/labels/print?ids=${labels.map((x) => x.id).join(',')}`);
            })}>Этикетки партий ({r.lines.filter((l) => l.lot_id).length})</button>)}
        </div>
      )}

      {summary && (
        <div className="okbox" role="status">
          Приёмка завершена: {String(summary.status_label)}. Партий: {summary.lots}{Number(summary.quarantine) ? `, в карантине: ${summary.quarantine}` : ''}{Number(summary.rejected) ? `, отказ: ${summary.rejected}` : ''}.
          {Number(summary.unconfirmed) > 0 && <div>Срок не подтверждён у {summary.unconfirmed} — создана задача ответственному.</div>}
        </div>
      )}

      {draft && <RecognizeDocument siteId={r.receipt.site_id} receiptId={receiptId} products={products}
        onUse={(l) => { setF({ ...empty, storageObjectId: f.storageObjectId, productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice, lotNo: l.lotNo, expiresAt: l.expiresAt });
          document.getElementById('pr')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }} />}

      {draft && (
        <div className="card">
          <h2>Добавить товар</h2>
          <label htmlFor="pr">Товар</label>
          <select id="pr" value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })}>
            <option value="">— выберите —</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
          </select>
          {can('catalog.manage') && !f.productId && (
            <div className="row" style={{ marginTop: 8 }}>
              <input aria-label="Новый товар" placeholder="Новый товар" value={newProduct.name} onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })} style={{ flex: 2 }} />
              <select aria-label="Единица" value={newProduct.unit} onChange={(e) => setNewProduct({ ...newProduct, unit: e.target.value })} style={{ flex: 1 }}>{['кг', 'г', 'л', 'мл', 'шт'].map((u) => <option key={u}>{u}</option>)}</select>
              <button type="button" className="btn secondary small" onClick={() => run(async () => { const p = await api<Product>(`/orgs/${org.id}/products`, { body: newProduct }); setProducts([...products, p]); setF({ ...f, productId: p.id }); setNewProduct({ name: '', unit: 'кг' }); })}>Добавить</button>
            </div>
          )}
          <div className="grid2">
            <div><label htmlFor="q">Количество{unit ? `, ${unit}` : ''}</label><input id="q" inputMode="decimal" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></div>
            <div><label htmlFor="ln">Номер партии</label><input id="ln" value={f.lotNo} onChange={(e) => setF({ ...f, lotNo: e.target.value })} /></div>
            <div><label htmlFor="mf">Дата изготовления</label><input id="mf" type="date" value={f.manufacturedAt} onChange={(e) => setF({ ...f, manufacturedAt: e.target.value })} /></div>
            <div><label htmlFor="ex">Годен до</label><input id="ex" type="date" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} /></div>
          </div>
          {f.expiresAt && <><label htmlFor="eb">Основание срока</label>
            <select id="eb" value={f.expiryBasis} onChange={(e) => setF({ ...f, expiryBasis: e.target.value })}>
              <option>маркировка изготовителя</option><option>удостоверение качества / сопроводительный документ</option>
            </select></>}
          {!f.expiresAt && <p className="small muted">Нет даты на маркировке — оставьте пустым: партия получит статус «Срок не подтверждён», ответственный получит задачу.</p>}
          <div className="grid2">
            <div><label htmlFor="t">Температура при приёмке, °C</label><input id="t" inputMode="decimal" value={f.temperature} onChange={(e) => setF({ ...f, temperature: e.target.value })} placeholder="если требуется" /></div>
            <div><label htmlFor="so">Место хранения</label>
              <select id="so" value={f.storageObjectId} onChange={(e) => setF({ ...f, storageObjectId: e.target.value })}><option value="">—</option>{objects.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
            <div><label htmlFor="up">Цена за {unit || 'единицу'}, ₽</label><input id="up" inputMode="decimal" value={f.unitPrice} onChange={(e) => setF({ ...f, unitPrice: e.target.value })} placeholder="как в накладной" /></div>
          </div>
          <h3 style={{ marginTop: 14 }}>Проверки</h3>
          {CHECKS.map(([k, label]) => (
            <div key={k} style={{ marginBottom: 8 }}>
              <div className="small" style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
              <div className="seg">
                <button type="button" className="yes" aria-pressed={checks[k] === true} onClick={() => setChecks({ ...checks, [k]: true })}>Да</button>
                <button type="button" className="no" aria-pressed={checks[k] === false} onClick={() => setChecks({ ...checks, [k]: false })}>Нет</button>
              </div>
            </div>
          ))}
          {!allOk && <><label htmlFor="rs">Причина (для карантина или отказа)</label><input id="rs" value={f.decisionReason} onChange={(e) => setF({ ...f, decisionReason: e.target.value })} /></>}
          {error && <div className="err" role="alert">{error}</div>}
          <button className="btn block" disabled={busy || !f.productId || !allOk} onClick={() => add('accepted')}>Принять</button>
          <div className="grid2">
            <button className="btn block secondary" disabled={busy || !f.productId} onClick={() => add('quarantine')}>В карантин</button>
            <button className="btn block danger" disabled={busy || !f.productId} onClick={() => add('rejected')}>Отказ</button>
          </div>
          {!allOk && <p className="small muted">«Принять» доступно, когда все проверки — «Да».</p>}
        </div>
      )}
      <Evidence entityType="receipt" entityId={receiptId} title="Накладная, сертификаты, фото" />
    </>
  );
}
