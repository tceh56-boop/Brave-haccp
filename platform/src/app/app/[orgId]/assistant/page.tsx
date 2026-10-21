'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { AiAnswerView, type AiResult } from '@/components/AiAnswer';
import { api } from '@/lib/api';
import { dt } from '@/lib/fmt';

interface Job { id: string; kind: string; status: string; question: string | null; created_at: string }
const KIND: Record<string, string> = { question: 'Вопрос', incident_explain: 'Отклонение', capa_suggest: 'CAPA' };
const STATUS: Record<string, string> = { ok: 'ответ', guard_rejected: 'отклонён проверкой', no_sources: 'нет источника', unavailable: 'AI не подключён', refused: 'отказ', error: 'ошибка' };

/** Вопрос по требованиям: поиск в утверждённом реестре предприятия + ответ AI с цитатой. */
export default function AssistantPage() {
  const { org, can } = useOrg();
  const [q, setQ] = useState('');
  const [r, setR] = useState<AiResult | null>(null);
  const [mine, setMine] = useState<Job[]>([]);
  const [status, setStatus] = useState<{ available: boolean } | null>(null);
  const { busy, error, run } = useSubmit();
  useEffect(() => {
    api<{ available: boolean }>(`/orgs/${org.id}/ai/status`).then(setStatus).catch(() => setStatus(null));
    api<Job[]>(`/orgs/${org.id}/ai/jobs?mine=1`).then(setMine).catch(() => setMine([]));
  }, [org.id, r]);
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}`}>← Управление</Link></p>
      <h1>AI-помощник</h1>
      <p className="small muted">Ищет ответ в утверждённых требованиях вашего реестра и отвечает со ссылкой на источник, пункт, редакцию и дату проверки. Если требования нет — так и скажет. Нормы, сроки и температуры не придумывает.</p>
      {status && !status.available && <div className="note">AI не подключён (нет ключа API). Поиск по реестру работает: будут показаны найденные требования.</div>}
      <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => setR(await api<AiResult>(`/orgs/${org.id}/ai/ask`, { body: { question: q } }))); }}>
        <label htmlFor="aq">Вопрос</label>
        <textarea id="aq" rows={3} required value={q} onChange={(e) => setQ(e.target.value)} placeholder="Например: при какой температуре хранить охлаждённое мясо?" />
        {error && <div className="err">{error}</div>}
        <button className="btn block" disabled={busy}>{busy ? 'Ищу в реестре…' : 'Спросить'}</button>
      </form>
      {r && <AiAnswerView r={r} />}
      {mine.length > 0 && (
        <div className="card">
          <div className="between"><h2 style={{ margin: 0 }}>Мои запросы</h2>{can('ai.audit') && <Link className="small" href={`/app/${org.id}/assistant/log`}>Журнал AI →</Link>}</div>
          <ul className="list">{mine.slice(0, 20).map((j) => (
            <li key={j.id}><Link href={`/app/${org.id}/assistant/${j.id}`}>{KIND[j.kind]}{j.question ? `: ${j.question}` : ''}</Link>
              <div className="small muted">{dt(j.created_at, org.timezone)} · {STATUS[j.status]}</div></li>
          ))}</ul>
        </div>
      )}
    </>
  );
}
