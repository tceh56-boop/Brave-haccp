'use client';
import { useEffect, useState } from 'react';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { n } from '@/lib/fmt';

/**
 * Распознавание накладной в приёмке (этап 17; движок MON CHEF V10–V12). Фото или PDF — один или несколько листов →
 * черновик строк. Ничего не проводится: строку в форму приёмки переносит человек, проверки — как обычно.
 * Выбранный человеком товар запоминается для этого поставщика.
 */

interface Cand { id: string; name: string; unit: string; confidence: number; source: string }
interface Line { line_number: number; raw_name: string; quantity: number | null; unit: string | null; price: number | null; sum: number | null; vat: number | null;
  expiry_date: string | null; batch_number: string | null; confidence: number; calculation_mismatch: boolean; requires_manual_review: boolean; matched_product: Cand | null; alternatives: Cand[] }
interface Doc { document_type: string; document_number: string | null; document_date: string | null; supplier: string | null; total: number | null; recognition_confidence: number;
  items: Line[]; warnings: string[]; second_pass: string | null; ocr: { pages: number; orient: number[] } }
interface Result { id: string; duplicate: { id: string; at: string } | null; document: Doc }
interface Product { id: string; name: string; unit: string }
export interface UseLine { productId: string; quantity: string; unitPrice: string; lotNo: string; expiresAt: string }

const TYPE: Record<string, string> = { UPD: 'УПД', WAYBILL: 'Накладная', INVOICE: 'Счёт', RETAIL_RECEIPT: 'Кассовый чек', PRODUCT_RECEIPT: 'Товарный чек', PAYMENT_ORDER: 'Платёжное поручение' };
const dec = (v: number | null) => (v === null ? '' : String(v).replace('.', ','));

