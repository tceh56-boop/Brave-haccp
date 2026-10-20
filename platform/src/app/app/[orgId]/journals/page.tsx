'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { api } from '@/lib/api';

export interface FormInfo { code: string; name: string; purpose: string; fill: string; overlaps: string[]; mode: 'auto' | 'manual'; data_form: string; shares_with: string | null; columns: string[] }

/** Журналы J01–J53: автоматические собираются из операций смены, ручные — записью по столбцам шаблона. */
export default function JournalsPage() {
  const { org } = useOrg();
  const [forms, setForms] = useState<FormInfo[] | null>(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<FormInfo[]>(`/orgs/${org.id}/journals`).then(setForms).catch((e) => setErr(e.message)); }, [org.id]);
  const match = (f: FormInfo) => !q || `${f.code} ${f.name} ${f.purpose}`.toLowerCase().includes(q.toLowerCase());
  const group = (mode: FormInfo['mode']) => (forms || []).filter((f) => f.mode === mode && match(f));
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}`}>← Управление</Link></p>
      <h1>Журналы</h1>
      <p className="small muted">Операцию вносят один раз — замер, приёмку, отклонение. Журналы, связанные с ней, собираются сами. Записывать то же самое ещё и в журнал не нужно.</p>
      {err && <div className="err">{err}</div>}
      <input aria-label="Поиск журнала" placeholder="Найти журнал: номер или название" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12 }} />
      {!forms ? <p className="muted">Загрузка…</p> : (['auto', 'manual'] as const).map((mode) => group(mode).length > 0 && (
        <div className="card" key={mode}>
          <h2>{mode === 'auto' ? 'Заполняются из операций' : 'Ручные записи'}</h2>
          {group(mode).map((f) => (
            <Link key={f.code} className="objrow" href={`/app/${org.id}/journals/${f.code}`}>
              <div><b>{f.code}</b> {f.name}
                <div className="small muted">{f.purpose}</div>
                {f.shares_with && <div className="small">те же записи, что в {f.shares_with}</div>}</div>
              <span aria-hidden>›</span>
            </Link>
          ))}
        </div>
      ))}
    </>
  );
}
