'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { AiAnswerView, type AiResult } from '@/components/AiAnswer';
import { api } from '@/lib/api';
import { dt } from '@/lib/fmt';

interface Job extends AiResult { prompt_version: string; context: unknown; question: string | null; created_at: string;
  decisions: { item_index: number | null; decision: string; note: string | null; task_id: string | null; created_at: string; user_name: string }[] }
const DEC: Record<string, string> = { task_created: 'задача создана', rejected: 'отклонено', helpful: 'ответ помог', not_helpful: 'ответ не помог' };

/** Запись журнала AI: входные данные, источники, модель, версия инструкции, ответ, решения людей (ТЗ v2 §11). */
export default function JobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = use(params);
  const { org } = useOrg();
  const [j, setJ] = useState<Job | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<Job>(`/orgs/${org.id}/ai/jobs/${jobId}`).then(setJ).catch((e) => setErr(e.message)); }, [org.id, jobId]);
  if (!j) return err ? <div className="err">{err}</div> : <p className="muted">Загрузка…</p>;
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}/assistant`}>← AI-помощник</Link></p>
      <h1>Запрос к AI</h1>
      <div className="card">
        <dl className="kv"><dt>Когда</dt><dd>{dt(j.created_at, org.timezone)}</dd><dt>Модель</dt><dd>{j.model || '—'}</dd><dt>Инструкция</dt><dd>{j.prompt_version}</dd>
          {j.question && <><dt>Вопрос</dt><dd>{j.question}</dd></>}</dl>
      </div>
      <AiAnswerView r={j} />
      {j.decisions.length > 0 && (
        <div className="card"><h2>Решения людей</h2>
          <ul className="list">{j.decisions.map((x, i) => <li key={i}>{x.item_index !== null ? `Действие ${x.item_index + 1}: ` : ''}{DEC[x.decision]}{x.note ? ` — ${x.note}` : ''}
            <div className="small muted">{x.user_name}, {dt(x.created_at, org.timezone)}{x.task_id ? ' · ' : ''}{x.task_id && <Link href={`/app/${org.id}/tasks#${x.task_id}`}>задача</Link>}</div></li>)}</ul></div>
      )}
      <details className="card"><summary>Данные, переданные AI</summary><pre className="small" style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(j.context, null, 2)}</pre></details>
    </>
  );
}