export function RecognizeDocument({ siteId, receiptId, products, onUse }: { siteId: string; receiptId: string; products: Product[]; onUse: (l: UseLine) => void }) {
  const { org } = useOrg();
  const [av, setAv] = useState<{ enabled: boolean; kinds: string[]; pages_left: number } | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [kind, setKind] = useState('upd');
  const [res, setRes] = useState<Result | null>(null);
  const [pick, setPick] = useState<Record<number, string>>({});
  const [used, setUsed] = useState<Record<number, boolean>>({});
  const { busy, error, run } = useSubmit();
  useEffect(() => { api<typeof av>(`/orgs/${org.id}/recognition/available`).then(setAv).catch(() => setAv(null)); }, [org.id]);
  if (!av?.enabled) return null;
  const kinds = [['upd', 'УПД'], ['torg12', 'ТОРГ-12 / ТТН']].filter(([k]) => av.kinds.includes(k));
  if (!kinds.length) return null;
  const recognize = () => run(async () => {
    const fd = new FormData();
    fd.append('siteId', siteId); fd.append('receiptId', receiptId); fd.append('kind', kind);
    files.forEach((f) => fd.append('file', f));
    const r = await api<Result>(`/orgs/${org.id}/recognition/documents`, { method: 'POST', form: fd });
    setRes(r); setUsed({});
    setPick(Object.fromEntries(r.document.items.map((l) => [l.line_number, l.matched_product?.id || ''])));
    api<typeof av>(`/orgs/${org.id}/recognition/available`).then(setAv).catch(() => undefined);
  });
  const toForm = (l: Line) => run(async () => {
    const pid = pick[l.line_number];
    // соответствие выбрал или подтвердил человек — запоминаем для поставщика (MON CHEF V11 rememberOcrAlias)
    if (pid && l.matched_product?.source !== 'ALIAS') await api(`/orgs/${org.id}/recognition/aliases`, { body: { rawText: l.raw_name, productId: pid, supplier: res?.document.supplier || null } });
    onUse({ productId: pid, quantity: dec(l.quantity), unitPrice: dec(l.price), lotNo: l.batch_number || '', expiresAt: l.expiry_date || '' });
    setUsed({ ...used, [l.line_number]: true });
  });
  const d = res?.document;
  return (
    <div className="card">
      <h2>Распознать документ</h2>
      <p className="small muted">Фото или PDF накладной — можно несколько листов. Получится черновик строк: проверьте и перенесите в приёмку. Платно: осталось {av.pages_left} стр. в этом месяце.</p>
      {kinds.length > 1 && <div className="chips">{kinds.map(([k, l]) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>)}</div>}
      <input aria-label="Файлы документа" type="file" accept="image/jpeg,image/png,application/pdf" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} />
      {files.length > 0 && <p className="small">{files.map((f) => f.name).join(', ')}</p>}
      {error && <div className="err" role="alert">{error}</div>}
      <button className="btn secondary block" disabled={busy || !files.length || av.pages_left <= 0} onClick={recognize}>{busy ? 'Распознаю…' : `Распознать (${files.length || 0} файл.)`}</button>

      {d && (
        <>
          {res!.duplicate && <div className="err">Этот документ уже распознавали {new Date(res!.duplicate.at).toLocaleString('ru-RU')} — проверьте, не принят ли он второй раз.</div>}
          <div className="kv" style={{ marginTop: 10 }}>
            <span>Документ</span><b>{TYPE[d.document_type] || d.document_type}{d.document_number ? ` № ${d.document_number}` : ''}{d.document_date ? ` от ${d.document_date.split('-').reverse().join('.')}` : ''}</b>
            {d.supplier && <><span>Поставщик</span><b>{d.supplier}</b></>}
            {d.total !== null && <><span>Итого</span><b>{n(d.total)} ₽</b></>}
            <span>Уверенность</span><b>{Math.round(d.recognition_confidence * 100)} %{d.second_pass ? ' · проверено вторым проходом' : ''}{d.ocr.orient.some(Boolean) ? ' · фото повёрнуто' : ''}</b>
          </div>
          {d.warnings.length > 0 && <ul className="small" style={{ color: 'var(--warn, #a35b00)' }}>{d.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          <ul className="list">{d.items.map((l) => {
            const cands = [l.matched_product, ...l.alternatives].filter(Boolean) as Cand[];
            return (
              <li key={l.line_number}>
                <div className="between"><b>{l.line_number}. {l.raw_name}</b>
                  {l.calculation_mismatch ? <span className="badge crit">сумма не сходится</span> : l.requires_manual_review ? <span className="badge warn">проверить</span> : <span className="badge ok">{Math.round(l.confidence * 100)} %</span>}</div>
                <div className="small">{l.quantity === null ? '?' : n(l.quantity)} {l.unit || ''} × {l.price === null ? '?' : n(l.price)} = {l.sum === null ? '?' : n(l.sum)} ₽{l.vat !== null ? ` · НДС ${n(l.vat)}` : ''}{l.expiry_date ? ` · годен до ${l.expiry_date.split('-').reverse().join('.')}` : ''}</div>
                <div className="row" style={{ marginTop: 6 }}>
                  <select aria-label={`Товар: ${l.raw_name}`} value={pick[l.line_number] || ''} onChange={(e) => setPick({ ...pick, [l.line_number]: e.target.value })} style={{ flex: 2 }}>
                    <option value="">— товар не выбран —</option>
                    {cands.length > 0 && <optgroup label="Похожие">{cands.map((c) => <option key={c.id} value={c.id}>{c.name} ({Math.round(c.confidence * 100)} %{c.source === 'ALIAS' ? ', выбран ранее' : ''})</option>)}</optgroup>}
                    <optgroup label="Все товары">{products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}</optgroup>
                  </select>
                  <button className="btn small" disabled={busy || !pick[l.line_number]} onClick={() => toForm(l)}>{used[l.line_number] ? 'Ещё раз' : 'В форму'}</button>
                </div>
              </li>);
          })}</ul>
          <p className="small muted">«В форму» подставит товар, количество и цену из документа (в УПД цена указана без НДС). Срок годности, партия и проверки — по факту.</p>
        </>
      )}
    </div>
  );
}
