'use client';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { n } from '@/lib/fmt';

/** Вкладки экономики: P&L и Prime Cost, ABC/XYZ блюд, расходы предприятия (как в прежнем ЦЕХ). */

type Q = { from: string; to: string; siteId: string };
const qs = (q: Q) => `from=${q.from}&to=${q.to}${q.siteId ? `&siteId=${q.siteId}` : ''}`;
const pc = (v: number | null) => (v === null ? '' : ` · ${n(v)} %`);

interface Pnl { revenue: number; cogs: number; gross_margin: number; losses: number; expenses: Record<string, number>; opex: number; profit: number; prime_cost: number;
  pct: Record<string, number | null>; categories: Record<string, string>; complete: boolean; incomplete: string[] }

export function PnlTab({ q }: { q: Q }) {
  const { org } = useOrg();
  const [x, setX] = useState<Pnl | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<Pnl>(`/orgs/${org.id}/finance/pnl?${qs(q)}`).then((r) => { setX(r); setErr(null); }).catch((e) => setErr(e.message)); }, [org.id, q]);
  if (err) return <div className="err">{err}</div>;
  if (!x) return <p className="muted">Загрузка…</p>;
  return (
    <div className="card">
      <h2>P&L (отчёт о прибылях и убытках)</h2>
      <dl className="kv">
        <dt>Выручка</dt><dd><b>{n(x.revenue)} ₽</b></dd>
        <dt>Себестоимость продаж</dt><dd>− {n(x.cogs)} ₽{pc(x.pct.cogs)}</dd>
        <dt>Валовая прибыль</dt><dd><b>{n(x.gross_margin)} ₽</b>{pc(x.pct.gross)}</dd>
        <dt>Потери (списания)</dt><dd>− {n(x.losses)} ₽{pc(x.pct.losses)}</dd>
        {Object.entries(x.expenses).map(([k, v]) => <Fragment key={k}><dt>{x.categories[k]}</dt><dd>− {n(v)} ₽</dd></Fragment>)}
        <dt>Расходы всего</dt><dd>− {n(x.opex)} ₽{pc(x.pct.opex)}</dd>
        <dt>Прибыль</dt><dd><b style={x.profit < 0 ? { color: 'var(--crit, #b3261e)' } : undefined}>{n(x.profit)} ₽</b>{pc(x.pct.profit)}</dd>
        <dt>Prime Cost</dt><dd>{n(x.prime_cost)} ₽{pc(x.pct.prime)} <span className="small muted">(себестоимость + ФОТ)</span></dd>
      </dl>
      {!x.complete && <div className="note"><b>Данные неполные:</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{x.incomplete.map((t) => <li key={t} className="small">{t}</li>)}</ul></div>}
      <p className="small muted">Ежемесячные расходы входят в период долей дней месяца; себестоимость — по фактически списанным партиям.</p>
    </div>
  );
}

interface Abc { weeks: number; xyz_available: boolean; margin_available: boolean; notes: string[];
  rows: { name: string; qty: number; revenue: number; cost: number | null; margin: number | null; abc_revenue: string; revenue_share: number; abc_margin: string | null; cv: number | null; xyz: string | null }[] }
const TONE: Record<string, string> = { A: 'ok', B: 'warn', C: 'crit', X: 'ok', Y: 'warn', Z: 'crit' };

export function AbcTab({ q }: { q: Q }) {
  const { org } = useOrg();
  const [x, setX] = useState<Abc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<Abc>(`/orgs/${org.id}/finance/abc?${qs(q)}`).then((r) => { setX(r); setErr(null); }).catch((e) => setErr(e.message)); }, [org.id, q]);
  if (err) return <div className="err">{err}</div>;
  if (!x) return <p className="muted">Загрузка…</p>;
  return (
    <div className="card">
      <h2>ABC / XYZ блюд</h2>
      <p className="small muted">ABC: A — первые 80 % выручки (маржи), B — следующие 15 %, C — остальное. XYZ — стабильность продаж по неделям: X — колебания до 10 %, Y — до 25 %, Z — больше.</p>
      {x.notes.map((t) => <div key={t} className="note small">{t}</div>)}
      {x.rows.length === 0 ? <p className="muted">Продаж за период нет.</p> : (
        <div className="scroll"><table className="tbl">
          <thead><tr><th>Блюдо</th><th>Порций</th><th>Выручка</th><th>ABC выр.</th><th>Маржа</th><th>ABC маржа</th><th>XYZ</th></tr></thead>
          <tbody>{x.rows.map((r) => (
            <tr key={r.name}><td>{r.name}</td><td>{n(r.qty)}</td><td>{n(r.revenue)} <span className="small muted">({n(r.revenue_share)} %)</span></td><td><span className={`badge ${TONE[r.abc_revenue]}`}>{r.abc_revenue}</span></td>
              <td>{r.margin === null ? '—' : n(r.margin)}</td><td>{r.abc_margin ? <span className={`badge ${TONE[r.abc_margin]}`}>{r.abc_margin}</span> : '—'}</td>
              <td>{r.xyz ? <span className={`badge ${TONE[r.xyz]}`}>{r.xyz}</span> : '—'}{r.cv !== null ? <span className="small muted"> {n(r.cv)} %</span> : ''}</td></tr>))}</tbody>
        </table></div>
      )}
    </div>
  );
}

