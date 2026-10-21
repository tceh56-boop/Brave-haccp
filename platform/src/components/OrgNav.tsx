'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useOrg } from '@/lib/org';
import { Logo } from './Logo';
import { TopBar } from './AppShell';

interface Item { href: string; label: string; show: boolean; match?: string[] }

/** Разделы предприятия по группам, как в боковом меню прежнего ЦЕХ; показываются только разделы роли. */
function useGroups(): [string, Item[]][] {
  const { org, can } = useOrg();
  const b = `/app/${org.id}`;
  const groups: [string, Item[]][] = [
    ['Оперативное', [
      { href: `${b}/shift`, label: 'Смена', show: can('measure.record') || can('receipt.record'), match: [`${b}/objects`, `${b}/report`] },
      { href: `${b}/problems`, label: 'Проблемы', show: can('incident.read'), match: [`${b}/incidents`] },
      { href: `${b}/tasks`, label: 'Задачи', show: can('task.read') },
      { href: `${b}/stock`, label: 'Склад', show: can('lot.read'), match: [`${b}/lots`, `${b}/receipts`] },
      { href: `${b}/production`, label: 'Производство', show: can('production.read') },
      { href: `${b}/labels`, label: 'Маркировка', show: can('label.print') },
      { href: `${b}/journals`, label: 'Журналы', show: can('journal.read') },
      { href: `${b}/pos`, label: 'Касса', show: can('pos.sell') },
      { href: `${b}/stop-list`, label: 'Стоп-лист', show: can('menu.read') },
    ]],
    ['ХАССП', [
      { href: `${b}/haccp`, label: 'План ХАССП', show: can('haccp.read') },
      { href: `${b}/capa`, label: 'CAPA', show: can('capa.read') },
      { href: `${b}/regulatory`, label: 'Нормативная база', show: can('reg.read') },
      { href: `${b}/assistant`, label: 'AI-помощник', show: can('ai.use') },
      { href: `${b}/pack`, label: 'Пакет для проверки', show: can('pack.export') },
    ]],
    ['Меню и продажи', [
      { href: `${b}/menu`, label: 'Блюда и ТТК', show: can('menu.read') },
      { href: `${b}/sales`, label: 'Продажи', show: can('sales.manage') },
      { href: `${b}/economics`, label: 'Экономика', show: can('econ.read') },
    ]],
    ['Управление', [
      { href: b, label: 'Управление', show: true },
      { href: `${b}/setup`, label: 'Объекты, товары, поставщики', show: can('control.manage') || can('catalog.manage') },
      { href: `${b}/readiness`, label: 'Готовность к пилоту', show: can('pilot.read') },
      { href: `${b}/guide`, label: 'Памятки по ролям', show: true },
      { href: '/app', label: 'Мои предприятия', show: true },
    ]],
  ];
  return groups.map(([g, items]) => [g, items.filter((i) => i.show)] as [string, Item[]]).filter(([, items]) => items.length > 0);
}

/** Шапка с ☰ и выдвижное меню разделов (заменяет нижнюю панель, как в прежнем ЦЕХ). */
export function OrgChrome({ children }: { children: React.ReactNode }) {
  const { me, org, roleLabel, siteId } = useOrg();
  const groups = useGroups();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, [open]);
  const b = `/app/${org.id}`;
  const active = (i: Item) => (i.href === b || i.href === '/app' ? path === i.href : [i.href, ...(i.match || [])].some((h) => path.startsWith(h)));
  return (
    <>
      <TopBar me={me} roleLabel={roleLabel} onMenu={() => setOpen(true)} home={b} />
      <div className={`menu-overlay${open ? ' open' : ''}`} onClick={() => setOpen(false)} aria-hidden="true" />
      <nav className={`sidemenu${open ? ' open' : ''}`} aria-label="Разделы" aria-hidden={!open} inert={!open}>
        <div className="menu-head"><Logo height={30} eyes="#fff" /><div className="small">{org.name}</div></div>
        {groups.map(([g, items]) => (
          <div key={g}>
            <div className="menu-group">{g}</div>
            {items.map((i) => <Link key={i.href} href={i.href} className="menu-item" aria-current={active(i) ? 'page' : undefined}>{i.label}</Link>)}
          </div>
        ))}
      </nav>
      {/* смена площадки — экран создаётся заново: запоздавший ответ по прежней площадке не перезапишет данные */}
      <main className="wrap" key={siteId || 'all'}>{children}</main>
    </>
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
