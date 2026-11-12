'use client';
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { api } from '@/lib/api';
import { Evidence } from '@/components/Evidence';
import { CONTRACT_KINDS, STATE_BADGE, ddmm, type Contract } from '@/lib/contracts';

/** Карточка договора: реквизиты (правка, продление), файлы договора (только добавляются), расторжение с причиной. */

const formOf = (c: Contract) => ({ kind: c.kind, siteId: c.site_id || '', title: c.title, counterparty: c.counterparty, counterpartyInn: c.counterparty_inn || '', number: c.number || '',
  signedOn: c.signed_on || '', validFrom: c.valid_from || '', validTo: c.valid_to || '', autoRenew: c.auto_renew, subject: c.subject || '' });

export default function ContractCard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { org, sites, can } = useOrg();
  const failed = useSearchParams().get('upload') === 'failed';
  const [c, setC] = useState<Contract | null>(null);
  const [mode, setMode] = useState<'' | 'edit' | 'terminate'>('');
  const [f, setF] = useState<ReturnType<typeof formOf> | null>(null);
  const [t, setT] = useState({ terminatedOn: '', reason: '' });
  const { busy, error, run, setError } = useSubmit();
  const load = useCallback(() => api<Contract>(`/orgs/${org.id}/contracts/${id}`).then((x) => { setC(x); setF(formOf(x)); }).catch((e) => setError(e.message)), [org.id, id, setError]);
  useEffect(() => { load(); }, [load]);
  if (!c || !f) return error ? <div className="err">{error}</div> : <p className="muted">Загрузка…</p>;
  const manage = can('contract.manage') && c.status === 'active';

  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/contracts`}>← Договоры</Link></p>
      <div className="between"><h1 style={{ margin: 0 }}>{c.kind_label}</h1><span className={`badge ${STATE_BADGE[c.state]}`}>{c.label}</span></div>
      <p className="muted">{c.counterparty}{c.number ? ` · № ${c.number}` : ''}</p>
      {error && <div className="err" role="alert">{error}</div>}
      {failed && c.files === 0 && <div className="err">Договор сохранён, но файл не загрузился — добавьте его ниже.</div>}
      {c.state === 'no_file' && !failed && <div className="err">Нет файла договора — без него договор в ППК не засчитывается.</div>}

      <div className="card">
        <div className="kv">
          {c.title !== c.kind_label && <><span>Наименование</span><b>{c.title}</b></>}
          <span>Площадка</span><b>{c.site_name || 'всё предприятие'}</b>
          <span>Контрагент</span><b>{c.counterparty}{c.counterparty_inn ? `, ИНН ${c.counterparty_inn}` : ''}</b>
          {c.signed_on && <><span>Заключён</span><b>{ddmm(c.signed_on)}</b></>}
          <span>Срок</span><b>{c.valid_from ? `с ${ddmm(c.valid_from)} ` : ''}{c.valid_to ? `до ${ddmm(c.valid_to)}` : 'бессрочный'}{c.auto_renew ? ', автопролонгация' : ''}</b>
          {c.subject && <><span>Предмет</span><b style={{ whiteSpace: 'pre-wrap', fontWeight: 400 }}>{c.subject}</b></>}
          {c.status === 'terminated' && <><span>Расторгнут</span><b>{ddmm(c.terminated_on)} — {c.terminate_reason}</b></>}
        </div>
        {manage && !mode && <div className="row" style={{ marginTop: 12, gap: 8 }}>
          <button type="button" className="btn secondary" onClick={() => setMode('edit')}>Изменить / продлить</button>
          <button type="button" className="btn secondary" onClick={() => setMode('terminate')}>Расторгнуть</button></div>}
      </div>

      {manage && mode === 'edit' && (
        <div className="card">
          <h2>Реквизиты</h2>
          <form onSubmit={(e) => { e.preventDefault(); run(async () => {
            await api(`/orgs/${org.id}/contracts/${id}`, { method: 'PATCH', body: { ...f, siteId: f.siteId || null } }); setMode(''); await load();
          }); }}>
            <label htmlFor="ek">Вид</label>
            <select id="ek" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{CONTRACT_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <label htmlFor="es">Площадка</label>
            <select id="es" value={f.siteId} onChange={(e) => setF({ ...f, siteId: e.target.value })}><option value="">Всё предприятие</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <label htmlFor="et">Наименование</label><input id="et" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
            <label htmlFor="ec">Контрагент</label><input id="ec" required value={f.counterparty} onChange={(e) => setF({ ...f, counterparty: e.target.value })} />
            <div className="grid2">
              <div><label htmlFor="ei">ИНН</label><input id="ei" inputMode="numeric" maxLength={12} value={f.counterpartyInn} onChange={(e) => setF({ ...f, counterpartyInn: e.target.value.replace(/\D/g, '') })} /></div>
              <div><label htmlFor="en">Номер</label><input id="en" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></div>
              <div><label htmlFor="ed">Заключён</label><input id="ed" type="date" value={f.signedOn} onChange={(e) => setF({ ...f, signedOn: e.target.value })} /></div>
              <div><label htmlFor="ef">Действует с</label><input id="ef" type="date" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} /></div>
              <div><label htmlFor="eu">Действует до</label><input id="eu" type="date" value={f.validTo} onChange={(e) => setF({ ...f, validTo: e.target.value })} /></div>
              <div style={{ alignSelf: 'end' }}><label className="row" style={{ fontWeight: 400 }}><input type="checkbox" style={{ width: 22, minHeight: 22 }} checked={f.autoRenew} onChange={(e) => setF({ ...f, autoRenew: e.target.checked })} /> автопролонгация</label></div>
            </div>
            <label htmlFor="ej">Предмет и периодичность</label><textarea id="ej" rows={3} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />
            <p className="small muted">Продление — новая дата окончания; дополнительное соглашение добавьте файлом ниже.</p>
            <div className="row" style={{ gap: 8 }}><button className="btn" disabled={busy}>Сохранить</button><button type="button" className="btn secondary" onClick={() => { setMode(''); setF(formOf(c)); }}>Отмена</button></div>
          </form>
        </div>
      )}

      {manage && mode === 'terminate' && (
        <div className="card">
          <h2>Расторжение</h2>
          <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/orgs/${org.id}/contracts/${id}/terminate`, { body: t }); setMode(''); await load(); }); }}>
            <label htmlFor="td">Дата расторжения</label><input id="td" type="date" required value={t.terminatedOn} onChange={(e) => setT({ ...t, terminatedOn: e.target.value })} />
            <label htmlFor="tr">Причина</label><input id="tr" required value={t.reason} onChange={(e) => setT({ ...t, reason: e.target.value })} placeholder="соглашение сторон, смена исполнителя" />
            <p className="small muted">Расторгнутый договор не изменяется; реквизиты и файлы остаются в истории.</p>
            <div className="row" style={{ gap: 8 }}><button className="btn" disabled={busy}>Расторгнуть</button><button type="button" className="btn secondary" onClick={() => setMode('')}>Отмена</button></div>
          </form>
        </div>
      )}

      <Evidence entityType="contract" entityId={c.id} title="Файлы договора" docs readPerm="contract.read" addPerm="contract.manage"
        hint="Например: договор, доп. соглашение № 1, акт выполненных работ" />
    </>
  );
}