interface Exp { id: string; category: string; category_label: string; kind: string; on_date: string; amount: number; title: string; basis: string | null; site_name: string | null;
  created_by_name: string; voided: boolean; void_reason: string | null; share: number; in_period: number }

export function ExpensesTab({ q }: { q: Q }) {
  const { org, sites } = useOrg();
  const [x, setX] = useState<{ rows: Exp[]; categories: Record<string, string>; can_manage: boolean } | null>(null);
  const [f, setF] = useState({ category: 'rent', kind: 'monthly', date: q.from, amount: '', title: '', basis: '', siteId: '' });
  const { busy, error, run } = useSubmit();
  const load = useCallback(() => api<typeof x>(`/orgs/${org.id}/finance/expenses?${qs(q)}`).then(setX), [org.id, q]);
  useEffect(() => { load(); }, [load]);
  if (!x) return <p className="muted">Загрузка…</p>;
  const total = x.rows.reduce((s, r) => s + r.in_period, 0);
  return (
    <>
      <div className="card">
        <h2>Расходы за период: {n(Math.round(total * 100) / 100)} ₽</h2>
        {x.rows.length === 0 ? <p className="muted">Расходов нет.</p> : <ul className="list">{x.rows.map((r) => (
          <li key={r.id} style={r.voided ? { opacity: 0.55 } : undefined}>
            <div className="between"><b>{r.title}</b><span>{r.voided ? <s>{n(r.amount)} ₽</s> : `${n(r.in_period)} ₽`}</span></div>
            <div className="small muted">{r.category_label} · {r.kind === 'monthly' ? `ежемесячно с ${r.on_date.slice(0, 7)} (${n(r.amount)} ₽/мес., в периоде ${n(Math.round(r.share * 1000) / 10)} %)` : r.on_date.split('-').reverse().join('.')}
              {r.site_name ? ` · ${r.site_name}` : ' · всё предприятие'}{r.basis ? ` · ${r.basis}` : ''} · {r.created_by_name}{r.voided ? ` · аннулирован: ${r.void_reason}` : ''}</div>
            {x.can_manage && !r.voided && <button className="btn small secondary" disabled={busy} onClick={() => { const reason = prompt('Причина аннулирования:'); if (reason) run(async () => { await api(`/orgs/${org.id}/finance/expenses/${r.id}/void`, { body: { reason } }); await load(); }); }}>Аннулировать</button>}
          </li>))}</ul>}
      </div>
      {x.can_manage && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => {
          await api(`/orgs/${org.id}/finance/expenses`, { body: { ...f, amount: f.amount.replace(',', '.'), siteId: f.siteId || null, basis: f.basis || null } });
          setF({ ...f, amount: '', title: '', basis: '' }); await load();
        }); }}>
          <h2>Новый расход</h2>
          <div className="grid2">
            <div><label htmlFor="xc">Статья</label><select id="xc" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{Object.entries(x.categories).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div><label htmlFor="xk">Вид</label><select id="xk" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="monthly">ежемесячный</option><option value="once">разовый</option></select></div>
            <div><label htmlFor="xd">{f.kind === 'monthly' ? 'Месяц (любая дата месяца)' : 'Дата'}</label><input id="xd" type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
            <div><label htmlFor="xa">Сумма, ₽</label><input id="xa" inputMode="decimal" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
          </div>
          <label htmlFor="xt">Наименование</label><input id="xt" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Аренда помещения" />
          <label htmlFor="xb">Основание</label><input id="xb" value={f.basis} onChange={(e) => setF({ ...f, basis: e.target.value })} placeholder="договор, счёт, ведомость" />
          {sites.length > 1 && <><label htmlFor="xs">Площадка</label><select id="xs" value={f.siteId} onChange={(e) => setF({ ...f, siteId: e.target.value })}><option value="">всё предприятие</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></>}
          {error && <div className="err">{error}</div>}
          <button className="btn block" disabled={busy}>Добавить расход</button>
          <p className="small muted">Расход не правится — ошибочный аннулируют с причиной и вносят заново.</p>
        </form>
      )}
    </>
  );
}
