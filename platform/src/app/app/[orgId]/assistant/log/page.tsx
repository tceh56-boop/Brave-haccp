'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { api } from '@/lib/api';
import { dt } from '@/lib/fmt';

interface Job { id: string; kind: string; status: string; question: string | null; model: string | null; prompt_version: string; latency_ms: number | null; created_at: string; user_name: string; sources: number; confidence: string | null; tasks: number }
const KIND: Record<string, string> = { question: 'Вопрос', incident_explain: 'Отклонение', capa_suggest: 'CAPA' };
const STATUS: Record<string, string> = { ok: 'ответ', guard_rejected: 'отклонён проверкой', no_sources: 'нет источника', unavailable: 'AI не подключён', refused: 'отказ', error: 'ошибка' };

/** Журнал AI для руководителя и аудитора: кто спрашивал, что получил, сколько источников, какие задачи приняты. */
export default function AiLogPage() {
  const { org } = useOrg();
  const [rows, setRows] = useState<Job[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<Job[]>(`/orgs/${org.id}/ai/jobs`).then(setRows).catch((e) => setErr(e.message)); }, [org.id]);
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/assistant`}>← AI-помощник</Link></p>
      <h1>Журнал AI</h1>
      {err && <div className="err">{err}</div>}
      <div className="card"><div className="scroll"><table className="tbl">
        <thead><tr><th>Когда</th><th>Кто</th><th>Что</th><th>Итог</th><th>Источн.</th><th>Задач</th></tr></thead>
        <tbody>{(rows || []).map((j) => (
          <tr key={j.id}><td><Link href={`/app/${org.id}/assistant/${j.id}`}>{dt(j.created_at, org.timezone)}</Link></td><td>{j.user_name}</td>
            <td>{KIND[j.kind]}{j.question ? `: ${j.question.slice(0, 60)}` : ''}</td><td>{STATUS[j.status]}{j.confidence ? ` (${j.confidence})` : ''}</td><td>{j.sources}</td><td>{j.tasks}</td></tr>
        ))}</tbody></table></div>
        {rows && rows.length === 0 && <p className="small muted">Запросов пока нет.</p>}
      </div>
    </>
  );
}
