'use client';
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { dt } from '@/lib/fmt';
import type { TiCalc } from '@/lib/ti';

interface Data { params: Record<string, unknown> & { rawDocs?: Record<string, string> }; calc: TiCalc;
  versions: { version: number; designation: string; change_note: string; approved_at: string; approved_by_name: string; ttk_version: number }[] }

/**
 * Технологическая инструкция: что собрано из системы, что вписывает технолог (НД на сырьё, упаковка и маркировка,
 * оборудование, требования безопасности), утверждение — снимок в листе регистрации изменений.
 */
export default function TiPage({ params }: { params: Promise<{ dishId: string }> }) {
  const { dishId } = use(params);
  const { org, can } = useOrg();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api<Data>(`/orgs/${org.id}/dishes/${dishId}/ti`).then(setD).catch((e) => setErr(e.message)), [org.id, dishId]);
  useEffect(() => { load(); }, [load]);
  if (err) return <><p className="small"><Link href={`/app/${org.id}/menu/${dishId}`}>← Карточка блюда</Link></p><div className="err">{err}</div></>;
  if (!d) return <p className="muted">Загрузка…</p>;
  const c = d.calc;
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/menu/${dishId}`}>← {c.dish.name}</Link></p>
      <h1>Технологическая инструкция</h1>
      <p><b>{c.designation}</b> <span className={`badge ${c.status === 'ready' ? 'ok' : 'warn'}`}>{c.status === 'ready' ? 'готова к утверждению' : 'проект'}</span></p>
      <p className="small muted">По утверждённой ТТК № {c.ttk.card_no || '—'} (версия {c.ttk.version}){c.tu ? `, ${c.tu.designation}` : ''}. Рецептура, обработка сырья, контроль и санитария — из системы.</p>
      <Link className="btn block secondary" href={`/app/${org.id}/menu/${dishId}/ti/print`}>Документ ТИ (текущий расчёт)</Link>
      {c.warnings.length > 0 && <div className="note"><b>Чтобы утвердить, осталось:</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{c.warnings.map((w) => <li key={w} className="small">{w}</li>)}</ul></div>}
      {can('ttk.manage') && <Params d={d} dishId={dishId} onDone={load} />}
      <Approve d={d} dishId={dishId} onDone={load} />
      <div className="card">
        <h2>Лист регистрации изменений</h2>
        {d.versions.length === 0 ? <p className="muted">Утверждённых версий нет.</p> : (
          <ul className="list">{d.versions.map((v) => (
            <li key={v.version}><Link className="between" href={`/app/${org.id}/menu/${dishId}/ti/print?v=${v.version}`}>
              <span><b>Изм. {v.version}</b> · {v.change_note}<div className="small muted">{v.designation} · ТТК v{v.ttk_version} · {v.approved_by_name}, {dt(v.approved_at, org.timezone)}</div></span><span aria-hidden>›</span>
            </Link></li>))}</ul>
        )}
      </div>
    </>
  );
}

function Params({ d, dishId, onDone }: { d: Data; dishId: string; onDone: () => void }) {
  const { org } = useOrg();
  const p = d.params;
  const s = (k: string) => (p[k] === null || p[k] === undefined ? '' : String(p[k]));
  const [f, setF] = useState({ okpd2: s('okpd2'), okpo: s('okpo'), tiSeq: s('tiSeq'), tiGroup: s('tiGroup'), tiOks: s('tiOks'), tiCity: s('tiCity'),
    tiPackaging: s('tiPackaging'), tiEquipment: s('tiEquipment'), tiSafety: s('tiSafety'), tiEnvironment: s('tiEnvironment'), rawDocs: { ...(p.rawDocs || {}) } as Record<string, string> });
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useSubmit();
  const t = (k: keyof typeof f, label: string, ph = '', rows = 0) => (
    <div><label htmlFor={`ti-${k}`}>{label}</label>{rows ? <textarea id={`ti-${k}`} rows={rows} value={f[k] as string} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={ph} />
      : <input id={`ti-${k}`} value={f[k] as string} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={ph} />}</div>);
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => {
      const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === 'string' ? v.trim() || null : Object.fromEntries(Object.entries(v).filter(([, x]) => x.trim()))]));
      await api(`/orgs/${org.id}/dishes/${dishId}/tu`, { method: 'PUT', body }); setSaved(true); onDone();
    }); }}>
      <h2>Что вписывает технолог</h2>
      <h3>Титульный лист</h3>
      <div className="grid2">
        {t('okpd2', 'Код продукции ОКПД2', '10.85.19')}{t('okpo', 'ОКПО предприятия')}{t('tiSeq', 'Порядковый номер ТИ', '001')}
        {t('tiGroup', 'Группа (классификатор)', 'Н31')}{t('tiOks', 'Код ОКС', '67.060')}{t('tiCity', 'Город', 'Москва')}
      </div>
      <h3 style={{ marginTop: 10 }}>2. Нормативные документы на сырьё</h3>
      {d.calc.raw.map((r) => (
        <div key={r.product_id}><label htmlFor={`rd-${r.product_id}`}>{r.name}</label>
          <input id={`rd-${r.product_id}`} value={f.rawDocs[r.product_id] || ''} onChange={(e) => setF({ ...f, rawDocs: { ...f.rawDocs, [r.product_id]: e.target.value } })} placeholder="ГОСТ, ТУ изготовителя, спецификация" /></div>))}
      <h3 style={{ marginTop: 10 }}>Разделы</h3>
      {t('tiEquipment', 'Оборудование и инвентарь (раздел 4)', 'плита, пароконвектомат, весы…', 2)}
      {t('tiPackaging', '5. Упаковка и маркировка', 'тара, упаковочные материалы; сведения на этикетке по ТР ТС 022/2011', 3)}
      {t('tiSafety', '9. Требования безопасности', 'охрана труда, работа с оборудованием, инструктажи', 3)}
      {t('tiEnvironment', '9. Охрана окружающей среды', 'сбор и вывоз отходов, утилизация', 2)}
      {error && <div className="err">{error}</div>}
      {saved && !error && <div className="okbox">Сохранено.</div>}
      <button className="btn block secondary" disabled={busy}>Сохранить</button>
    </form>
  );
}

function Approve({ d, dishId, onDone }: { d: Data; dishId: string; onDone: () => void }) {
  const { org, can } = useOrg();
  const [note, setNote] = useState(d.versions.length ? '' : 'Введена впервые');
  const { busy, error, run } = useSubmit();
  if (!can('ttk.approve')) return null;
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/orgs/${org.id}/dishes/${dishId}/ti`, { body: { changeNote: note } }); onDone(); }); }}>
      <h2>Утверждение</h2>
      <label htmlFor="tin">Что введено или изменено</label><input id="tin" required value={note} onChange={(e) => setNote(e.target.value)} />
      {error && <div className="err">{error}</div>}
      <button className="btn block" disabled={busy || d.calc.status !== 'ready'}>Утвердить ТИ (изм. {d.versions.length + 1})</button>
      <p className="small muted">Утверждённая версия не меняется; изменения — следующей версией в листе регистрации изменений.</p>
    </form>
  );
}
