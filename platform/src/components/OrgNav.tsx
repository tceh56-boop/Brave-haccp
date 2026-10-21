'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useOrg } from '@/lib/org';

/** Нижнее меню на телефоне: смена, проблемы, задачи, сроки, управление. */
export function OrgNav() {
  const { org, can } = useOrg();
  const path = usePathname();
  const base = `/app/${org.id}`;
  const items = [
    { href: `${base}/shift`, label: 'Смена', show: can('measure.record') || can('receipt.record') },
    { href: `${base}/problems`, label: 'Проблемы', show: can('incident.read') },
    { href: `${base}/tasks`, label: 'Задачи', show: can('task.read') },
    { href: `${base}/stock`, label: 'Склад', show: can('lot.read') },
    { href: `${base}/pos`, label: 'Касса', show: can('pos.sell') && !can('lot.read') },
    { href: base, label: 'Управление', show: true },
  ].filter((i) => i.show);
  return (
    <nav className="bottomnav" aria-label="Разделы">
      {items.map((i) => {
        const active = i.href === base ? path === base : path.startsWith(i.href) || (i.label === 'Склад' && path.startsWith(`${base}/lots`));
        return <Link key={i.href} href={i.href} aria-current={active ? 'page' : undefined}>{i.label}</Link>;
      })}
    </nav>
  );
}

export function SitePicker() {
  const { sites, siteId, setSiteId } = useOrg();
  if (sites.length <= 1) return null;
  return (
    <select aria-label="Площадка" value={siteId || ''} onChange={(e) => setSiteId(e.target.value)} style={{ marginBottom: 12 }}>
      {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
}
