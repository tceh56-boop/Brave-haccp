'use client';
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { lossPct } from '@/server/recipes/chain';

interface Line { name: string; unit: string; processing: string; brutto: number | null; netto: number | null; thermal: number | null; ready: number | null; in_yield: boolean;
  cold_pct: number | null; thermal_pct: number | null; after_pct: number | null }
interface Act { id: string; number: number; act_date: string; status: string; dish_name: string; dish_kind: string; site_name: string | null; site_id: string | null; ttk_version: number;
  commission: { position: string; name: string }[]; lines: Line[]; output_g: string | null; technology: string | null; note: string | null; approved_by_name: string | null; approved_at: string | null;
  org: { name: string; legal_form: string | null }; basis: string }

const s = (v: number | null) => (v === null ? '' : String(v).replace('.', ','));
const pct = (v: number | null) => (v === null ? '' : String(v).replace('.', ','));
const num = (v: string) => (v.trim() ? Number(v.replace(',', '.')) : null);

/** Акт контрольной проработки: в черновике — ввод фактических масс, проценты считаются сразу; печатная форма. */
export default function ActPage({ params }: { params: Promise<{ dishId: string; actId: string }> }) {
  const { dishId, actId } = use(params);
  const { org, can } = useOrg();
  const [a, setA] = useState<Act | null>(null);
  const [rows, setRows] = useState<{ brutto: string; netto: string; thermal: string; ready: string }[]>([]);
  const [out, setOut] = useState('');
  const [tech, setTech] = useState('');
  const { busy, error, run } = useSubmit();
  const load = useCallback(() => api<Act>(`/orgs/${org.id}/control-acts/${actId}`).then((x) => {
    setA(x); setRows(x.lines.map((l) => ({ brutto: s(l.brutto), netto: s(l.netto), thermal: s(l.thermal), ready: s(l.ready) }))); setOut(x.output_g ? s(Number(x.output_g)) : ''); setTech(x.technology || '');
  }), [org.id, actId]);
  useEffect(() => { load(); }, [load]);
  if (!a) return error ? <div className="err">{error}</div> : <p className="muted">Загрузка…</p>;
  const draft = a.status === 'draft' && can('ttk.manage');
  const put = () => api(`/orgs/${org.id}/control-acts/${a.id}`, { method: 'PATCH', body: { lines: rows.map((r) => ({ brutto: num(r.brutto), netto: num(r.netto), thermal: num(r.thermal), ready: num(r.ready) })), outputG: num(out), technology: tech } });
  const save = () => run(async () => { await put(); await load(); });
  const lines = draft ? a.lines.map((l, i) => {
    const r = rows[i] || { brutto: '', netto: '', thermal: '', ready: '' };
    const b = num(r.brutto), n = num(r.netto), t = num(r.thermal), y = num(r.ready);
    return { ...l, brutto: b, netto: n, thermal: t, ready: y, cold_pct: lossPct(b, n), thermal_pct: lossPct(n, t), after_pct: lossPct(t, y) };
  }) : a.lines;
  const orgName = `${a.org.legal_form && a.org.legal_form !== 'другое' && !a.org.name.startsWith(a.org.legal_form) ? `${a.org.legal_form} ` : ''}${a.org.name}`;
  const cell = (i: number, k: 'brutto' | 'netto' | 'thermal' | 'ready') => (
    <input aria-label={`${k} ${a.lines[i].name}`} inputMode="decimal" value={rows[i]?.[k] ?? ''} style={{ width: 64, padding: '2px 4px', minHeight: 28 }}
      onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} />);
  return (
    <>
      <div className="noprint">
        <p className="small"><Link href={`/app/${org.id}/menu/${dishId}/acts`}>← Акты проработки</Link></p>
        {draft ? (
          <div className="note small">Черновик: впишите фактические массы после взвешивания (г) и выход готового изделия, сохраните. Проценты отходов считаются по массам.
            Утверждает шеф, технолог или руководитель; после утверждения акт не меняется.</div>
        ) : <p className="small muted">Утверждён{a.approved_by_name ? `: ${a.approved_by_name}` : ''}. Основание для норм обработки: «{a.basis}».</p>}
        {error && <div className="err" role="alert">{error}</div>}
        <div className="row">
          {draft && <button className="btn" disabled={busy} onClick={save}>Сохранить массы</button>}
          {a.status === 'draft' && can('ttk.approve') && <button className="btn secondary" disabled={busy} onClick={() => run(async () => { if (draft) await put(); await api(`/orgs/${org.id}/control-acts/${a.id}/approve`, { body: {} }); await load(); })}>Утвердить акт</button>}
          <button className="btn secondary" onClick={() => window.print()}>Печать / PDF</button>
        </div>
      </div>
      <article className="tu-doc act-doc">
        <p style={{ fontWeight: 700, fontSize: '12pt', textDecoration: 'underline' }}>{orgName}</p>
        <h1 style={{ marginBottom: 0 }}>АКТ</h1>
        <p className="tu-center" style={{ marginTop: 2 }}>контрольной проработки кулинарной продукции, мучных кондитерских и булочных изделий, определения норм отходов и потерь на новые виды сырья, пищевых продуктов, материалов{a.status === 'draft' ? ' — ЧЕРНОВИК' : ''}</p>
        <table style={{ border: 0 }}><tbody><tr>
          <td style={{ border: 0, borderBottom: '1px solid #111', textAlign: 'center' }}>{a.site_name || ''}<div className="tu-small">Место проведения</div></td>
          <td style={{ border: 0, width: 30 }} />
          <td style={{ border: 0, borderBottom: '1px solid #111', textAlign: 'center', width: 140 }}>№ {a.number} · {a.act_date.split('-').reverse().join('.')}<div className="tu-small">Дата проведения</div></td>
        </tr></tbody></table>
        <p>Комиссией в составе: {a.commission.length ? a.commission.map((m) => `${m.position} ${m.name}`).join('; ') : '________________'}</p>
        <p>Проведено контрольное приготовление блюда: <b style={{ fontSize: '12pt' }}>{a.dish_name}</b> (ТТК версия {a.ttk_version})</p>
        <p>Для контрольной проработки взято: <i>{a.lines.map((l) => l.name).join(', ')}</i></p>
        <div className="scroll"><table>
          <thead><tr><th>№</th><th>Наименование сырья и полуфабрикатов</th><th>Вид обработки</th><th>Вес брутто, г</th><th>Отходы при хол. обраб., %</th><th>Вес нетто, г</th>
            <th>Потери при тепл. обраб., %</th><th>Отходы после тепл. обраб., %</th><th>Выход, г</th></tr></thead>
          <tbody>{lines.map((l, i) => (
            <tr key={i}><td>{i + 1}</td><td>{l.name}{!l.in_yield && <div className="tu-small">в выход не входит</div>}</td><td>{l.processing}</td>
              <td style={{ textAlign: 'right' }}>{draft ? cell(i, 'brutto') : s(l.brutto)}</td><td style={{ textAlign: 'right' }}>{pct(l.cold_pct)}</td>
              <td style={{ textAlign: 'right' }}>{draft ? cell(i, 'netto') : s(l.netto)}</td>
              <td style={{ textAlign: 'right' }}>{draft ? <>{cell(i, 'thermal')}<div className="tu-small">{pct(l.thermal_pct)}{l.thermal_pct !== null ? ' %' : ''}</div></> : pct(l.thermal_pct)}</td>
              <td style={{ textAlign: 'right' }}>{pct(l.after_pct)}</td><td style={{ textAlign: 'right' }}>{draft ? cell(i, 'ready') : s(l.ready)}</td></tr>
          ))}
            <tr><td colSpan={8} style={{ textAlign: 'right', border: 0 }}>Выход готового изделия, г:</td>
              <td style={{ textAlign: 'right' }}>{draft ? <input aria-label="Выход готового изделия" inputMode="decimal" value={out} onChange={(e) => setOut(e.target.value)} style={{ width: 64, padding: '2px 4px', minHeight: 28 }} /> : s(a.output_g === null ? null : Number(a.output_g))}</td></tr>
          </tbody>
        </table></div>
        {draft && <p className="tu-small">В черновике столбец «после тепловой обработки» — масса после тепловой обработки, г (под ней — процент потерь).</p>}
        <h2 style={{ textAlign: 'center', border: 0, textDecoration: 'underline' }}>Технология приготовления:</h2>
        {draft ? <textarea aria-label="Технология" rows={4} value={tech} onChange={(e) => setTech(e.target.value)} /> : <p style={{ whiteSpace: 'pre-line', textAlign: 'center' }}>{a.technology || ''}</p>}
        <p style={{ marginTop: 16 }}>Подписи членов комиссии:</p>
        <table style={{ border: 0 }}><tbody>{a.commission.map((m, i) => (
          <tr key={i}><td style={{ border: 0, width: '40%' }} /><td style={{ border: 0, borderBottom: '1px solid #111', width: '30%' }} /><td style={{ border: 0, textAlign: 'right' }}>{m.name}</td></tr>))}</tbody></table>
      </article>
    </>
  );
}
