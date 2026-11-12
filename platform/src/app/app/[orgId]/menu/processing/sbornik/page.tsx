'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { n } from '@/lib/fmt';

interface Cand { key: string; kind: 'table' | 'cold' | 'thermal'; method: string; name: string; pct: number; season: [number, number] | null; group: string | null; basis: string; note: string | null;
  alternatives?: { pct: number; recipes: number[] }[] }
interface Item { product_id: string; product_name: string; unit: string; approved_methods: string[]; candidates: Cand[] }
interface R { source: { title: string; edition: string; publisher: string; table_pages: string; recipes: number }; items: Item[]; products: number }

const METHOD: Record<string, string> = { clean: 'Очистка', defrost: 'Размораживание', boil: 'Варка', poach: 'Припускание', saute: 'Пассерование', fry: 'Жарка', stew: 'Тушение', bake: 'Запекание', blanch: 'Бланширование', steam: 'Варка на пару' };
const KIND: Record<Cand['kind'], string> = { table: 'таблица сборника', cold: 'по рецептурам', thermal: 'по рецептурам' };
const md = (x: number) => `${String(x % 100).padStart(2, '0')}.${String(Math.floor(x / 100)).padStart(2, '0')}`;
const pctLabel = (c: Cand, p: number) => (p < 0 ? `привар ${n(-p)} %` : `${c.kind === 'thermal' ? 'потери' : 'отход'} ${n(p)} %`);

/**
 * Нормы обработки из Сборника рецептур (2022): система подбирает к каждому товару строки таблицы отходов и значения
 * из рецептур — холодная и тепловая обработка. Человек выбирает и вносит; с правом утверждения — сразу утверждает.
 */
export default function SbornikPage() {
  const { org, can } = useOrg();
  const [r, setR] = useState<R | null>(null);
  const [pick, setPick] = useState<Record<string, { key: string; pct: number }>>({});   // `${product}|${method}` → выбор
  const [approve, setApprove] = useState(true);
  const [done, setDone] = useState<string | null>(null);
  const { busy, error, run, setError } = useSubmit();
  const load = useCallback(() => api<R>(`/orgs/${org.id}/processing/sbornik`).then(setR).catch((e) => setError(e.message)), [org.id, setError]);
  useEffect(() => { load(); }, [load]);
  if (!r) return error ? <div className="err">{error}</div> : <p className="muted">Подбираю нормы…</p>;
  const manage = can('ttk.manage'), canApprove = can('ttk.approve');
  const chosen = Object.entries(pick);

  const toggle = (it: Item, c: Cand, pct = c.pct) => {
    const k = `${it.product_id}|${c.method}`;
    setPick((p) => { const x = { ...p }; if (x[k]?.key === c.key && x[k].pct === pct) delete x[k]; else x[k] = { key: c.key, pct }; return x; });
  };
  const submit = () => run(async () => {
    const res = await api<{ created: number; approved: number; replaced: number }>(`/orgs/${org.id}/processing/sbornik`, { body: {
      items: chosen.map(([k, v]) => ({ productId: k.split('|')[0], key: v.key, pct: v.pct })), approve: approve && canApprove } });
    setDone(`Внесено норм: ${res.created}${res.approved ? `, утверждено: ${res.approved}` : ' (черновики — ждут утверждения)'}${res.replaced ? `, заменено прежних: ${res.replaced}` : ''}.`);
    setPick({}); await load();
  });

  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/menu/processing`}>← Обработка сырья</Link></p>
      <h1>Нормы из Сборника рецептур</h1>
      <p className="small muted">{r.source.title}, {r.source.edition}, {r.source.publisher}. Холодная обработка — таблица «Расчет расхода сырья» (с. {r.source.table_pages}) и брутто/нетто рецептур;
        тепловая — масса после варки, припускания, тушения по рецептурам ({r.source.recipes} рецептур). Выберите для товара подходящую строку — система внесёт норму с основанием «издание, страница / номера рецептур».</p>
      {error && <div className="err" role="alert">{error}</div>}
      {done && <div className="okbox">{done}</div>}
      {!r.items.length && <div className="card"><p className="muted">Ни одному из {r.products} товаров не нашлось строки в сборнике. Нормы вносятся вручную по акту контрольной проработки.</p></div>}

      {r.items.map((it) => {
        const byMethod = new Map<string, Cand[]>();
        for (const c of it.candidates) byMethod.set(c.method, [...(byMethod.get(c.method) || []), c]);
        return (
          <div className="card" key={it.product_id}>
            <h2 style={{ marginTop: 0 }}>{it.product_name}</h2>
            {[...byMethod.entries()].map(([m, list]) => (
              <div key={m} style={{ marginBottom: 8 }}>
                <div className="small"><b>{METHOD[m] || m}</b>{it.approved_methods.includes(m) && <span className="badge ok" style={{ marginLeft: 6 }}>норма есть</span>}</div>
                {(() => {
                  const uniq = list.filter((c) => !c.group || list.find((x) => x.group === c.group) === c);
                  const row = (c: Cand) => {
                    const k = `${it.product_id}|${c.method}`, sel = pick[k]?.key === c.key;
                    const seasons = c.group ? list.filter((x) => x.group === c.group).sort((a, b) => (a.season![0] < 901 ? a.season![0] + 1300 : a.season![0]) - (b.season![0] < 901 ? b.season![0] + 1300 : b.season![0])) : [c];
                    return (
                      <div key={c.key} style={{ padding: '6px 0' }}>
                        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontWeight: 400 }}>
                          {manage && <input type="radio" name={k} checked={sel} onChange={() => toggle(it, c)} onClick={() => sel && toggle(it, c)} style={{ width: 22, minHeight: 22, flex: 'none' }} />}
                          <span>
                            <b>{c.group ? seasons.map((x) => `${md(x.season![0])}–${md(x.season![1])}: ${n(x.pct)} %`).join('; ') : pctLabel(c, sel ? pick[k].pct : c.pct)}</b>
                            <span className="small"> · {c.group || c.name} · {KIND[c.kind]}</span>
                            {sel && <div className="small muted">Основание: {c.basis}</div>}
                            {c.note && <div className="small">{c.note}</div>}
                            {sel && c.alternatives && c.alternatives.length > 1 && (
                              <div className="chips" style={{ marginTop: 4 }}>{c.alternatives.map((a) => (
                                <button key={a.pct} type="button" aria-pressed={pick[k].pct === a.pct} onClick={() => setPick({ ...pick, [k]: { key: c.key, pct: a.pct } })}>
                                  {n(a.pct)} % · {a.recipes.length} рец.</button>))}</div>)}
                          </span>
                        </label>
                      </div>);
                  };
                  return <>{row(uniq[0])}{uniq.length > 1 && <details><summary className="small">ещё варианты ({uniq.length - 1})</summary>{uniq.slice(1).map(row)}</details>}</>;
                })()}
              </div>))}
          </div>);
      })}

      {manage && chosen.length > 0 && (
        <div className="card" style={{ position: 'sticky', bottom: 8 }}>
          <div className="between"><b>Выбрано: {chosen.length}</b>
            {canApprove && <label className="row" style={{ fontWeight: 400 }}><input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} style={{ width: 22, minHeight: 22 }} /> сразу утвердить</label>}</div>
          <button className="btn block" disabled={busy} onClick={submit}>{approve && canApprove ? 'Внести и утвердить' : 'Внести как черновики'}</button>
          <p className="small muted">Утверждённая норма заменяет прежнюю по тому же способу и сезону. Ваши фактические отходы отличаются — оформите акт контрольной проработки и внесите норму по нему.</p>
        </div>)}
    </>
  );
}
