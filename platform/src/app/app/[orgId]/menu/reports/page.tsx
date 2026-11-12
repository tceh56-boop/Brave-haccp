'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useOrg } from '@/lib/org';
import { api } from '@/lib/api';
import { GroupSelect, type Group } from '@/components/GroupSelect';
import { fx, orgTitle } from '@/lib/ttkdoc';

type Per = { protein: number; fat: number; carbs: number; kcal: number; kj: number };
interface Row { id: string; name: string; kind: string; card_no: string | null; group: string | null; out_g: number; out_label: string; nutrition: { total: Per; per100: Per; complete: boolean } | null;
  description?: string | null; price?: number | null; allergens?: string[]; allergens_complete?: boolean;
  lines?: { kind: string; name: string; brutto_g: number | null; netto_g: number | null; ready_g: number | null; processing: string; in_yield: boolean }[]; technology?: string | null; serving?: string | null }
interface Report { kind: string; group: string | null; org: { name: string; legal_form: string | null }; rows: Row[]; see_price: boolean; generated_at: string }
interface Usage { product: { id: string; name: string; unit: string }; rows: { dish_id: string; name: string; kind: string; status: string; version: number; via: string | null; brutto: number | null; netto: number | null; unit: string; basis: string }[] }
interface Product { id: string; name: string; unit: string }

const KINDS = [['info', 'Информационный лист'], ['calories', 'Лист калорийности'], ['bookmarks', 'Закладки для поваров'], ['ingredient', 'Содержание ингредиента']] as const;
const ST: Record<string, string> = { approved: 'утверждена', draft: 'черновик', review: 'на согласовании', archived: 'архив' };

/** Отчёты по меню (как в Шеф Эксперте): по утверждённым ТТК, отбор по папке; печать. */
export default function ReportsPage() {
  return <Suspense fallback={<p className="muted">Загрузка…</p>}><View /></Suspense>;
}

