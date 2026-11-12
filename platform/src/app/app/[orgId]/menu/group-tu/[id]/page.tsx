'use client';
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { GTU_STATUS, type GtuData } from '@/lib/groupTu';

/** Карточка групповых ТУ: ассортимент и коды ОКПД2, титульные данные, проверки по ГОСТ Р 51740-2016, утверждение. */

const FIELDS: [string, string, string?][] = [['okpd2', 'Код ОКПД2 категории (4.2.8)', 'общий для всей продукции, напр. 10.13.14'], ['okpo', 'ОКПО держателя подлинника (4.4.1)'],
  ['seq', 'Регистрационный номер ТУ (до 3 цифр)'], ['tuOks', 'ОКС / КГС (4.2.9)'], ['tuReplaces', 'Взамен (4.2.6)'], ['tuIntroDate', 'Дата введения (4.2.7)', 'ГГГГ-ММ-ДД'],
  ['tuDeveloper', 'Разработчик (4.2.12)'], ['tuLocation', 'Местонахождение держателя подлинника (4.2.13)'], ['tuPurpose', 'Назначение продукции (5.1.2)'], ['channel', 'Реализация (через что)'],
  ['packaging', 'Упаковка: способ, вид потребительской и транспортной упаковки']];

export default function GroupTu({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { org, can } = useOrg();
  const [d, setD] = useState<GtuData | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [lab, setLab] = useState('');
  const [saved, setSaved] = useState(false);
  const { busy, error, run, setError } = useSubmit();
  const apply = (x: GtuData) => {
    setD(x);
    setF(Object.fromEntries(FIELDS.map(([k]) => [k, String(x.spec.params[k] ?? '')])));
    setCodes(Object.fromEntries(x.spec.dish_ids.map((dish) => [dish, x.spec.params.items?.[dish]?.okpd2 || ''])));
  };
  useEffect(() => { let live = true; api<GtuData>(`/orgs/${org.id}/group-tu/${id}`).then((x) => { if (live) apply(x); }).catch((e) => { if (live) setError(e.message); }); return () => { live = false; }; }, [org.id, id, setError]);
  const load = useCallback(() => api<GtuData>(`/orgs/${org.id}/group-tu/${id}`).then(apply).catch((e) => setError(e.message)), [org.id, id, setError]);
  if (!d) return error ? <div className="err">{error}</div> : <p className="muted">Загрузка…</p>;
  const c = d.calc, manage = can('ttk.manage');
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/menu/group-tu`}>← Групповые ТУ</Link></p>
      <div className="between"><h1 style={{ margin: 0 }}>{d.spec.title}</h1><span className={`badge ${GTU_STATUS[c.status]?.[1] || ''}`}>{GTU_STATUS[c.status]?.[0] || c.status}</span></div>
      <p className="muted">{c.designation} · наименований: {c.items.length}{c.meat_regulation ? ` · ${c.meat_regulation === 'trts034' ? 'ТР ТС 034/2013' : 'ТР ЕАЭС 051/2021'}` : ''}</p>
      <p className="row" style={{ gap: 6 }}><Link className="btn small secondary" href={`/app/${org.id}/menu/group-tu/${id}/print`}>Документ (проект)</Link>
        {d.versions.map((v) => <Link key={v.version} className="btn small secondary" href={`/app/${org.id}/menu/group-tu/${id}/print?v=${v.version}`}>Версия {v.version}</Link>)}</p>
      {error && <div className="err">{error}</div>}
      {c.errors.length > 0 && <div className="err"><b>Ошибки — утвердить нельзя:</b><ul>{c.errors.map((e) => <li key={e} className="small">{e}</li>)}</ul></div>}
      {c.warnings.length > 0 && <div className="note"><b>Замечания:</b><ul>{c.warnings.map((e) => <li key={e} className="small">{e}</li>)}</ul></div>}

      <div className="card">
        <h2>Ассортимент</h2>
        <div className="scroll"><table className="tbl small"><thead><tr><th>Наименование</th><th>ТТК</th><th>Код ОКПД2 (9 знаков)</th><th>Группа микробиологии</th><th>Расчёт</th></tr></thead>
          <tbody>{c.items.map((i) => (
            <tr key={i.dish_id}>
              <td><Link href={`/app/${org.id}/menu/${i.dish_id}/tu`}>{i.name}</Link></td><td>v{i.ttk_version}</td>
              <td>{manage ? <input aria-label={`ОКПД2: ${i.name}`} value={codes[i.dish_id] || ''} onChange={(e) => { setSaved(false); setCodes({ ...codes, [i.dish_id]: e.target.value }); }} placeholder="10.13.14.700" style={{ width: 130 }} /> : i.okpd2 || '—'}</td>
              <td>{i.micro.mode === 'law' ? i.micro.group : <span style={{ color: 'var(--crit)' }}>не выбрана — в ТУ блюда</span>}</td>
              <td><span className={`badge ${GTU_STATUS[i.status]?.[1] || ''}`}>{GTU_STATUS[i.status]?.[0] || i.status}</span></td>
            </tr>))}</tbody></table></div>
        {manage && <p className="small muted">Группу микробиологических нормативов, сроки и пищевую ценность задают в ТУ блюда и в его ТТК — групповые ТУ собирают их без ручного дублирования.</p>}
        {manage && <details><summary className="small">Изменить ассортимент</summary>
          <div style={{ maxHeight: 220, overflow: 'auto' }}>{d.dishes.map((x) => <label key={x.id} className="check"><input type="checkbox" checked={d.spec.dish_ids.includes(x.id)} disabled={busy}
            onChange={(e) => run(async () => { const ids = e.target.checked ? [...d.spec.dish_ids, x.id] : d.spec.dish_ids.filter((y) => y !== x.id); apply(await api<GtuData>(`/orgs/${org.id}/group-tu/${id}`, { method: 'PATCH', body: { dishIds: ids } })); })} /> {x.name}</label>)}</div>
        </details>}
      </div>

      {manage && (
        <div className="card">
          <h2>Титульный лист и общие данные</h2>
          <form onSubmit={(e) => { e.preventDefault(); run(async () => {
            const items = Object.fromEntries(Object.entries(codes).map(([k, v]) => [k, { okpd2: v || null }]));
            apply(await api<GtuData>(`/orgs/${org.id}/group-tu/${id}`, { method: 'PATCH', body: { ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v || null])), items } })); setSaved(true);
          }); }}>
            {FIELDS.map(([k, l, ph]) => <div key={k}><label htmlFor={`g-${k}`}>{l}</label>
              {k === 'packaging' || k === 'tuPurpose' ? <textarea id={`g-${k}`} rows={2} value={f[k] || ''} onChange={(e) => { setSaved(false); setF({ ...f, [k]: e.target.value }); }} />
                : <input id={`g-${k}`} value={f[k] || ''} placeholder={k === 'okpd2' && c.suggested_category ? `предложение: ${c.suggested_category}` : ph} onChange={(e) => { setSaved(false); setF({ ...f, [k]: e.target.value }); }} />}</div>)}
            {saved && <div className="okbox">Сохранено.</div>}
            <button className="btn" disabled={busy}>Сохранить и проверить</button>
          </form>
        </div>)}

      {can('ttk.approve') && (
        <div className="card">
          <h2>Утверждение</h2>
          <p className="small">Утверждаются только групповые ТУ без ошибок и замечаний, с полным расчётом по каждому наименованию. Утверждённая версия не меняется.</p>
          <label htmlFor="gl">Протоколы испытаний аккредитованной лаборатории (по наименованиям)</label>
          <textarea id="gl" rows={2} value={lab} onChange={(e) => setLab(e.target.value)} />
          <button className="btn" disabled={busy || c.status !== 'ready' || lab.length < 8} onClick={() => run(async () => { await api(`/orgs/${org.id}/group-tu/${id}/approve`, { body: { labProtocol: lab } }); setLab(''); await load(); })}>Утвердить</button>
          {d.versions.length > 0 && <ul>{d.versions.map((v) => <li key={v.version} className="small">Версия {v.version}: {v.designation}, утверждена {new Date(v.approved_at).toLocaleDateString('ru-RU')}, {v.approved_by_name}; протоколы: {v.lab_protocol}</li>)}</ul>}
        </div>)}
    </>
  );
}
