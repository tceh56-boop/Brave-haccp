'use client';
import { Fragment, use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { Evidence } from '@/components/Evidence';
import { DECISION, STATUS_BADGE, dmy, type Decl, type DeclInput, type Protocol } from '@/lib/declarations';

/**
 * Карточка декларации: применимость регламентов (вид сырья — подтверждает человек), ввод сведений, замечания по полям
 * формы N 293 со ссылкой на пункт, предварительный вид полей, комплект доказательств, сведения для заявления о регистрации.
 * После принятия текст не меняется; номер и дата регистрации вносятся один раз.
 */

const FIELD_TITLE: Record<string, string> = {
  regime: 'Применимость', '3': 'Поле 3 — заявитель', '4': 'Поле 4 — руководитель', '5': 'Поле 5 — продукция', '7': 'Поле 7 — доказательства, схема',
  '8': 'Поле 8 — дополнительная информация', '9': 'Поле 9 — срок действия',
};
const FIELDS: [string, string][] = [['f3', '3. Заявитель'], ['f4', '4. В лице'], ['f5', '5. Заявляет, что'], ['f6', '6. Соответствует требованиям'], ['f7', '7. Принята на основании'],
  ['f8', '8. Дополнительная информация'], ['f9', '9. Действительна по'], ['f10', '10. ФИО заявителя'], ['f11', '11. Регистрационный номер'], ['f12', '12. Дата регистрации']];
const blankProtocol = (): Protocol => ({ number: '', date: '', lab: '', accreditation: '', sampleMadeOn: '', fileId: '' });

export default function DeclarationCard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { org, can } = useOrg();
  const [d, setD] = useState<Decl | null>(null);
  const [f, setF] = useState<DeclInput>({});
  const [files, setFiles] = useState<{ id: string; filename: string }[]>([]);
  const [reg, setReg] = useState({ regNumber: '', regDate: '' });
  const [term, setTerm] = useState({ on: '', reason: '' });
  const [saved, setSaved] = useState(false);
  const { busy, error, run, setError } = useSubmit();
  const apply = (x: Decl) => { setD(x); setF({ ...x.input, protocols: x.input.protocols?.length ? x.input.protocols : [] }); };
  const load = useCallback(() => api<Decl>(`/orgs/${org.id}/declarations/${id}`).then(apply).catch((e) => setError(e.message)), [org.id, id, setError]);
  // первичная загрузка: ответ, пришедший после размонтирования (двойной вызов эффекта в dev), не затирает ввод
  useEffect(() => {
    let live = true;
    api<Decl>(`/orgs/${org.id}/declarations/${id}`).then((x) => { if (live) apply(x); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [org.id, id, setError]);
  const onFiles = useCallback((x: { id: string; filename: string }[]) => setFiles(x), []);
  if (!d) return error ? <div className="err">{error}</div> : <p className="muted">Загрузка…</p>;

  const draft = d.status === 'draft';
  const manage = draft && can('decl.manage');
  const accept = can('decl.accept');
  const set = <K extends keyof DeclInput>(k: K, v: DeclInput[K]) => { setSaved(false); setF((x) => ({ ...x, [k]: v })); };
  const protocols = f.protocols || [];
  const setProt = (i: number, k: keyof Protocol, v: string) => set('protocols', protocols.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  const save = () => run(async () => {
    const body = { ...f, protocols: protocols.map((p) => ({ ...p, accreditation: p.accreditation || null, sampleMadeOn: p.sampleMadeOn || null, fileId: p.fileId || null })),
      tnved: f.tnved || null, validTo: f.noTerm ? null : f.validTo || null, scheme: f.scheme || null };
    apply(await api<Decl>(`/orgs/${org.id}/declarations/${id}`, { method: 'PATCH', body })); setSaved(true);
  });
  const setKind = (productId: string, meatKind: string) => run(async () => { await api(`/orgs/${org.id}/products/${productId}/meat-kind`, { body: { meatKind } }); await load(); });
  const byField = d.errors.reduce<Record<string, string[]>>((a, e) => { (a[e.field] ||= []).push(e.text); return a; }, {});
  const m = d.regime.meat;

  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/declarations`}>← Декларации</Link></p>
      <div className="between"><h1 style={{ margin: 0 }}>Декларация № {d.number}: {d.dish.name}</h1><span className={`badge ${STATUS_BADGE[d.status] || ''}`}>{d.status_label}</span></div>
      <p className="row" style={{ gap: 8 }}><Link className="btn secondary small" href={`/app/${org.id}/declarations/${id}/print`}>Печатная форма (решение ЕЭК N 293)</Link></p>
      {error && <div className="err" role="alert">{error}</div>}
      {d.acceptance && <div className="okbox">Принята {new Date(d.acceptance.accepted_at).toLocaleString('ru-RU')}, {d.acceptance.accepted_by}. Текст зафиксирован (SHA-256 {d.acceptance.content_hash.slice(0, 12)}…){d.integrity ? ', целостность подтверждена' : ''}.</div>}
      {d.registration && <div className="okbox">Зарегистрирована: {d.registration.reg_number} от {dmy(d.registration.reg_date)}; действует {d.registration.valid_to ? `по ${dmy(d.registration.valid_to)} включительно` : '— срок не установлен'}.</div>}
      {d.termination && <div className="err">Действие прекращено с {dmy(d.termination.terminated_on)}: {d.termination.reason}</div>}

      <div className="card">
        <h2>Применимость</h2>
        <p><b>{DECISION[d.regime.decision] || d.regime.decision}.</b> {d.regime.regulations.length ? `Регламенты: ${d.regime.regulations.join('; ')}.` : ''} Допустимые схемы: {d.regime.schemes.join(', ')}.</p>
        {d.notes.map((n, i) => <p key={i} className="small">{n}</p>)}
        <h3>Сырьё по рецептуре (масса нетто закладки)</h3>
        <p className="small muted">{m.basis}. Мясных ингредиентов: <b>{m.meat_pct} %</b> (продукты убоя {m.slaughter_pct} %, птица {m.poultry_pct} %){m.group ? ` — ${m.group}` : ''}.</p>
        <div className="scroll"><table className="tbl small">
          <thead><tr><th>Сырьё</th><th>г</th><th>%</th><th>Вид сырья (ТР ТС 034, п. 4)</th></tr></thead>
          <tbody>{m.raw.map((x) => (
            <tr key={x.product_id}>
              <td>{x.name}</td><td>{x.g}</td><td>{m.total_g ? Math.round((x.g / m.total_g) * 1000) / 10 : 0}</td>
              <td>{manage ? (
                <span className="row" style={{ gap: 6 }}>
                  <select aria-label={`Вид сырья: ${x.name}`} value={x.meat_kind || ''} onChange={(e) => e.target.value && setKind(x.product_id, e.target.value)} disabled={busy}>
                    <option value="">— не указан —</option>{Object.entries(d.meat_kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                  {!x.meat_kind && x.suggest && <button type="button" className="btn small secondary" disabled={busy} onClick={() => setKind(x.product_id, x.suggest!)}>Подтвердить: {d.meat_kinds[x.suggest]}</button>}
                </span>) : x.meat_kind ? d.meat_kinds[x.meat_kind] : <span className="muted">не указан</span>}</td>
            </tr>))}</tbody>
        </table></div>
        {m.problems.map((p, i) => <p key={i} className="err small">{p}</p>)}
      </div>

      {manage && (
        <div className="card">
          <h2>Сведения для декларации</h2>
          <form onSubmit={(e) => { e.preventDefault(); save(); }}>
            <label htmlFor="ch">Как реализуется продукция</label>
            <select id="ch" value={f.channel || ''} onChange={(e) => set('channel', (e.target.value || null) as DeclInput['channel'])}>
              <option value="">— выберите —</option>{Object.entries(d.channels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <label className="check"><input type="checkbox" checked={!!f.specialized} onChange={(e) => set('specialized', e.target.checked)} /> Специализированная пищевая продукция (детское, диетическое лечебное, спортивное питание и т. п.)</label>
            <div className="grid2">
              <div><label htmlFor="ob">Объект декларирования</label>
                <select id="ob" value={f.object || 'serial'} onChange={(e) => set('object', e.target.value as 'serial' | 'batch')}><option value="serial">Серийный выпуск</option><option value="batch">Партия</option></select></div>
              <div><label htmlFor="sc">Схема декларирования</label>
                <select id="sc" value={f.scheme || ''} onChange={(e) => set('scheme', e.target.value || null)}>
                  <option value="">— выберите —</option>
                  {Object.entries(d.schemes).map(([k, s]) => <option key={k} value={k} disabled={!d.regime.schemes.includes(k)}>{k} — {s.title}{d.regime.schemes.includes(k) ? '' : ' (не установлена регламентом)'}</option>)}</select></div>
            </div>
            {f.object === 'batch' && (
              <div className="grid2">
                <div><label htmlFor="bs">Размер партии</label><input id="bs" type="number" min="0" step="any" value={f.batch?.size ?? ''} onChange={(e) => set('batch', { unit: f.batch?.unit || 'кг', ...f.batch, size: Number(e.target.value) })} /></div>
                <div><label htmlFor="bu">Единица измерения</label><input id="bu" value={f.batch?.unit || 'кг'} onChange={(e) => set('batch', { size: f.batch?.size || 0, ...f.batch, unit: e.target.value })} /></div>
                <div style={{ gridColumn: '1 / -1' }}><label htmlFor="bd">Товаросопроводительная документация (реквизиты)</label><input id="bd" value={f.batch?.shippingDoc || ''} onChange={(e) => set('batch', { size: f.batch?.size || 0, unit: f.batch?.unit || 'кг', ...f.batch, shippingDoc: e.target.value })} placeholder="ТН № …, договор поставки № … от …" /></div>
              </div>)}
            <div className="grid2">
              <div><label htmlFor="tn">Код ТН ВЭД ЕАЭС</label><input id="tn" inputMode="numeric" value={f.tnved || ''} onChange={(e) => set('tnved', e.target.value)} placeholder="определяет заявитель" /></div>
              <div><label htmlFor="vt">Действительна по (включительно)</label><input id="vt" type="date" value={f.validTo || ''} disabled={!!f.noTerm} onChange={(e) => set('validTo', e.target.value || null)} />
                {d.regime.reg034 === false && <label className="check small"><input type="checkbox" checked={!!f.noTerm} onChange={(e) => set('noTerm', e.target.checked)} /> срок не установлен (ТР ТС 021, ст. 23 ч. 10)</label>}</div>
            </div>
            <label htmlFor="px">Иные сведения, обеспечивающие идентификацию (при наличии)</label><input id="px" value={f.productExtra || ''} onChange={(e) => set('productExtra', e.target.value)} placeholder="товарный знак, масса упаковки, вид упаковки" />

            <h3>Протоколы испытаний</h3>
            {protocols.map((p, i) => (
              <fieldset key={i} className="card" style={{ padding: 10 }}>
                <div className="grid2">
                  <div><label htmlFor={`pn${i}`}>Номер</label><input id={`pn${i}`} value={p.number} onChange={(e) => setProt(i, 'number', e.target.value)} /></div>
                  <div><label htmlFor={`pd${i}`}>Дата</label><input id={`pd${i}`} type="date" value={p.date} onChange={(e) => setProt(i, 'date', e.target.value)} /></div>
                  <div style={{ gridColumn: '1 / -1' }}><label htmlFor={`pl${i}`}>Испытательная лаборатория (центр)</label><input id={`pl${i}`} value={p.lab} onChange={(e) => setProt(i, 'lab', e.target.value)} /></div>
                  <div><label htmlFor={`pa${i}`}>Уникальный номер записи об аккредитации</label><input id={`pa${i}`} value={p.accreditation || ''} onChange={(e) => setProt(i, 'accreditation', e.target.value)} placeholder="RA.RU.…" /></div>
                  <div><label htmlFor={`ps${i}`}>Дата изготовления образцов</label><input id={`ps${i}`} type="date" value={p.sampleMadeOn || ''} onChange={(e) => setProt(i, 'sampleMadeOn', e.target.value)} /></div>
                  <div style={{ gridColumn: '1 / -1' }}><label htmlFor={`pf${i}`}>Скан-копия (файл, загруженный ниже)</label>
                    <select id={`pf${i}`} value={p.fileId || ''} onChange={(e) => setProt(i, 'fileId', e.target.value)}><option value="">— не выбран —</option>{files.map((x) => <option key={x.id} value={x.id}>{x.filename}</option>)}</select></div>
                </div>
                <button type="button" className="btn small secondary" onClick={() => set('protocols', protocols.filter((_, j) => j !== i))}>Убрать протокол</button>
              </fieldset>))}
            <button type="button" className="btn small secondary" onClick={() => set('protocols', [...protocols, blankProtocol()])}>Добавить протокол</button>

            {f.scheme === '6д' && (<>
              <h3>Сертификат системы менеджмента (схема 6д)</h3>
              <div className="grid2">
                <div><label htmlFor="sn">Номер</label><input id="sn" value={f.sms?.number || ''} onChange={(e) => set('sms', { date: '', body: '', accreditation: '', ...f.sms, number: e.target.value })} /></div>
                <div><label htmlFor="sd">Дата</label><input id="sd" type="date" value={f.sms?.date || ''} onChange={(e) => set('sms', { number: '', body: '', accreditation: '', ...f.sms, date: e.target.value })} /></div>
                <div><label htmlFor="sb">Орган по сертификации систем менеджмента</label><input id="sb" value={f.sms?.body || ''} onChange={(e) => set('sms', { number: '', date: '', accreditation: '', ...f.sms, body: e.target.value })} /></div>
                <div><label htmlFor="sa">Номер записи об аккредитации органа</label><input id="sa" value={f.sms?.accreditation || ''} onChange={(e) => set('sms', { number: '', date: '', body: '', ...f.sms, accreditation: e.target.value })} /></div>
              </div></>)}
            <label htmlFor="st">Стандарты и иные документы, применённые добровольно (поле 8, при применении)</label>
            <textarea id="st" rows={2} value={f.standards || ''} onChange={(e) => set('standards', e.target.value)} />
            <div className="grid2">
              <div><label htmlFor="rn">Принята взамен декларации (номер, если заменяет)</label><input id="rn" value={f.replaces?.number || ''} onChange={(e) => set('replaces', e.target.value ? { date: f.replaces?.date || '', number: e.target.value } : null)} /></div>
              <div><label htmlFor="rd">Дата регистрации заменяемой</label><input id="rd" type="date" value={f.replaces?.date || ''} onChange={(e) => f.replaces && set('replaces', { ...f.replaces, date: e.target.value })} /></div>
            </div>
            {saved && <div className="okbox">Сохранено.</div>}
            <button className="btn" disabled={busy}>Сохранить и проверить</button>
          </form>
        </div>)}

      {(draft || files.length > 0) && <Evidence entityType="declaration" entityId={id} title="Скан-копии протоколов и документов комплекта" docs readPerm="decl.read" addPerm="decl.manage" onChange={onFiles}
        hint="Протоколы испытаний, сертификат СМ (6д), выписка ЕГРЮЛ/ЕГРИП, товаросопроводительные документы. Файлы не удаляются." />}

      {d.errors.length > 0 && (
        <div className="card">
          <h2>Замечания — принять нельзя ({d.errors.length})</h2>
          {Object.entries(byField).map(([k, list]) => (
            <div key={k}><h3>{FIELD_TITLE[k] || `Поле ${k}`}</h3><ul>{list.map((t, i) => <li key={i} className="small">{t}</li>)}</ul></div>))}
        </div>)}

      <div className="card">
        <h2>Поля декларации {draft ? '(предварительный вид)' : ''}</h2>
        <div className="kv">{FIELDS.map(([k, t]) => (d.fields[k as keyof Decl['fields']] !== null || k === 'f4') && <Fragment key={k}><span>{t}</span><b style={{ fontWeight: 400, whiteSpace: 'pre-wrap' }}>{d.fields[k as keyof Decl['fields']] || (k === 'f4' ? 'не заполняется (заявитель — ИП)' : '—')}</b></Fragment>)}</div>
      </div>

      <div className="card">
        <h2>Комплект доказательственных материалов</h2>
        <div className="scroll"><table className="tbl small"><thead><tr><th>Документ</th><th>Есть</th><th>Сведения</th><th>Основание</th></tr></thead>
          <tbody>{d.complect.map((c) => <tr key={c.item}><td>{c.item}</td><td>{c.status === 'ok' ? '✓' : c.status === 'n/a' ? '—' : c.status === 'warning' ? '!' : '✗'}</td><td>{c.detail}</td><td>{c.basis}</td></tr>)}</tbody></table></div>
      </div>

      <div className="card">
        <h2>Сведения для заявления о регистрации (приказ Минэкономразвития N 478, п. 7)</h2>
        <p className="small muted">Вносятся в сервис регистрации ФГИС Росаккредитации и подписываются усиленной квалифицированной электронной подписью заявителя.</p>
        <div className="kv">{d.application.map((a) => <Fragment key={a.label}><span>{a.label}</span><b style={{ fontWeight: 400 }}>{a.value}</b></Fragment>)}</div>
      </div>

      {accept && draft && (
        <div className="card">
          <h2>Принятие заявителем</h2>
          <p className="small">Принимая, вы как руководитель (уполномоченное лицо) заявляете о безопасности продукции и принятии мер по обеспечению её соответствия (ТР ТС 021/2011, ст. 23 ч. 9). Текст после принятия не изменяется.</p>
          <button type="button" className="btn" disabled={busy || d.errors.length > 0} onClick={() => run(async () => { await api(`/orgs/${org.id}/declarations/${id}/accept`, { body: {} }); await load(); })}>Принять декларацию</button>
        </div>)}
      {accept && d.status === 'accepted' && (
        <div className="card">
          <h2>Сведения о регистрации</h2>
          <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/orgs/${org.id}/declarations/${id}/register`, { body: reg }); await load(); }); }}>
            <div className="grid2">
              <div><label htmlFor="rgn">Регистрационный номер</label><input id="rgn" required value={reg.regNumber} onChange={(e) => setReg({ ...reg, regNumber: e.target.value })} placeholder="ЕАЭС N RU Д-RU.…" /></div>
              <div><label htmlFor="rgd">Дата регистрации</label><input id="rgd" type="date" required value={reg.regDate} onChange={(e) => setReg({ ...reg, regDate: e.target.value })} /></div>
            </div>
            <button className="btn" disabled={busy}>Внести (один раз, без исправлений)</button>
          </form>
        </div>)}
      {accept && (d.status === 'accepted' || d.status === 'registered' || d.status === 'expired') && (
        <div className="card">
          <h2>Прекращение действия</h2>
          <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/orgs/${org.id}/declarations/${id}/terminate`, { body: term }); await load(); }); }}>
            <div className="grid2">
              <div><label htmlFor="tno">С даты</label><input id="tno" type="date" required value={term.on} onChange={(e) => setTerm({ ...term, on: e.target.value })} /></div>
              <div><label htmlFor="trs">Причина</label><input id="trs" required value={term.reason} onChange={(e) => setTerm({ ...term, reason: e.target.value })} placeholder="изменение рецептуры, отмена сертификата СМ…" /></div>
            </div>
            <p className="small muted">Прекращение регистрируется в ФГИС отдельно (уведомление); здесь — учёт, знак ЕАС на этикетках больше не печатается.</p>
            <button className="btn secondary" disabled={busy}>Прекратить действие</button>
          </form>
        </div>)}
    </>
  );
}
