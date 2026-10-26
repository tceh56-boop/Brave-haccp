'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { api } from '@/lib/api';
import { n } from '@/lib/fmt';

interface CLine { name: string; unit: string; norm: number; price: number; sum: number; price_source: string | null }
interface Card { id: string; seq: number; doc_no: string | null; calc_date: string; dish_id: string; dish_name: string; dish_kind: string; site_name: string | null; lines: CLine[]; raw_100: string; cost_1: string;
  sale_price: string | null; markup_pct: string | null; yield_g: string | null; basis_label: string; signers: { chef?: string | null; accountant?: string | null; director?: string | null };
  approved_by_name: string; ttk_version: number; org: { name: string; legal_form: string | null; inn: string | null } }

const dmy = (d: string) => d.slice(0, 10).split('-').reverse().join('.');
const money = (v: string | number | null) => (v === null ? '' : Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** Калькуляционная карточка — унифицированная форма № ОП-1 (постановление Госкомстата России от 25.12.98 № 132). */
export default function CostingCardPage({ params }: { params: Promise<{ dishId: string; cardId: string }> }) {
  const { dishId, cardId } = use(params);
  const { org } = useOrg();
  const [c, setC] = useState<Card | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<Card>(`/orgs/${org.id}/costing/${cardId}`).then(setC).catch((e) => setErr(e.message)); }, [org.id, cardId]);
  if (err) return <div className="err">{err}</div>;
  if (!c) return <p className="muted">Загрузка…</p>;
  const orgName = `${c.org.legal_form && c.org.legal_form !== 'другое' && !c.org.name.startsWith(c.org.legal_form) ? `${c.org.legal_form} ` : ''}${c.org.name}`;
  return (
    <>
      <div className="noprint">
        <p className="small"><Link href={`/app/${org.id}/menu/${dishId}/costing`}>← Калькуляции</Link></p>
        <button className="btn block" onClick={() => window.print()}>Печать / сохранить PDF</button>
        <p className="small muted">Утвердил в системе: {c.approved_by_name}. Снимок цен на дату калькуляции; по ТТК версии {c.ttk_version}.</p>
      </div>
      <article className="tu-doc op1">
        <div className="tu-right tu-small">Унифицированная форма № ОП-1<br />Утверждена постановлением Госкомстата<br />России от 25.12.98 № 132</div>
        <table className="op1-head">
          <tbody>
            <tr><td style={{ border: 0 }} /><td style={{ border: 0, textAlign: 'right' }}>Форма по ОКУД</td><td className="op1-code">0330501</td></tr>
            <tr><td style={{ border: 0, borderBottom: '1px solid #111' }}><b>{orgName}</b>{c.org.inn ? `, ИНН ${c.org.inn}` : ''}</td><td style={{ border: 0, textAlign: 'right' }}>по ОКПО</td><td className="op1-code" /></tr>
            <tr><td style={{ border: 0, borderBottom: '1px solid #111' }}><b>{c.site_name || ''}</b><div className="tu-small">структурное подразделение</div></td><td style={{ border: 0, textAlign: 'right' }}>Вид деятельности по ОКДП</td><td className="op1-code" /></tr>
            <tr><td style={{ border: 0, borderBottom: '1px solid #111' }}><b style={{ fontSize: '12pt' }}>{c.dish_name}</b><div className="tu-small">наименование блюда (изделия)</div></td>
              <td style={{ border: 0, textAlign: 'right' }}>Номер блюда по сборнику рецептур, ТТК, СТП</td><td className="op1-code">{c.doc_no || ''}</td></tr>
            <tr><td style={{ border: 0 }} /><td style={{ border: 0, textAlign: 'right' }}>Вид операции</td><td className="op1-code" /></tr>
          </tbody>
        </table>
        <table style={{ width: 'auto', margin: '10px auto' }}>
          <tbody>
            <tr><td rowSpan={2} style={{ border: 0, fontWeight: 700, fontSize: '11pt', verticalAlign: 'bottom' }}>КАЛЬКУЛЯЦИОННАЯ КАРТОЧКА</td><th>Номер документа</th><th>Дата составления</th></tr>
            <tr><td className="tu-center"><b>{c.doc_no || c.seq}</b></td><td className="tu-center"><b>{dmy(c.calc_date)}</b></td></tr>
          </tbody>
        </table>
        <table>
          <thead>
            <tr><th colSpan={3} className="tu-center">Порядковый номер калькуляции, дата утверждения</th><th colSpan={3} className="tu-center">№ {c.seq} от {dmy(c.calc_date)}</th></tr>
            <tr><th>№</th><th>Продукты</th><th>Ед.</th><th>Норма</th><th>Цена</th><th>Сумма</th></tr>
          </thead>
          <tbody>
            {c.lines.map((l, i) => (
              <tr key={i}><td>{i + 1}</td><td>{l.name}</td><td>{l.unit}</td>
                <td style={{ textAlign: 'right' }}>{l.norm.toLocaleString('ru-RU', { minimumFractionDigits: 4 })}</td><td style={{ textAlign: 'right' }}>{money(l.price)}</td><td style={{ textAlign: 'right' }}>{money(l.sum)}</td></tr>
            ))}
            <tr><td colSpan={2}>Стоимость сырьевого набора на 100 блюд</td><td colSpan={2} style={{ textAlign: 'right' }}>{money(c.raw_100)}</td><td colSpan={2} className="tu-center" rowSpan={1}>Подписи</td></tr>
            <tr><td colSpan={2}>Себестоимость 1 блюда</td><td colSpan={2} style={{ textAlign: 'right' }}>{money(c.cost_1)}</td><td colSpan={2} rowSpan={2}>Заведующий производством (шеф-повар)<div style={{ textAlign: 'right', marginTop: 10 }}>{c.signers.chef || '____________'}</div></td></tr>
            <tr><td colSpan={2}>Наценка, в % к себестоимости</td><td colSpan={2} style={{ textAlign: 'right' }}>{c.markup_pct === null ? '' : money(c.markup_pct)}</td></tr>
            <tr><td colSpan={2}>Цена продажи блюда</td><td colSpan={2} style={{ textAlign: 'right' }}>{money(c.sale_price)}</td><td colSpan={2} rowSpan={2}>Бухгалтер-калькулятор<div style={{ textAlign: 'right', marginTop: 10 }}>{c.signers.accountant || '____________'}</div></td></tr>
            <tr><td colSpan={2}>Выход 1 блюда, грамм</td><td colSpan={2} style={{ textAlign: 'right' }}>{c.yield_g ? n(c.yield_g) : ''}</td></tr>
          </tbody>
        </table>
        <p><b>Утверждаю</b> &nbsp; Руководитель ____________ {c.signers.director || ''}</p>
        {c.dish_kind === 'semi' && <p className="tu-small">Для полуфабриката норма и себестоимость — на 1 кг выхода.</p>}
      </article>
    </>
  );
}
