'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/lib/org';
import { SitePicker } from '@/components/OrgNav';

const ymd = (date: Date, tz: string) => date.toLocaleDateString('sv-SE', { timeZone: tz });

/** Пакет документов для проверки: ZIP за период — сводка, журналы, план ХАССП, отклонения, CAPA, доказательства. */
export default function PackPage() {
  const { org, siteId } = useOrg();
  const today = ymd(new Date(), org.timezone);
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const href = siteId ? `/api/v1/orgs/${org.id}/sites/${siteId}/pack?from=${from}&to=${to}` : '#';
  return (
    <>
      <p className="small"><Link href={`/app/${org.id}`}>← Управление</Link></p>
      <SitePicker />
      <h1>Пакет для проверки</h1>
      <p className="small muted">Один архив за период: сводка (index.html), журналы в печатном виде и CSV с отметкой о подписи, утверждённый план ХАССП, отклонения и CAPA, применимые требования, фото и документы с контрольными суммами.</p>
      <div className="card">
        <div className="grid2">
          <div><label htmlFor="pf">С</label><input id="pf" type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></div>
          <div><label htmlFor="pt">По</label><input id="pt" type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></div>
        </div>
        <a className="btn block" href={href} download>Скачать пакет (ZIP)</a>
        <p className="small muted">Период — до трёх месяцев. Неподписанные журналы попадают в пакет с отметкой «не подписан». Пакет не является заключением о соответствии: применимость и соблюдение подтверждают ответственные специалисты.</p>
      </div>
    </>
  );
}
