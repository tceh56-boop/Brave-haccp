'use client';
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import QRCode from 'qrcode';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { n } from '@/lib/fmt';

/**
 * Потребительская этикетка партии собственного изготовления по ТР ТС 022/2011 (ст. 4.1 п. 1). Пока не хватает
 * обязательных сведений — вместо этикетки перечень того, что исправить; печать недоступна. Печать — в журнал маркировки.
 */

interface Payload {
  product: string; lot_no: string | null; composition: string[]; allergens: string[]; allergen_text: string | null;
  nutrition: { protein: number; fat: number; carbs: number; kcal: number; kj: number } | null; net_mass_g: number | null;
  manufactured_text: string | null; expires_text: string | null; storage: string | null; after_opening: string | null;
  manufacturer: string; address: string | null; tu: string | null; eac: boolean;
}
interface Preview { payload: Payload; blockers: string[]; notes: string[]; lot_no: string | null }

const FORMATS: [string, string][] = [['58x60', 'Термоэтикетка 58×60 мм'], ['100x70', 'Термоэтикетка 100×70 мм']];
const PAGE: Record<string, string> = { '58x60': '@page{size:58mm 60mm;margin:0}', '100x70': '@page{size:100mm 70mm;margin:0}' };

function Qr({ text }: { text: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => { QRCode.toString(text, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }).then(setSvg).catch(() => setSvg('')); }, [text]);
  return <div className="lb-qr" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** Состав: аллергенные компоненты выделены (ТР ТС 022/2011, ст. 4.4). */
function Composition({ p }: { p: Payload }) {
  const al = p.allergens.map((a) => a.toLowerCase());
  return <>{p.composition.map((c, i) => <span key={c}>{i ? ', ' : ''}{al.some((a) => c.toLowerCase().includes(a.split(' ')[0])) ? <b>{c}</b> : c}</span>)}.</>;
}

function ConsumerLabel({ p, code }: { p: Payload; code: string | null }) {
  const url = code && typeof location !== 'undefined' ? `${location.origin}/l/${code}` : null;
  return (
    <div className="cl">
      <div className="cl-name">{p.product}</div>
      <p><b>Состав:</b> <Composition p={p} /></p>
      {p.allergen_text && <p className="cl-al">{p.allergen_text}</p>}
      {p.nutrition && <p><b>Пищевая ценность в 100 г:</b> белки {n(p.nutrition.protein)} г, жиры {n(p.nutrition.fat)} г, углеводы {n(p.nutrition.carbs)} г. Энергетическая ценность {p.nutrition.kcal} ккал / {p.nutrition.kj} кДж.</p>}
      <p><b>Масса нетто:</b> {p.net_mass_g ? `${n(p.net_mass_g)} г` : '—'}</p>
      <div className="cl-dates"><span>Изготовлено: {p.manufactured_text || '—'}</span><span>Годен до: {p.expires_text || '—'}</span></div>
      <p><b>Условия хранения:</b> {p.storage || '—'}{p.after_opening ? `; ${p.after_opening}` : ''}.</p>
      <div className="cl-foot">
        <div style={{ flex: 1 }}>
          <p><b>Изготовитель:</b> {p.manufacturer}{p.address ? `, ${p.address}` : ''}.</p>
          {p.tu && <p>{p.tu}</p>}
          <p>Партия {p.lot_no || '—'}{code ? ` · ${code}` : ''}</p>
        </div>
        {url && <Qr text={url} />}
      </div>
    </div>
  );
}

export default function ConsumerLabelPage({ params }: { params: Promise<{ lotId: string }> }) {
  const { lotId } = use(params);
  const { org, can } = useOrg();
  const [mass, setMass] = useState('');
  const [format, setFormat] = useState('58x60');
  const [copies, setCopies] = useState(1);
  const [pv, setPv] = useState<Preview | null>(null);
  const [label, setLabel] = useState<{ id: string; code: string } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const { busy, error, run, setError } = useSubmit();
  const num = Number(mass.replace(',', '.')) || null;
  const load = useCallback(() => api<Preview>(`/orgs/${org.id}/lots/${lotId}/consumer-label${num ? `?netMassG=${num}` : ''}`).then((x) => { setPv(x); setError(null); }).catch((e) => setError(e.message)), [org.id, lotId, num, setError]);
  useEffect(() => { load(); setLabel(null); }, [load]);
  if (!pv) return error ? <><p className="small"><Link href={`/app/${org.id}/lots/${lotId}`}>← Партия</Link></p><div className="err">{error}</div></> : <p className="muted">Загрузка…</p>;
  const ready = pv.blockers.length === 0;
  return (
    <>
      <style>{PAGE[format]}</style>
      <div className="noprint">
        <p className="small"><Link href={`/app/${org.id}/lots/${lotId}`}>← Партия {pv.lot_no || ''}</Link></p>
        <h1>Потребительская этикетка</h1>
        <p className="small muted">Для упакованной продукции собственного изготовления, которая продаётся навынос, с доставкой или вне предприятия. Сведения — по ТР ТС 022/2011, ст. 4.1 п. 1; данные — из утверждённой ТТК, расчёта ТУ и партии.</p>
        <div className="card">
          <label htmlFor="cm">Масса нетто упаковки, г</label>
          <input id="cm" inputMode="decimal" value={mass} onChange={(e) => setMass(e.target.value)} placeholder="например, 300" />
          <div className="grid2">
            <div><label htmlFor="cf">Формат</label><select id="cf" value={format} onChange={(e) => setFormat(e.target.value)}>{FORMATS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
            <div><label htmlFor="cc">Копий</label><input id="cc" type="number" min={1} max={100} value={copies} onChange={(e) => setCopies(Math.min(100, Math.max(1, Number(e.target.value) || 1)))} /></div>
          </div>
        </div>
        {error && <div className="err">{error}</div>}
        {!ready && <div className="err"><b>Этикетку печатать нельзя — на ней были бы недостоверные сведения:</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{pv.blockers.map((b) => <li key={b} className="small">{b}</li>)}</ul></div>}
        {pv.notes.length > 0 && <div className="note small">{pv.notes.map((x) => <div key={x}>{x}</div>)}</div>}
        {done && <div className="okbox">{done}</div>}
        {can('label.print') && <button className="btn block" disabled={busy || !ready} onClick={() => run(async () => {
          const lb = await api<{ id: string; code: string }>(`/orgs/${org.id}/lots/${lotId}/consumer-label`, { body: { netMassG: num } });
          setLabel(lb);
          const r = await api<{ printed: number }>(`/orgs/${org.id}/labels/print`, { body: { labelIds: [lb.id], format, copies } });
          setDone(`В журнал маркировки записано этикеток: ${r.printed}.`);
          setTimeout(() => window.print(), 100);
        })}>Печать</button>}
        <h2>{ready ? 'Предпросмотр' : 'Черновик (не для печати)'}</h2>
      </div>
      <div className={`lb-sheet f-${format}`}>
        {Array.from({ length: label ? copies : 1 }, (_, i) => <ConsumerLabel key={i} p={pv.payload} code={label?.code || null} />)}
      </div>
    </>
  );
}
