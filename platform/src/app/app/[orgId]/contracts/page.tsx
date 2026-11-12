'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { CONTRACT_KINDS, STATE_BADGE, type Contract } from '@/lib/contracts';

/** Договоры предприятия: обязательные для ППК, сроки, файлы; внесение нового договора сразу с файлом. */

interface List { contracts: Contract[]; required: { kind: string; label: string; covered: boolean }[] }
const empty = { kind: 'pest_control', siteId: '', counterparty: '', counterpartyInn: '', number: '', signedOn: '', validFrom: '', validTo: '', autoRenew: false, subject: '' };

export default function Contracts() {
  const { org, sites, can } = useOrg();
  const router = useRouter();
  const [x, setX] = useState<List | null>(null);
  const [f, setF] = useState({ ...empty, kind: '' });
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const { busy, error, run, setError } = useSubmit();
  const load = useCallback(() => api<List>(`/orgs/${org.id}/contracts`).then(setX).catch((e) => setError(e.message)), [org.id, setError]);
  useEffect(() => { load(); }, [load]);
  const start = (kind: string) => { setF({ ...empty, kind }); setTimeout(() => document.getElementById('cform')?.scrollIntoView({ behavior: 'smooth' }), 0); };

  const save = () => run(async () => {
    const r = await api<{ id: string }>(`/orgs/${org.id}/contracts`, { body: { ...f, siteId: f.siteId || null } });
    if (file) {
      const fd = new FormData();
      fd.append('file', file); fd.append('entityType', 'contract'); fd.append('entityId', r.id); fd.append('note', 'договор');
      const res = await fetch(`/api/v1/orgs/${org.id}/evidence`, { method: 'POST', body: fd, credentials: 'same-origin' });
      const j = await res.json().catch(() => null);
      if (!j?.ok) { router.push(`/app/${org.id}/contracts/${r.id}?upload=failed`); throw new Error(`Договор сохранён, но файл не загрузился: ${j?.error?.message || 'ошибка загрузки'}`); }
    }
    router.push(`/app/${org.id}/contracts/${r.id}`);
  });

  const active = x?.contracts.filter((c) => c.status === 'active') || [];
  const ended = x?.contracts.filter((c) => c.status !== 'active') || [];
  const row = (c: Contract) => (
    <Link key={c.id} href={`/app/${org.id}/contracts/${c.id}`} className="objrow">
      <div><b>{c.kind_label}</b>
        <div className="small">{c.counterparty}{c.number ? ` · № ${c.number}` : ''}</div>
        <div className="small muted">{c.site_name || 'всё предприятие'} · файлов: {c.files}</div></div>
      <span className={`badge ${STATE_BADGE[c.state]}`}>{c.label}</span>
    </Link>);

  return (
    <>
      <h1>Договоры</h1>
      <p className="small muted">Договоры для программы производственного контроля и работы предприятия. Файл договора (PDF, DOCX или фото скана) хранится неизменным; договор без файла не засчитывается. За 30 дней до окончания срока — задача продлить.</p>
      {error && <div className="err" role="alert">{error}</div>}
      {x && (
        <div className="card">
          <h2>Обязательные для ППК</h2>
          {x.required.map((r) => (
            <div key={r.kind} className="between" style={{ padding: '6px 0' }}>
              <span>{r.label}</span>
              {r.covered ? <span className="badge ok">есть</span> : can('contract.manage') ? <button type="button" className="btn secondary" onClick={() => start(r.kind)}>Внести</button> : <span className="badge crit">нет</span>}
            </div>))}
        </div>
      )}
      {x && active.length === 0 && <div className="card"><p className="muted">Договоров пока нет.</p></div>}
      {active.length > 0 && <div className="card">{active.map(row)}</div>}
      {ended.length > 0 && <details className="card"><summary>Расторгнутые ({ended.length})</summary>{ended.map(row)}</details>}

      {can('contract.manage') && (
        <div className="card" id="cform">
          <h2>Внести договор</h2>
          <form onSubmit={(e) => { e.preventDefault(); save(); }}>
            <label htmlFor="ck">Вид</label>
            <select id="ck" required value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              <option value="">— выберите —</option>{CONTRACT_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <label htmlFor="cs">Площадка</label>
            <select id="cs" value={f.siteId} onChange={(e) => setF({ ...f, siteId: e.target.value })}>
              <option value="">Всё предприятие</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <label htmlFor="cc">Контрагент</label>
            <input id="cc" required value={f.counterparty} onChange={(e) => setF({ ...f, counterparty: e.target.value })} placeholder="наименование исполнителя / арендодателя" />
            <div className="grid2">
              <div><label htmlFor="ci">ИНН контрагента</label><input id="ci" inputMode="numeric" value={f.counterpartyInn} onChange={(e) => setF({ ...f, counterpartyInn: e.target.value.replace(/\D/g, '') })} maxLength={12} /></div>
              <div><label htmlFor="cn">Номер договора</label><input id="cn" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></div>
              <div><label htmlFor="cd">Дата заключения</label><input id="cd" type="date" value={f.signedOn} onChange={(e) => setF({ ...f, signedOn: e.target.value })} /></div>
              <div><label htmlFor="cf">Действует с</label><input id="cf" type="date" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} /></div>
              <div><label htmlFor="ct">Действует до</label><input id="ct" type="date" value={f.validTo} onChange={(e) => setF({ ...f, validTo: e.target.value })} /></div>
              <div style={{ alignSelf: 'end' }}><label className="row" style={{ fontWeight: 400 }}><input type="checkbox" style={{ width: 22, minHeight: 22 }} checked={f.autoRenew} onChange={(e) => setF({ ...f, autoRenew: e.target.checked })} /> пролонгируется автоматически</label></div>
            </div>
            {!f.validTo && <p className="small muted">Без даты окончания договор считается бессрочным.</p>}
            <label htmlFor="cj">Предмет и периодичность услуг</label>
            <textarea id="cj" rows={3} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} placeholder="как в договоре: например, дератизация ежемесячно, дезинсекция по заявке" />
            <input ref={input} type="file" accept="application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp,image/heic"
              aria-label="Файл договора" style={{ display: 'none' }} onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <button type="button" className="btn block secondary" onClick={() => input.current?.click()}>{file ? `Файл: ${file.name}` : 'Прикрепить файл договора (PDF, DOCX, фото)'}</button>
            {file && file.size > 10 * 1024 * 1024 && <p className="err">Файл больше 10 МБ — разделите скан на части и добавьте в карточке договора.</p>}
            <button className="btn block" disabled={busy || !f.kind || (!!file && file.size > 10 * 1024 * 1024)}>{busy ? 'Сохранение…' : 'Сохранить договор'}</button>
          </form>
        </div>
      )}
    </>
  );
}
