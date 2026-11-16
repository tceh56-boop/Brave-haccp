'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { api } from '@/lib/api';
import { n } from '@/lib/fmt';

/** Единая карточка продукта (ТЗ доработки, 5.1): всё о блюде или полуфабрикате на одном экране, со ссылками в разделы. */

type DocV = { version: number; designation?: string | null; approved_at: string; outdated: boolean } | null;
interface Card {
  dish: { id: string; name: string; kind: string; card_no: number | null };
  ttk: { version: number; card_date: string | null; approved_at: string; approver: string | null; yield_g: string; portion_g: string | null } | null;
  semis: { id: string; name: string; version: number | null }[];
  documents: { tu: DocV; ti: DocV; sto: { id: string; seq: number; title: string; version: number | null; designation: string | null; review_due: string | null }[];
    costing: { doc_no: string; calc_date: string; cost_1: string | null; sale_price: string | null; outdated: boolean } | null };
  composition: { recipe?: { name: string; kind: string; netto_g: number | null }[]; allergens?: string[]; allergens_complete?: boolean; allergens_missing?: string[];
    nutrition?: { protein: number; fat: number; carbs: number; kcal: number } | null; nutrition_coverage_pct?: number; nutrition_verified_pct?: number; error?: string } | null;
  storage: { conditions: string | null; shelf_life: string | null; shelf_life_hours: string | null; storage_hours: string | null; sale_hours: string | null; opened_hours: string | null; basis: string | null; after_opening: { hours: number; basis: string } | null } | null;
  labeling: { meat_group: string | null; meat_pct: number | null; eac: boolean; active_declaration: string | null; declarations: { id: string; number: number; scheme: string | null; status: string }[] };
  ccp: { name: string; unit: string | null; min_value: string | null; max_value: string | null; basis: string; hazard: string | null; class: string | null }[];
  lab: { programs: { test_type: string; target: string; period_days: number; next_due: string; basis: string }[]; results: { test_type: string; lab_name: string; protocol_no: string; sampled_on: string; result: string }[] };
  journals: { releases: number; samples: number; lab: number };
  history: { version: number; status: string; change_reason: string | null; created_at: string; author: string | null; approved_at: string | null; approver: string | null }[];
  issues: string[];
}
const d = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString('ru-RU') : '—');
const ST: Record<string, string> = { draft: 'черновик', review: 'на согласовании', approved: 'утверждена', archived: 'в архиве' };

