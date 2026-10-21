'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { dt, n } from '@/lib/fmt';

/**
 * Печать этикеток: термоэтикетка 58×40 / 58×30 мм или лист A4 (24 наклейки 70×37 мм).
 * Перед отправкой на принтер печать записывается в журнал маркировки. QR ведёт на карточку партии (/l/КОД).
 */

interface Payload { product: string; lot_no: string | null; quantity: number; unit: string; manufactured_at: string | null; received_at: string; opened_at: string | null;
  expires_at: string | null; expiry_basis: string | null; warning: string | null; site: string; storage: string | null }
interface Label { id: string; code: string; kind: string; lot_id: string; payload: Payload; printed: number; created_by_name: string | null }

const FORMATS: [string, string][] = [['58x40', 'Термоэтикетка 58×40 мм'], ['58x30', 'Термоэтикетка 58×30 мм'], ['a4', 'Лист A4, 24 наклейки 70×37 мм']];
const PAGE: Record<string, string> = { '58x40': '@page{size:58mm 40mm;margin:0}', '58x30': '@page{size:58mm 30mm;margin:0}', a4: '@page{size:A4;margin:0}' };

function Qr({ text }: { text: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => { QRCode.toString(text, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }).then(setSvg).catch(() => setSvg('')); }, [text]);
  return <div className="lb-qr" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function LabelView({ l, tz }: { l: Label; tz: string }) {
  const p = l.payload;
  const url = typeof location !== 'undefined' ? `${location.origin}/l/${l.code}` : `/l/${l.code}`;
  const full = { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' } as const;
  return (
    <div className="lb">
      <div className="lb-left"><Qr text={url} /><div className="lb-code">{l.code}</div></div>
      <div className="lb-body">
        <div className="lb-name">{p.product}</div>
        {p.warning ? <div className="lb-warn">{p.warning}</div> : (
          <div className="lb-exp">Годен до: <b>{p.expires_at ? dt(p.expires_at, tz, full) : '—'}</b></div>
        )}
        {p.opened_at && <div>Вскрыто: {dt(p.opened_at, tz, full)}</div>}
        <div>Партия: {p.lot_no || 'без номера'}{p.manufactured_at ? ` · изг. ${dt(p.manufactured_at, tz, { day: '2-digit', month: '2-digit', year: '2-digit' })}` : ''}</div>
        <div className="lb-small">{p.storage || p.site}{l.created_by_name ? ` · ${l.created_by_name}` : ''}</div>
      </div>
    </div>
  );
}

function PrintLabels() {
  const { org } = useOrg();
  const ids = (useSearchParams().get('ids') || '').split(',').filter(Boolean);
  const [labels, setLabels] = useState<Label[] | null>(null);
  const [format, setFormat] = useState('58x40');
  const [copies, setCopies] = useState(1);
  const [done, setDone] = useState<string | null>(null);
  const { busy, error, run, setError } = useSubmit();
  const key = ids.join(',');
  useEffect(() => {
    if (!key) return;
    api<Label[]>(`/orgs/${org.id}/labels?ids=${key}`).then(setLabels).catch((e) => setError(e.message));
    try { const f = localStorage.getItem('ceh.labelFormat'); if (f && PAGE[f]) setFormat(f); } catch { /* приватный режим */ }
  }, [org.id, key, setError]);
  if (!key) return <div className="err">Не выбраны этикетки.</div>;
  if (!labels) return error ? <div className="err">{error}</div> : <p className="muted">Загрузка…</p>;
  const sheet = labels.flatMap((l) => Array.from({ length: copies }, (_, i) => ({ l, i })));
  return (
    <>
      <style>{PAGE[format]}</style>
      <div className="noprint">
        <p className="small"><Link href={labels.length === 1 ? `/app/${org.id}/lots/${labels[0].lot_id}` : `/app/${org.id}/labels`}>← {labels.length === 1 ? 'Партия' : 'Маркировка'}</Link></p>
        <h1>Печать этикеток</h1>
        <div className="card">
          <label htmlFor="lf">Формат</label>
          <select id="lf" value={format} onChange={(e) => { setFormat(e.target.value); try { localStorage.setItem('ceh.labelFormat', e.target.value); } catch { /* ignore */ } }}>
            {FORMATS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
          <label htmlFor="lc">Копий каждой</label>
          <input id="lc" type="number" min={1} max={100} value={copies} onChange={(e) => setCopies(Math.min(100, Math.max(1, Number(e.target.value) || 1)))} />
          <p className="small muted">Этикеток: {labels.length} × {copies} = {sheet.length}. {labels.some((l) => l.printed) ? `Уже печатались: ${labels.filter((l) => l.printed).length}.` : ''} Печать записывается в журнал маркировки.</p>
          {error && <div className="err">{error}</div>}
          {done && <div className="okbox">{done}</div>}
          <button className="btn block" disabled={busy} onClick={() => run(async () => {
            const r = await api<{ printed: number }>(`/orgs/${org.id}/labels/print`, { body: { labelIds: labels.map((l) => l.id), format, copies } });
            setDone(`В журнал записано этикеток: ${r.printed}.`);
            setTimeout(() => window.print(), 50);
          })}>Печать</button>
        </div>
        <h2>Предпросмотр</h2>
      </div>
      <div className={`lb-sheet f-${format}`}>
        {sheet.map(({ l, i }) => <LabelView key={`${l.id}-${i}`} l={l} tz={org.timezone} />)}
      </div>
      {labels.some((l) => l.payload.warning) && <p className="small noprint">Этикетки с пометкой «НЕ ИСПОЛЬЗОВАТЬ» печатаются как есть — так продукт не уйдёт в работу по ошибке.</p>}
      <p className="small muted noprint">Количество в партии на момент печати: {labels.map((l) => `${l.payload.product} — ${n(l.payload.quantity)} ${l.payload.unit}`).join('; ')}.</p>
    </>
  );
}

export default function Page() { return <Suspense><PrintLabels /></Suspense>; }
