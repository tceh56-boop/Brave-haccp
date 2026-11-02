'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { api } from '@/lib/api';
import type { Decl } from '@/lib/declarations';

/**
 * Печатная форма декларации о соответствии — единая форма по решению Коллегии ЕЭК от 25.12.2012 N 293 (разд. I), лист A4,
 * поля без нумерации (разд. II п. 4). Проект печатается с пометкой «ПРОЕКТ» — это не декларация. Регистрационный номер,
 * дата регистрации и QR-код — из единого реестра (ФГИС Росаккредитации), до регистрации поля пустые.
 */
export default function DeclarationPrint({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { org } = useOrg();
  const [d, setD] = useState<Decl | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<Decl>(`/orgs/${org.id}/declarations/${id}`).then(setD).catch((e) => setErr(e.message)); }, [org.id, id]);
  if (err) return <div className="err">{err}</div>;
  if (!d) return <p className="muted">Загрузка…</p>;
  const f = d.fields, draft = d.status === 'draft';
  const line = (label: string, value: string | null, empty = '') => (
    <div className="dc-row"><span className="dc-l">{label}</span><span className="dc-v">{value || empty}</span></div>);
  return (
    <>
      <div className="noprint">
        <p className="small"><Link href={`/app/${org.id}/declarations/${id}`}>← Декларация № {d.number}</Link></p>
        {draft && <div className="tu-warn">Проект: {d.errors.length ? `${d.errors.length} замечаний, ` : ''}не принят заявителем и не зарегистрирован — документом о соответствии не является.</div>}
        <p className="small muted">Знак ЕАС (поле 2) печатается текстом; графическое изображение установлено решением Комиссии Таможенного союза от 15.07.2011 N 711. Декларация оформляется на русском языке, на белой бумаге A4 (разд. II п. 2–3); исправления не допускаются (п. 7). Подпись — собственноручная, факсимиле не допускается (п. 5 «к»).</p>
        <button type="button" className="btn" onClick={() => window.print()}>Печать</button>
      </div>
      <div className="tu-doc dc">
        {draft && <div className="tu-center"><span className="tu-stamp">ПРОЕКТ</span></div>}
        <div className="dc-head">ЕВРАЗИЙСКИЙ ЭКОНОМИЧЕСКИЙ СОЮЗ<br />ДЕКЛАРАЦИЯ О СООТВЕТСТВИИ</div>
        <div className="dc-eac">ЕАС</div>
        {line('Заявитель', f.f3)}
        {f.f4 ? line('в лице', f.f4) : null}
        {line('заявляет, что', f.f5)}
        {line('соответствует требованиям', f.f6)}
        {line('Декларация о соответствии принята на основании', f.f7)}
        {line('Дополнительная информация', f.f8)}
        <div className="dc-row"><span className="dc-v">Декларация о соответствии действительна с даты регистрации по {f.f9 === 'срок не установлен' ? '' : f.f9 === '—' ? '____________' : f.f9} включительно{f.f9 === 'срок не установлен' ? ' — срок не установлен' : ''}.</span></div>
        <div className="dc-sign">
          <div><div className="dc-line" /><div className="tu-small tu-center">(подпись)</div></div>
          <div className="tu-center">М.П.</div>
          <div><div className="dc-line dc-name">{f.f10}</div><div className="tu-small tu-center">(Ф.И.О. заявителя)</div></div>
        </div>
        {line('Регистрационный номер декларации о соответствии:', f.f11, 'ЕАЭС N ____________________')}
        {line('Дата регистрации декларации о соответствии:', f.f12, '__.__.____')}
        {line('QR-код', d.registration ? f.f13 : null, '')}
      </div>
    </>
  );
}