function View() {
  const { org } = useOrg();
  const sp = useSearchParams(), router = useRouter();
  const kind = sp.get('kind') || 'info', groupId = sp.get('group') || '', productId = sp.get('product') || '';
  const [groups, setGroups] = useState<Group[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [rep, setRep] = useState<Report | null>(null);
  const [use, setUse] = useState<Usage | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const go = (p: Record<string, string>) => router.replace(`/app/${org.id}/menu/reports?${new URLSearchParams(Object.entries({ kind, group: groupId, product: productId, ...p }).filter(([, v]) => v))}`);
  useEffect(() => {
    api<Group[]>(`/orgs/${org.id}/dish-groups`).then(setGroups).catch(() => setGroups([]));
    api<Product[]>(`/orgs/${org.id}/products`).then(setProducts).catch(() => setProducts([]));
  }, [org.id]);
  useEffect(() => {
    let off = false;
    setRep(null); setUse(null); setErr(null);
    if (kind === 'ingredient') { if (productId) api<Usage>(`/orgs/${org.id}/menu-reports/ingredient?productId=${productId}`).then((x) => { if (!off) setUse(x); }).catch((e) => setErr(e.message)); }
    else api<Report>(`/orgs/${org.id}/menu-reports?kind=${kind}${groupId ? `&groupId=${groupId}` : ''}`).then((x) => { if (!off) setRep(x); }).catch((e) => setErr(e.message));
    return () => { off = true; };
  }, [org.id, kind, groupId, productId]);
  const title = KINDS.find(([k]) => k === kind)?.[1] || '';
  return (
    <>
      <div className="noprint">
        <p className="small"><Link href={`/app/${org.id}/menu`}>← Блюда и ТТК</Link></p>
        <h1>Отчёты по меню</h1>
        <div className="chips">{KINDS.map(([k, l]) => <button key={k} aria-pressed={kind === k} onClick={() => go({ kind: k })}>{l}</button>)}</div>
        {kind === 'ingredient' ? (
          <><label htmlFor="rp">Ингредиент</label>
            <select id="rp" value={productId} onChange={(e) => go({ product: e.target.value })}><option value="">— выберите —</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></>
        ) : (
          <><label htmlFor="rg">Папка</label><GroupSelect id="rg" groups={groups} value={groupId} onChange={(v) => go({ group: v })} empty="— все блюда —" /></>
        )}
        <button className="btn block secondary" style={{ marginTop: 8 }} onClick={() => window.print()}>Печать / сохранить PDF</button>
        {err && <div className="err">{err}</div>}
      </div>
      <article className="tu-doc">
        <div style={{ borderBottom: '1px solid #111' }}>{rep ? orgTitle(rep.org) : org.name}</div>
        <h1>{title}{rep?.group ? ` — ${rep.group}` : ''}{use ? ` «${use.product.name}»` : ''}</h1>
        {rep && rep.rows.length === 0 && <p>Нет блюд с утверждённой ТТК{rep.group ? ' в этой папке' : ''}.</p>}
        {rep?.kind === 'info' && rep.rows.map((r) => (
          <div key={r.id} style={{ breakInside: 'avoid', borderBottom: '1px solid #ccc', padding: '8px 0' }}>
            <div className="between"><b style={{ fontSize: '12pt' }}>{r.name}</b><span>{fx(r.out_g, 0)} г{rep.see_price && r.price !== null ? ` · ${fx(r.price, 2)} ₽` : ''}</span></div>
            {r.description && <p style={{ margin: '4px 0' }}>{r.description}</p>}
            <p className="tu-small" style={{ margin: '2px 0' }}>{r.nutrition ? `Порция: белки ${fx(r.nutrition.total.protein, 1)} г, жиры ${fx(r.nutrition.total.fat, 1)} г, углеводы ${fx(r.nutrition.total.carbs, 1)} г, ${fx(r.nutrition.total.kcal, 0)} ккал / ${fx(r.nutrition.total.kj, 0)} кДж`
              : 'Пищевая ценность не рассчитана'}{r.nutrition && !r.nutrition.complete ? ' (расчёт неполный)' : ''}</p>
            <p className="tu-small" style={{ margin: '2px 0' }}>Аллергены: {r.allergens!.length ? r.allergens!.join(', ') : r.allergens_complete ? 'не содержит' : 'сведения неполные — уточняйте у официанта'}</p>
          </div>))}
        {rep?.kind === 'calories' && rep.rows.length > 0 && (
          <div className="scroll"><table>
            <thead><tr><th>№</th><th>Блюдо (изделие)</th><th>Выход, г</th><th>Белки, г</th><th>Жиры, г</th><th>Углеводы, г</th><th>ккал</th><th>ккал на 100 г</th></tr></thead>
            <tbody>{rep.rows.map((r, i) => (
              <tr key={r.id}><td>{i + 1}</td><td>{r.name}{r.kind === 'semi' ? ' (п/ф)' : ''}</td><td>{fx(r.out_g, 0)}</td>
                {r.nutrition ? <><td>{fx(r.nutrition.total.protein, 1)}</td><td>{fx(r.nutrition.total.fat, 1)}</td><td>{fx(r.nutrition.total.carbs, 1)}</td><td>{fx(r.nutrition.total.kcal, 0)}</td><td>{fx(r.nutrition.per100.kcal, 0)}{r.nutrition.complete ? '' : '*'}</td></>
                  : <td colSpan={5}>не рассчитано</td>}</tr>))}</tbody>
          </table></div>)}
        {rep?.kind === 'calories' && rep.rows.some((r) => r.nutrition && !r.nutrition.complete) && <p className="tu-small">* расчёт неполный — нет данных части сырья.</p>}
        {rep?.kind === 'bookmarks' && rep.rows.map((r) => (
          <div key={r.id} style={{ breakInside: 'avoid', border: '1px solid #888', padding: 8, margin: '8px 0' }}>
            <div className="between"><b style={{ fontSize: '12pt' }}>{r.name}</b><span className="tu-small">ТТК № {r.card_no || '—'} · {r.out_label}</span></div>
            <table style={{ fontSize: '9pt' }}><thead><tr><th>Сырьё</th><th>Брутто</th><th>Нетто</th><th>Выход</th><th>Обработка</th></tr></thead>
              <tbody>{r.lines!.map((l, i) => l.kind === 'heading' ? <tr key={i}><td colSpan={5}><i>{l.name}</i></td></tr>
                : <tr key={i}><td>{l.name}</td><td>{fx(l.brutto_g, 1)}</td><td>{fx(l.netto_g, 1)}</td><td>{l.in_yield ? fx(l.ready_g, 1) : '—'}</td><td className="tu-small">{l.processing}</td></tr>)}</tbody></table>
            {r.technology && <p className="tu-small" style={{ whiteSpace: 'pre-line', margin: '4px 0' }}>{r.technology}</p>}
            {r.serving && <p className="tu-small" style={{ margin: '4px 0' }}>Подача: {r.serving}</p>}
          </div>))}
        {kind === 'ingredient' && !productId && <p className="noprint muted">Выберите ингредиент.</p>}
        {use && (use.rows.length === 0 ? <p>Ингредиент не входит ни в одну действующую рецептуру.</p> : (
          <div className="scroll"><table>
            <thead><tr><th>№</th><th>Блюдо / п/ф</th><th>ТТК</th><th>Брутто</th><th>Нетто</th><th>Как входит</th></tr></thead>
            <tbody>{use.rows.map((r, i) => (
              <tr key={`${r.dish_id}-${i}`}><td>{i + 1}</td><td>{r.name}{r.kind === 'semi' ? ' (п/ф)' : ''}</td><td>v{r.version}, {ST[r.status] || r.status}</td>
                <td>{r.brutto === null ? '—' : `${fx(r.brutto, 3)} ${r.unit}`}</td><td>{r.netto === null ? '—' : `${fx(r.netto, 3)} ${r.unit}`}</td><td className="tu-small">{r.via ? `через п/ф «${r.via}»` : `напрямую, ${r.basis}`}</td></tr>))}</tbody>
          </table></div>))}
      </article>
    </>
  );
}
