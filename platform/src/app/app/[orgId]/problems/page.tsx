'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { api } from '@/lib/api';
import { dt } from '@/lib/fmt';

interface Card { key: string; priority: number; tone: string; title: string; what: string; where: string; at: string | null; risk: string; responsible: string | null; due_at: string | null; source: string | null; action: string; href: string; status?: string }

/** Дашборд проблем (ТЗ v2 §2): обнаружил → открыл → исправил. Карточка открывает конкретный объект. */
export default function ProblemsPage() {
  const { org, sites, siteId } = useOrg();
  const [scope, setScope] = useState<'site' | 'all'>('site');
  const [data, setData] = useState<{ cards: Card[]; counts: { critical: number; total: number } } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api<typeof data>(`/orgs/${org.id}/problems${scope === 'site' && siteId ? `?siteId=${siteId}` : ''}`).then(setData).catch((e) => setErr(e.message)), [org.id, siteId, scope]);
  useEffect(() => { load(); }, [load]);
  const tz = org.timezone;
  return (
    <>
      <div className="between"><h1 style={{ margin: 0 }}>Проблемы</h1>{data && <span className={`badge ${data.counts.critical ? 'crit' : 'ok'}`}>{data.counts.total ? `${data.counts.total}, срочных ${data.counts.critical}` : 'нет'}</span>}</div>
      {sites.length > 1 && <div className="chips" style={{ marginTop: 10 }}><button aria-pressed={scope === 'site'} onClick={() => setScope('site')}>{sites.find((s) => s.id === siteId)?.name}</button><button aria-pressed={scope === 'all'} onClick={() => setScope('all')}>Все площадки</button></div>}
      {err && <div className="err">{err}</div>}
      {!data ? <p className="muted">Загрузка…</p> : data.cards.length === 0 ? <div className="okbox">Проблем нет.</div> : data.cards.map((c) => (
        <Link key={c.key} href={c.href} className={`card prob ${c.tone}`} style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
          <div className="between"><b>{c.title}</b>{c.status && <span className="badge">{c.status}</span>}</div>
          {c.what && <div style={{ margin: '6px 0' }}>{c.what}</div>}
          <div className="small muted">{[c.where, c.at && dt(c.at, tz), c.risk].filter(Boolean).join(' · ')}</div>
          <div className="small muted">{[c.responsible && `отвечает: ${c.responsible}`, c.due_at && `срок: ${dt(c.due_at, tz)}`].filter(Boolean).join(' · ')}</div>
          {c.source && <div className="small muted">основание: {c.source}</div>}
          <div style={{ marginTop: 8 }}><span className="btn small">{c.action.length > 60 ? 'Открыть' : c.action} →</span></div>
        </Link>
      ))}
    </>
  );
}
