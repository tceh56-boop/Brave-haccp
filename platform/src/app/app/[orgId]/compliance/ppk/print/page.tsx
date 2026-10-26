'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useOrg } from '@/lib/org';
import { api } from '@/lib/api';
import { dt } from '@/lib/fmt';
import { orgTitle } from '@/lib/ttkdoc';
import { refOf, type PpkDoc, type PpkVersion } from '@/lib/ppk';

/** Печатная ППК: «УТВЕРЖДАЮ», разделы со ссылками на пункты, приложение с дословными текстами, лист регистрации изменений. Без ?v — проект. */
export default function PpkPrintPage() {
  return <Suspense fallback={<p className="muted">Загрузка…</p>}><Doc /></Suspense>;
}

function Doc() {
  const v = useSearchParams().get('v');
  const { org } = useOrg();
  const [d, setD] = useState<PpkDoc | null>(null);
  const [vers, setVers] = useState<PpkVersion[]>([]);
  const [appr, setAppr] = useState<PpkVersion | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (v) api<PpkVersion & { snapshot: PpkDoc; versions: PpkVersion[] }>(`/orgs/${org.id}/ppk/versions/${v}`).then((x) => { setD(x.snapshot); setVers(x.versions); setAppr(x); }).catch((e) => setErr(e.message));
    else api<{ doc: PpkDoc; versions: PpkVersion[] }>(`/orgs/${org.id}/ppk`).then((x) => { setD(x.doc); setVers(x.versions); }).catch((e) => setErr(e.message));
  }, [org.id, v]);
  if (err) return <div className="err">{err}</div>;
  if (!d) return <p className="muted">Загрузка…</p>;
  const day = (s: string) => dt(s, org.timezone, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const year = appr ? new Date(appr.approved_at).getFullYear() : new Date().getFullYear();
  const title = orgTitle(d.org);
  return (
    <>
      <div className="noprint">
        <p className="small"><Link href={`/app/${org.id}/compliance/ppk`}>← Мастер ППК</Link></p>
        <button className="btn block" onClick={() => window.print()}>Печать / сохранить PDF</button>
        {!appr && <p className="small muted">Проект по текущим данным; действует только утверждённая версия.</p>}
      </div>
      <article className="tu-doc">
        <p className="tu-center" style={{ textTransform: 'uppercase' }}>{title}</p>
        <p className="tu-center tu-small">{[d.org.inn ? `ИНН ${d.org.inn}` : '', ...d.sites.map((s) => s.address).filter(Boolean)].filter(Boolean).join('; ')}</p>
        <div className="tu-right" style={{ marginTop: 10 }}><b>УТВЕРЖДАЮ</b><br />{d.params.approverTitle || 'Руководитель'} {title}<br /><br />____________ / ____________<br />
          {d.params.orderNo ? <>Приказ № {d.params.orderNo}<br /></> : null}«___» __________ {year} г.</div>
        <h1 style={{ fontSize: '18pt', marginTop: 40 }}>ПРОГРАММА<br />ПРОИЗВОДСТВЕННОГО КОНТРОЛЯ</h1>
        <p className="tu-center">на принципах ХАССП{!appr && <> <span className="tu-stamp">{d.gaps.length ? 'ПРОЕКТ' : 'ГОТОВ К УТВЕРЖДЕНИЮ'}</span></>}</p>
        <p className="tu-center">{d.profile_text}</p>
        {appr && <p className="tu-center">Версия {appr.version} от {day(appr.approved_at)}</p>}
        <p className="tu-center" style={{ marginTop: 60 }}>{d.params.city ? `${d.params.city}, ` : ''}{year}</p>

        {d.sections.map((s) => (
          <section key={s.no} style={s.no === 1 ? { pageBreakBefore: 'always' } : undefined}>
            <h2>{s.no}. {s.title}</h2>
            {s.lines.map((l, i) => (
              l.gap ? <div key={i} className="tu-warn">{l.gap}</div>
                : <p key={i}>{s.no}.{i + 1}. {l.text}{l.basis.length > 0 && <span className="tu-small"> [{refOf(d, l.basis)}]</span>}</p>))}
            {s.table && s.table.rows.length > 0 && (
              <table><thead><tr><th>№</th>{s.table.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>{s.table.rows.map((row, i) => <tr key={i}><td>{i + 1}</td>{row.map((c, j) => <td key={j} className="tu-small">{c}</td>)}</tr>)}</tbody></table>)}
          </section>))}

        <h2 style={{ pageBreakBefore: 'always' }}>Приложение А. Нормативные документы</h2>
        <table><thead><tr><th>№</th><th>Документ</th><th>Утверждён</th><th>Срок действия</th></tr></thead>
          <tbody>{d.docs.map((x, i) => <tr key={x.code}><td>{i + 1}</td><td>{x.code} «{x.title}»</td><td className="tu-small">{x.issued}</td><td className="tu-small">{x.effective_to ? `до ${x.effective_to.split('-').reverse().join('.')}` : 'не ограничен'}</td></tr>)}</tbody></table>

        <h2>Приложение Б. Тексты пунктов, на которые ссылается программа</h2>
        {d.basis.map((b) => <p key={b.id} className="tu-small"><b>{b.doc}, {b.clause}.</b> {b.text}</p>)}

        <h2 style={{ pageBreakBefore: 'always' }}>Лист ознакомления</h2>
        <table><thead><tr><th>№</th><th>ФИО</th><th>Должность</th><th>Дата</th><th>Подпись</th></tr></thead>
          <tbody>{Array.from({ length: 12 }, (_, i) => <tr key={i}><td>{i + 1}</td><td style={{ height: 26 }}></td><td></td><td></td><td></td></tr>)}</tbody></table>

        <h2>Лист регистрации изменений</h2>
        <table><thead><tr><th>Версия</th><th>Содержание изменения</th><th>Утвердил</th><th>Дата</th></tr></thead>
          <tbody>{vers.length ? vers.map((x) => <tr key={x.version}><td>{x.version}</td><td>{x.change_note}</td><td>{x.approved_by_name}</td><td>{day(x.approved_at)}</td></tr>) : <tr><td colSpan={4}>—</td></tr>}</tbody></table>
      </article>
    </>
  );
}
