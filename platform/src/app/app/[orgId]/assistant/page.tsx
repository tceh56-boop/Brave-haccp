'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { useSubmit } from '@/components/useSubmit';
import { AiAnswerView, type AiResult } from '@/components/AiAnswer';
import { api } from '@/lib/api';
import { dt } from '@/lib/fmt';

interface Job { id: string; kind: string; status: string; question: string | null; created_at: string }
const KIND: Record<string, string> = { question: 'Вопрос', incident_explain: 'Отклонение', capa_suggest: 'CAPA', agent: 'ЦЕХ AI' };
const STATUS: Record<string, string> = { ok: 'ответ', guard_rejected: 'отклонён проверкой', no_sources: 'нет источника', unavailable: 'AI не подключён', refused: 'отказ', error: 'ошибка', step_limit: 'не уложился в шаги' };

/** ЦЕХ AI: агент смотрит данные системы и реестр требований; режим «только реестр» — прежний вопрос по требованиям. */
export default function AssistantPage() {
  const { org, can } = useOrg();
  const [q, setQ] = useState('');
  const [registryOnly, setRegistryOnly] = useState(false);
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
      <h1>ЦЕХ AI</h1>
      <p className="small muted">Сам смотрит данные системы, которые доступны вам: проблемы на сегодня, задачи, отклонения, партии, CAPA, прошлые случаи. Требования берёт только из утверждённого реестра и цитирует с пунктом и редакцией. Нормы, сроки и температуры не придумывает, ничего не меняет — предлагает, решаете вы.</p>
      {status && !status.available && <div className="note">AI не подключён (нет ключа API). Поиск по реестру работает: будут показаны найденные требования.</div>}
      <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => setR(await api<AiResult>(`/orgs/${org.id}/ai/${registryOnly ? 'ask' : 'agent'}`, { body: { question: q } }))); }}>
        <label htmlFor="aq">Вопрос</label>
        <textarea id="aq" rows={3} required value={q} onChange={(e) => setQ(e.target.value)} placeholder={registryOnly ? 'Например: при какой температуре хранить охлаждённое мясо?' : 'Например: что у меня сегодня не в порядке? Какие партии скоро истекают?'} />
        <label className="small" style={{ fontWeight: 400, display: 'flex', gap: 10, alignItems: 'center', margin: '8px 0' }}><input type="checkbox" style={{ width: 22, minHeight: 22, flex: 'none' }} checked={registryOnly} onChange={(e) => setRegistryOnly(e.target.checked)} /> Только по требованиям реестра, без данных системы</label>
        {error && <div className="err">{error}</div>}
        <button className="btn block" disabled={busy}>{busy ? (registryOnly ? 'Ищу в реестре…' : 'Смотрю данные системы…') : 'Спросить'}</button>
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