export default function ProductCard({ params }: { params: Promise<{ dishId: string }> }) {
  const { dishId } = use(params);
  const { org, can } = useOrg();
  const [c, setC] = useState<Card | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<Card>(`/orgs/${org.id}/dishes/${dishId}/card`).then(setC).catch((e) => setErr(e.message)); }, [org.id, dishId]);
  if (err) return <div className="err">{err}</div>;
  if (!c) return <p className="muted">Загрузка…</p>;
  const b = `/app/${org.id}/menu/${dishId}`;
  const doc = (title: string, x: DocV, href: string) => (
    <><span>{title}</span><b style={{ fontWeight: 400 }}>{x ? <><Link href={href}>{x.designation || `версия ${x.version}`}</Link>, утв. {d(x.approved_at)}{x.outdated && <span className="badge crit" style={{ marginLeft: 6 }}>устарел — ТТК изменилась</span>}</> : 'нет'}</b></>);
  return (
    <>
      <p className="small"><Link href={b}>← {c.dish.name}</Link></p>
      <h1>{c.dish.name}</h1>
      <p className="muted">{c.dish.kind === 'semi' ? 'Полуфабрикат' : 'Блюдо'}{c.dish.card_no ? ` · ТТК № ${c.dish.card_no}` : ''}</p>
      {c.issues.length > 0 && <div className="err"><b>Требует внимания:</b><ul>{c.issues.map((i) => <li key={i} className="small">{i}</li>)}</ul></div>}

      <div className="card"><h2>Документы</h2>
        <div className="kv">
          <span>ТТК</span><b style={{ fontWeight: 400 }}>{c.ttk ? <><Link href={b}>версия {c.ttk.version}</Link>, утв. {d(c.ttk.approved_at)}{c.ttk.approver ? `, ${c.ttk.approver}` : ''}; выход {n(Number(c.ttk.yield_g))} г{c.ttk.portion_g ? `, порция ${n(Number(c.ttk.portion_g))} г` : ''}</> : 'нет утверждённой'}</b>
          {c.semis.length > 0 && <><span>Полуфабрикаты в составе</span><b style={{ fontWeight: 400 }}>{c.semis.map((s) => <span key={s.id}><Link href={`/app/${org.id}/menu/${s.id}/card`}>{s.name}</Link> ({s.version ? `ТТК v${s.version}` : 'нет утверждённой ТТК'}); </span>)}</b></>}
          {doc('ТУ', c.documents.tu, `${b}/tu`)}
          {doc('ТИ', c.documents.ti, `${b}/ti`)}
          <span>СТО</span><b style={{ fontWeight: 400 }}>{c.documents.sto.length ? c.documents.sto.map((s) => <span key={s.id}>{s.designation || s.title}{s.version ? `, версия ${s.version}` : ', не утверждён'}{s.review_due ? `, актуализация до ${d(s.review_due)}` : ''}; </span>) : 'нет'}</b>
          {can('cost.read') && <><span>Калькуляция</span><b style={{ fontWeight: 400 }}>{c.documents.costing ? <><Link href={`${b}/costing`}>№ {c.documents.costing.doc_no} от {d(c.documents.costing.calc_date)}</Link>{c.documents.costing.cost_1 ? `, себестоимость ${n(Number(c.documents.costing.cost_1))} ₽` : ''}{c.documents.costing.outdated && <span className="badge crit" style={{ marginLeft: 6 }}>по другой версии ТТК</span>}</> : 'нет'}</b></>}
        </div>
      </div>

      {c.composition && (
        <div className="card"><h2>Состав и аллергены</h2>
          {c.composition.error ? <p className="err">{c.composition.error}</p> : <>
            <p className="small">{(c.composition.recipe || []).filter((r) => r.netto_g).sort((a, b2) => (b2.netto_g || 0) - (a.netto_g || 0)).map((r) => r.name).join(', ')}</p>
            <p><b>Аллергены:</b> {c.composition.allergens?.length ? c.composition.allergens.join(', ') : c.composition.allergens_complete ? 'не содержит' : <span style={{ color: 'var(--crit)' }}>профиль неполный ({c.composition.allergens_missing?.join(', ')})</span>}</p>
            {c.composition.nutrition && <p className="small">В 100 г: белки {n(c.composition.nutrition.protein)}, жиры {n(c.composition.nutrition.fat)}, углеводы {n(c.composition.nutrition.carbs)} г; {c.composition.nutrition.kcal} ккал. Расчёт по {c.composition.nutrition_coverage_pct} % массы, по документам — {c.composition.nutrition_verified_pct} %.</p>}
          </>}
        </div>)}

      {c.storage && (
        <div className="card"><h2>Сроки и хранение</h2>
          <div className="kv">
            <span>Условия хранения</span><b style={{ fontWeight: 400 }}>{c.storage.conditions || 'не указаны'}</b>
            <span>Срок годности</span><b style={{ fontWeight: 400 }}>{c.storage.shelf_life || 'не указан'}{[[c.storage.storage_hours, 'хранение'], [c.storage.sale_hours, 'реализация'], [c.storage.shelf_life_hours, 'партия п/ф'], [c.storage.opened_hours, 'после вскрытия']]
              .filter(([h]) => h).map(([h, l]) => `; ${l} — ${n(Number(h))} ч`).join('')}{c.storage.basis ? ` (основание: ${c.storage.basis})` : ''}</b>
            <span>После вскрытия упаковки</span><b style={{ fontWeight: 400 }}>{c.storage.after_opening ? `${n(c.storage.after_opening.hours)} ч — ${c.storage.after_opening.basis}` : 'не установлен'}</b>
          </div>
        </div>)}

      <div className="card"><h2>Маркировка и подтверждение соответствия</h2>
        <div className="kv">
          <span>Группа (ТР ТС 034)</span><b style={{ fontWeight: 400 }}>{c.labeling.meat_group ? `${c.labeling.meat_group} (мясных ингредиентов ${c.labeling.meat_pct} %)` : c.labeling.meat_pct !== null ? `мясных ингредиентов ${c.labeling.meat_pct} %` : '—'}</b>
          <span>Знак ЕАС</span><b style={{ fontWeight: 400 }}>{c.labeling.eac ? `разрешён — ${c.labeling.active_declaration}` : 'нет действующей декларации'}</b>
          <span>Декларации</span><b style={{ fontWeight: 400 }}>{c.labeling.declarations.length ? c.labeling.declarations.map((x) => <span key={x.id}><Link href={`/app/${org.id}/declarations/${x.id}`}>№ {x.number}</Link> — {x.status}; </span>) : 'нет'}</b>
        </div>
      </div>

      <div className="card"><h2>ККТ / КТ при выпуске</h2>
        {c.ccp.length ? <ul>{c.ccp.map((x) => <li key={x.name} className="small">{x.hazard ? `${x.hazard} · ` : ''}{x.name}: {x.min_value !== null ? `от ${n(Number(x.min_value))}` : ''}{x.max_value !== null ? ` до ${n(Number(x.max_value))}` : ''} {x.unit || ''} — {x.basis}</li>)}</ul> : <p className="small muted">Проверок выпуска нет.</p>}
      </div>

      <div className="card"><h2>Лабораторные основания</h2>
        {c.lab.programs.length ? <ul>{c.lab.programs.map((p) => <li key={p.test_type + p.target} className="small">{p.test_type} — {p.target}, раз в {p.period_days} дн., следующее {d(p.next_due)} ({p.basis})</li>)}</ul> : <p className="small muted">В программе лабораторного контроля продукта нет.</p>}
        {c.lab.results.length > 0 && <ul>{c.lab.results.map((r) => <li key={r.protocol_no + r.sampled_on} className="small">Протокол № {r.protocol_no} от {d(r.sampled_on)}, {r.lab_name}: {r.test_type} — {r.result === 'pass' ? 'соответствует' : 'не соответствует'}</li>)}</ul>}
      </div>

      <div className="card"><h2>Журналы (за 30 дней)</h2>
        <p className="small">Выпуск партий: {c.journals.releases} (<Link href={`/app/${org.id}/journals/${c.dish.kind === 'semi' ? 'J55' : 'J58'}`}>{c.dish.kind === 'semi' ? 'J55' : 'J58'}</Link>) · суточные пробы: {c.journals.samples} (<Link href={`/app/${org.id}/journals/J59`}>J59</Link>) · лабораторные результаты: {c.journals.lab} (<Link href={`/app/${org.id}/journals/J60`}>J60</Link>)</p>
      </div>

      <div className="card"><h2>История изменений ТТК</h2>
        <div className="scroll"><table className="tbl small"><thead><tr><th>Версия</th><th>Статус</th><th>Причина изменения</th><th>Автор</th><th>Утверждена</th></tr></thead>
          <tbody>{c.history.map((h) => <tr key={h.version}><td>{h.version}</td><td>{ST[h.status] || h.status}</td><td>{h.change_reason || (h.version === 1 ? 'первичная разработка' : '—')}</td><td>{h.author || '—'}, {d(h.created_at)}</td><td>{h.approved_at ? `${d(h.approved_at)}, ${h.approver}` : '—'}</td></tr>)}</tbody></table></div>
      </div>
    </>
  );
}
