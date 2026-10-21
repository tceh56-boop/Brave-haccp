'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { api } from '@/lib/api';
import { dt } from '@/lib/fmt';
import { Evidence } from '@/components/Evidence';

/** Результат лабораторного исследования: протокол, показатели, отклонение, скан протокола. Запись не меняется. */

interface R { id: string; test_type: string; target: string; lab_name: string; protocol_no: string; sampled_on: string; result_on: string; result: string; conclusion: string | null;
  params: { name: string; norm: string; fact: string; unit: string | null; pass: boolean }[]; incident_id: string | null; recorded_by_name: string; recorded_at: string;
  program_basis: string | null; dish: string | null; lot_no: string | null }
const ddmm = (s: string) => s.slice(0, 10).split('-').reverse().join('.');

export default function LabResult({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { org } = useOrg();
  const [r, setR] = useState<R | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<R>(`/orgs/${org.id}/lab/results/${id}`).then(setR).catch((e) => setErr(e.message)); }, [org.id, id]);
  if (!r) return err ? <div className="err">{err}</div> : <p className="muted">Загрузка…</p>;
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/lab?tab=lab`}>← Лаборатория</Link></p>
      <div className="between"><h1 style={{ margin: 0 }}>{r.test_type}</h1><span className={`badge ${r.result === 'pass' ? 'ok' : 'crit'}`}>{r.result === 'pass' ? 'соответствует' : 'не соответствует'}</span></div>
      <p className="muted">{r.target}{r.dish ? ` · ${r.dish}` : ''}{r.lot_no ? ` · партия ${r.lot_no}` : ''}</p>
      <div className="card">
        <div className="kv">
          <span>Лаборатория</span><b>{r.lab_name}</b>
          <span>Протокол</span><b>№ {r.protocol_no} от {ddmm(r.result_on)}</b>
          <span>Отбор</span><b>{ddmm(r.sampled_on)}</b>
          {r.program_basis && <><span>Основание</span><b>{r.program_basis}</b></>}
          {r.conclusion && <><span>Заключение</span><b>{r.conclusion}</b></>}
          <span>Внёс(ла)</span><b>{r.recorded_by_name}, {dt(r.recorded_at, org.timezone)}</b>
        </div>
        {r.incident_id && <p className="small" style={{ marginTop: 10 }}><Link href={`/app/${org.id}/incidents/${r.incident_id}`}>Отклонение по несоответствию →</Link></p>}
      </div>
      {r.params.length > 0 && (
        <div className="card">
          <h2>Показатели</h2>
          <div className="scroll"><table className="tbl"><thead><tr><th>Показатель</th><th>Норма</th><th>Факт</th><th /></tr></thead>
            <tbody>{r.params.map((p, i) => <tr key={i}><td>{p.name}</td><td>{p.norm}</td><td>{p.fact}{p.unit ? ` ${p.unit}` : ''}</td><td><span className={`badge ${p.pass ? 'ok' : 'crit'}`}>{p.pass ? 'в норме' : 'вне нормы'}</span></td></tr>)}</tbody></table></div>
        </div>
      )}
      <Evidence entityType="lab_result" entityId={r.id} title="Скан протокола" />
    </>
  );
}
