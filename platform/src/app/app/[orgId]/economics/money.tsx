'use client';
import { useCallback, useEffect, useState } from 'react';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { useOperationId } from '@/lib/op';
import { api } from '@/lib/api';
import { n } from '@/lib/fmt';

/** Деньги (финансовый контур, этап Ф-3): долги поставщикам, оплаты, возвраты и корректировки, банковская выписка. */

const METHOD: Record<string, string> = { bank: 'Банк (расчётный счёт)', cash: 'Наличные (не из кассы)', cash_register: 'Из кассы смены', card: 'Карта' };
const dmy = (s: string | null | undefined) => (s ? s.slice(0, 10).split('-').reverse().join('.') : '—');
const rub = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${n(Math.round(v * 100) / 100)} ₽`);
const today = () => new Date().toLocaleDateString('sv-SE');

interface Bal { supplier_id: string; name: string; inn: string | null; payment_days: number | null; invoiced: number; credits: number; paid: number; refunded: number; balance: number; debt: number; advance: number; overdue: number; unpriced: number }
interface Ledger { supplier: { id: string; name: string; inn: string | null; payment_days: number | null }; balance: Bal | null; today: string;
  receipts: { id: string; document_no: string | null; document_date: string | null; due_date: string | null; payable: number; paid: number; credited: number; open: number; state: string; overdue: boolean }[];
  unpriced: { id: string; document_no: string | null; completed_at: string }[];
  payments: { id: string; kind: string; paid_on: string; amount: number; method: string; method_label: string; doc_no: string | null; comment: string | null; source: string; voided_at: string | null; void_reason: string | null; who: string }[];
  credits: { id: string; kind: string; on_date: string; amount: number; doc_no: string | null; reason: string; quantity: number | null; voided_at: string | null; void_reason: string | null }[] }

export function MoneyTab() {
  const [tab, setTab] = useState('suppliers');
  return (
    <>
      <div className="chips">{[['suppliers', 'Поставщики'], ['bank', 'Банк']].map(([k, l]) => <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'suppliers' && <Suppliers />}
      {tab === 'bank' && <Bank />}
    </>
  );
}

function Suppliers() {
  const { org } = useOrg();
  const [x, setX] = useState<{ rows: Bal[]; totals: { debt: number; overdue: number; advance: number; unpriced: number }; can_pay: boolean; today: string } | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api<typeof x>(`/orgs/${org.id}/money/suppliers`).then((r) => { setX(r); setErr(null); }).catch((e) => setErr(e.message)), [org.id]);
  useEffect(() => { load(); }, [load]);
  if (err) return <div className="err">{err}</div>;
  if (!x) return <p className="muted">Загрузка…</p>;
  return (
    <>
      <div className="card">
        <h2>Долги поставщикам на {dmy(x.today)}</h2>
        <dl className="kv">
          <dt>Мы должны</dt><dd><b>{rub(x.totals.debt)}</b>{x.totals.overdue > 0 && <span className="badge crit" style={{ marginLeft: 6 }}>просрочено {rub(x.totals.overdue)}</span>}</dd>
          <dt>Авансы поставщикам</dt><dd>{rub(x.totals.advance)}</dd>
          {x.totals.unpriced > 0 && <><dt>Накладных без суммы</dt><dd><span className="badge warn">{x.totals.unpriced}</span> <span className="small muted">долг по ним неизвестен — уточните цены</span></dd></>}
        </dl>
        {x.rows.length === 0 ? <p className="muted">Накладных с суммой к оплате пока нет.</p> : (
          <div className="scroll"><table className="tbl"><thead><tr><th>Поставщик</th><th>По накладным</th><th>Возвраты, корр.</th><th>Оплачено</th><th>Долг</th><th>Аванс</th></tr></thead>
            <tbody>{x.rows.map((r) => (
              <tr key={r.supplier_id} style={{ cursor: 'pointer' }} onClick={() => setSel(r.supplier_id)} aria-selected={sel === r.supplier_id}>
                <td><button className="linkbtn">{r.name}</button>{r.payment_days ? <div className="small muted">отсрочка {r.payment_days} дн.</div> : null}</td>
                <td>{n(r.invoiced)}</td><td>{n(r.credits)}</td><td>{n(r.paid - r.refunded)}</td>
                <td><b>{n(r.debt)}</b>{r.overdue > 0 && <div><span className="badge crit">просрочено {n(r.overdue)}</span></div>}{r.unpriced > 0 && <div className="small muted">+ без суммы: {r.unpriced}</div>}</td><td>{r.advance ? n(r.advance) : '—'}</td>
              </tr>))}</tbody></table></div>)}
        <p className="small muted">Долг = к оплате по накладным − возвраты и корректировки − оплаты. Срок оплаты — дата документа + отсрочка поставщика (настраивается в «Справочниках»).</p>
      </div>
      {sel && <SupplierCard id={sel} canPay={x.can_pay} onChange={load} />}
    </>
  );
}

function SupplierCard({ id, canPay, onChange }: { id: string; canPay: boolean; onChange: () => void }) {
  const { org, sites } = useOrg();
  const [l, setL] = useState<Ledger | null>(null);
  const [pay, setPay] = useState({ amount: '', paidOn: today(), method: 'bank', docNo: '', comment: '', siteId: sites[0]?.id || '', pick: [] as string[] });
  const [cor, setCor] = useState({ amount: '', sign: 'less', docNo: '', reason: '', receiptId: '' });
  const op = useOperationId();
  const { busy, error, run } = useSubmit();
  const load = useCallback(() => api<Ledger>(`/orgs/${org.id}/money/suppliers/${id}`).then(setL), [org.id, id]);
  useEffect(() => { load(); }, [load]);
  if (!l) return <p className="muted">Загрузка…</p>;
  const after = async () => { await load(); onChange(); };
  const open = l.receipts.filter((r) => r.open > 0.005);
  return (
    <div className="card">
      <h2>{l.supplier.name}{l.supplier.inn ? <span className="small muted"> · ИНН {l.supplier.inn}</span> : null}</h2>
      {l.balance && <p>Долг <b>{rub(l.balance.debt)}</b>{l.balance.advance ? ` · аванс ${rub(l.balance.advance)}` : ''}{l.balance.overdue ? <span className="badge crit" style={{ marginLeft: 6 }}>просрочено {rub(l.balance.overdue)}</span> : null}</p>}
      <h3>Накладные</h3>
      {l.receipts.length === 0 ? <p className="muted">Нет накладных с суммой.</p> : (
        <div className="scroll"><table className="tbl"><thead><tr>{canPay && <th />}<th>Документ</th><th>Срок</th><th>К оплате</th><th>Оплачено</th><th>Возвр., корр.</th><th>Остаток</th></tr></thead>
          <tbody>{l.receipts.map((r) => (
            <tr key={r.id}>
              {canPay && <td>{r.open > 0.005 && <input type="checkbox" aria-label="оплатить эту накладную" style={{ width: 20, minHeight: 20 }} checked={pay.pick.includes(r.id)}
                onChange={(e) => setPay({ ...pay, pick: e.target.checked ? [...pay.pick, r.id] : pay.pick.filter((x) => x !== r.id) })} />}</td>}
              <td>{r.document_no || 'без номера'} <span className="small muted">от {dmy(r.document_date)}</span></td>
              <td>{dmy(r.due_date)}{r.overdue && <span className="badge crit" style={{ marginLeft: 4 }}>просрочена</span>}</td>
              <td>{n(r.payable)}</td><td>{n(r.paid)}</td><td>{r.credited ? n(r.credited) : '—'}</td>
              <td><b>{n(r.open)}</b> <span className="small muted">{r.state}</span></td>
            </tr>))}</tbody></table></div>)}
      {l.unpriced.length > 0 && <p className="small"><span className="badge warn">без суммы</span> {l.unpriced.map((u) => u.document_no || 'без номера').join(', ')} — в долг не входят, пока не указаны цены.</p>}

      {canPay && (
        <form onSubmit={(e) => { e.preventDefault(); run(async () => {
          await api(`/orgs/${org.id}/money/supplier-payments`, { body: { supplierId: id, amount: pay.amount.replace(',', '.'), paidOn: pay.paidOn, method: pay.method, docNo: pay.docNo || null, comment: pay.comment || null,
            siteId: pay.method === 'cash_register' ? pay.siteId : null, receiptIds: pay.pick.length ? pay.pick : undefined, operationId: op.id } });
          op.next(); setPay({ ...pay, amount: '', docNo: '', comment: '', pick: [] }); await after();
        }); }}>
          <h3>Оплата поставщику</h3>
          <div className="grid2">
            <div><label htmlFor="pa">Сумма, ₽</label><input id="pa" inputMode="decimal" required value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })}
              placeholder={pay.pick.length ? `выбрано: ${n(open.filter((r) => pay.pick.includes(r.id)).reduce((s, r) => s + r.open, 0))}` : ''} /></div>
            <div><label htmlFor="pd">Дата оплаты</label><input id="pd" type="date" required value={pay.paidOn} onChange={(e) => setPay({ ...pay, paidOn: e.target.value })} /></div>
            <div><label htmlFor="pm">Способ</label><select id="pm" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            {pay.method === 'cash_register' && sites.length > 1 && <div><label htmlFor="ps">Касса площадки</label><select id="ps" value={pay.siteId} onChange={(e) => setPay({ ...pay, siteId: e.target.value })}>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>}
            <div><label htmlFor="pn">Документ</label><input id="pn" value={pay.docNo} onChange={(e) => setPay({ ...pay, docNo: e.target.value })} placeholder="п/п № …, РКО № …" /></div>
          </div>
          <p className="small muted">{pay.pick.length ? 'Оплата пойдёт на отмеченные накладные.' : 'Оплата разнесётся по накладным по сроку оплаты (сначала просроченные).'} Переплата станет авансом. Из кассы смены выдать больше, чем в кассе, нельзя.</p>
          <button className="btn block" disabled={busy}>Записать оплату</button>
        </form>)}

      <h3>Оплаты</h3>
      {l.payments.length === 0 ? <p className="muted">Оплат нет.</p> : <ul className="list">{l.payments.map((p) => (
        <li key={p.id} style={p.voided_at ? { opacity: 0.55 } : undefined}>
          <div className="between"><span>{dmy(p.paid_on)} · {p.kind === 'refund' ? 'возврат денег от поставщика' : 'оплата'} · {p.method_label}{p.doc_no ? ` · ${p.doc_no}` : ''}{p.source === 'bank' ? ' · из выписки' : ''}</span>
            <b>{p.voided_at ? <s>{n(p.amount)} ₽</s> : `${p.kind === 'refund' ? '+' : ''}${n(p.amount)} ₽`}</b></div>
          <div className="small muted">{p.who}{p.voided_at ? ` · аннулирована: ${p.void_reason}` : ''}</div>
          {canPay && !p.voided_at && p.method !== 'cash_register' && p.source !== 'bank' && <button className="btn small secondary" disabled={busy} onClick={() => { const reason = prompt('Причина аннулирования:'); if (reason) run(async () => { await api(`/orgs/${org.id}/money/supplier-payments/${p.id}/void`, { body: { reason } }); await after(); }); }}>Аннулировать</button>}
        </li>))}</ul>}

      <h3>Возвраты и корректировки</h3>
      {l.credits.length === 0 ? <p className="muted">Нет.</p> : <ul className="list">{l.credits.map((c) => (
        <li key={c.id} style={c.voided_at ? { opacity: 0.55 } : undefined}>
          <div className="between"><span>{dmy(c.on_date)} · {c.kind === 'return' ? `возврат товара${c.quantity ? ` (${n(c.quantity)})` : ''}` : 'корректировка'}{c.doc_no ? ` · ${c.doc_no}` : ''}</span>
            <b>{c.amount > 0 ? '−' : '+'}{n(Math.abs(c.amount))} ₽ к долгу</b></div>
          <div className="small muted">{c.reason}{c.voided_at ? ` · аннулирована: ${c.void_reason}` : ''}</div>
          {canPay && !c.voided_at && c.kind === 'correction' && <button className="btn small secondary" disabled={busy} onClick={() => { const reason = prompt('Причина аннулирования:'); if (reason) run(async () => { await api(`/orgs/${org.id}/money/supplier-credits/${c.id}/void`, { body: { reason } }); await after(); }); }}>Аннулировать</button>}
        </li>))}</ul>}
      <p className="small muted">Возврат товара оформляется в карточке партии («Вернуть поставщику») — склад и долг меняются вместе.</p>

      {canPay && (
        <form onSubmit={(e) => { e.preventDefault(); run(async () => {
          const a = Number(cor.amount.replace(',', '.'));
          await api(`/orgs/${org.id}/money/supplier-corrections`, { body: { supplierId: id, onDate: today(), amount: cor.sign === 'less' ? a : -a, docNo: cor.docNo || null, reason: cor.reason, receiptId: cor.receiptId || null } });
          setCor({ amount: '', sign: 'less', docNo: '', reason: '', receiptId: '' }); await after();
        }); }}>
          <h3>Корректировка долга (УКД, скидка, пересчёт)</h3>
          <div className="grid2">
            <div><label htmlFor="cs">Направление</label><select id="cs" value={cor.sign} onChange={(e) => setCor({ ...cor, sign: e.target.value })}><option value="less">должны меньше</option><option value="more">должны больше</option></select></div>
            <div><label htmlFor="ca">Сумма, ₽</label><input id="ca" inputMode="decimal" required value={cor.amount} onChange={(e) => setCor({ ...cor, amount: e.target.value })} /></div>
            <div><label htmlFor="cd">Документ</label><input id="cd" value={cor.docNo} onChange={(e) => setCor({ ...cor, docNo: e.target.value })} placeholder="УКД № …" /></div>
            <div><label htmlFor="cr">К накладной</label><select id="cr" value={cor.receiptId} onChange={(e) => setCor({ ...cor, receiptId: e.target.value })}><option value="">— к поставщику в целом —</option>{l.receipts.map((r) => <option key={r.id} value={r.id}>{r.document_no || 'без номера'} от {dmy(r.document_date)}</option>)}</select></div>
          </div>
          <label htmlFor="cw">Причина</label><input id="cw" required value={cor.reason} onChange={(e) => setCor({ ...cor, reason: e.target.value })} placeholder="скидка за объём по письму поставщика" />
          <button className="btn block secondary" disabled={busy}>Записать корректировку</button>
        </form>)}
      {error && <div className="err" role="alert">{error}</div>}
    </div>
  );
}

interface BLine { id: string; doc_no: string | null; op_date: string; amount: number; counterparty: string | null; counterparty_inn: string | null; purpose: string | null; status: string; status_label: string; note: string | null;
  suggest: { kind: string; supplier_id?: string; supplier?: string } | null }

/** Выписка банка в формате обмена с 1С: загрузка и разнесение строк. */
function Bank() {
  const { org, siteId } = useOrg();
  const [lines, setLines] = useState<BLine[] | null>(null);
  const [all, setAll] = useState(false);
  const [sups, setSups] = useState<{ id: string; name: string }[]>([]);
  const [cats, setCats] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<{ id: string; number: number; title: string; event_date: string }[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { busy, error, run } = useSubmit();
  const load = useCallback(() => api<BLine[]>(`/orgs/${org.id}/money/bank?status=${all ? 'all' : 'new'}`).then((r) => { setLines(r); setErr(null); }).catch((e) => setErr(e.message)), [org.id, all]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api<{ id: string; name: string }[]>(`/orgs/${org.id}/suppliers`).then(setSups).catch(() => undefined);
    const p = new Date(); const q = `from=${p.toLocaleDateString('sv-SE')}&to=${p.toLocaleDateString('sv-SE')}`;
    api<{ categories: Record<string, string> }>(`/orgs/${org.id}/finance/expenses?${q}`).then((r) => setCats(r.categories)).catch(() => undefined);
    if (siteId) Promise.all([api<typeof events>(`/orgs/${org.id}/events?siteId=${siteId}`), api<typeof events>(`/orgs/${org.id}/events?siteId=${siteId}&period=past`)])
      .then(([a, b]) => setEvents([...a, ...b])).catch(() => undefined);
  }, [org.id, siteId]);
  if (err) return <div className="err">{err}</div>;
  const upload = (file: File) => run(async () => {
    const buf = await file.arrayBuffer();
    let text = new TextDecoder('utf-8').decode(buf);
    if (/Кодировка=Windows/i.test(text) || text.includes('�')) text = new TextDecoder('windows-1251').decode(buf);
    const r = await api<{ added: number; duplicates: number; accounts: string[]; from: string | null; to: string | null }>(`/orgs/${org.id}/money/bank`, { body: { text } });
    setMsg(`Загружено строк: ${r.added}${r.duplicates ? `, уже были: ${r.duplicates}` : ''}. Счёт ${r.accounts.join(', ')}, период ${dmy(r.from)} — ${dmy(r.to)}.`);
    await load();
  });
  const decide = (id: string, body: Record<string, unknown>) => run(async () => { await api(`/orgs/${org.id}/money/bank/${id}`, { body }); await load(); });
  return (
    <>
      <div className="card">
        <h2>Банковская выписка</h2>
        <p className="small muted">Выгрузите выписку из интернет-банка в формате обмена с 1С («1CClientBankExchange», файл .txt) и загрузите сюда. Повторная загрузка того же файла не дублирует строки.</p>
        <input type="file" accept=".txt,text/plain" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
        {msg && <div className="okbox" role="status">{msg}</div>}
        {error && <div className="err" role="alert">{error}</div>}
      </div>
      <div className="card">
        <div className="between"><h2 style={{ margin: 0 }}>{all ? 'Все строки' : 'Не разнесено'}</h2><button className="btn small secondary" onClick={() => setAll(!all)}>{all ? 'Только неразнесённые' : 'Показать все'}</button></div>
        {!lines ? <p className="muted">Загрузка…</p> : lines.length === 0 ? <p className="muted">{all ? 'Строк нет.' : 'Всё разнесено.'}</p> : <ul className="list">{lines.map((b) => (
          <li key={b.id}>
            <div className="between"><span>{dmy(b.op_date)} · п/п {b.doc_no || '—'} · {b.counterparty || 'контрагент не указан'}{b.counterparty_inn ? <span className="small muted"> ИНН {b.counterparty_inn}</span> : null}</span>
              <b style={{ color: b.amount < 0 ? 'var(--crit, #b3261e)' : undefined }}>{b.amount > 0 ? '+' : '−'}{n(Math.abs(b.amount))} ₽</b></div>
            <div className="small muted">{b.purpose}</div>
            {b.status !== 'new' ? <div className="small"><span className="badge ok">{b.status_label}</span>{b.note ? ` · ${b.note}` : ''}</div> : (
              <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                {b.suggest?.kind === 'supplier_payment' && <button className="btn small" disabled={busy} onClick={() => decide(b.id, { kind: 'supplier_payment', supplierId: b.suggest!.supplier_id })}>{b.amount < 0 ? 'Оплата' : 'Возврат денег от'} «{b.suggest.supplier}»</button>}
                {b.suggest?.kind === 'acquiring' && <button className="btn small" disabled={busy} onClick={() => decide(b.id, { kind: 'acquiring' })}>Эквайринг (зачисление по картам)</button>}
                <select aria-label="Поставщик" defaultValue="" disabled={busy} onChange={(e) => e.target.value && decide(b.id, { kind: 'supplier_payment', supplierId: e.target.value })}>
                  <option value="">{b.amount < 0 ? 'оплата поставщику…' : 'возврат от поставщика…'}</option>{sups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                {b.amount < 0 && <select aria-label="Статья расхода" defaultValue="" disabled={busy} onChange={(e) => e.target.value && decide(b.id, { kind: 'expense', category: e.target.value })}>
                  <option value="">расход…</option>{Object.entries(cats).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}
                {b.amount > 0 && events.length > 0 && <select aria-label="Мероприятие" defaultValue="" disabled={busy} onChange={(e) => e.target.value && decide(b.id, { kind: 'event_payment', eventId: e.target.value })}>
                  <option value="">оплата мероприятия…</option>{events.map((ev) => <option key={ev.id} value={ev.id}>№ {ev.number} {ev.title} · {dmy(ev.event_date)}</option>)}</select>}
                <button className="btn small secondary" disabled={busy} onClick={() => decide(b.id, { kind: 'transfer' })}>Перевод между своими / инкассация</button>
                <button className="btn small secondary" disabled={busy} onClick={() => { const note = prompt('Почему строка не учитывается?'); if (note) decide(b.id, { kind: 'ignored', note }); }}>Не учитывать</button>
              </div>)}
          </li>))}</ul>}
        <p className="small muted">Эквайринг и переводы между своими счетами — внутренние перемещения: оплаты картой уже есть в выручке кассы, поэтому в ДДС они второй раз не входят.</p>
      </div>
    </>
  );
}
