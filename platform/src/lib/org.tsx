'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';
import type { Me } from '@/components/AppShell';

export interface Site { id: string; name: string; address: string | null; status: string }
export interface OrgCtx {
  me: Me;
  org: { id: string; name: string; status: string; timezone: string };
  role: string; roleLabel: string; permissions: string[]; siteIds: string[];
  sites: Site[]; siteId: string | null; setSiteId: (id: string) => void;
  can: (p: string) => boolean; reloadSites: () => Promise<void>;
}

const Ctx = createContext<OrgCtx | null>(null);

export function useOrg(): OrgCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useOrg вне OrgProvider');
  return c;
}

/** Предприятие, права участника и площадки; выбранная площадка запоминается на устройстве. */
export function OrgProvider({ orgId, me, children }: { orgId: string; me: Me; children: React.ReactNode }) {
  const [state, setState] = useState<Omit<OrgCtx, 'setSiteId' | 'can' | 'reloadSites' | 'siteId' | 'me'> | null>(null);
  const [siteId, setSite] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const key = `ceh.site.${orgId}`;

  const reloadSites = useCallback(async () => {
    const sites = await api<Site[]>(`/orgs/${orgId}/sites`);
    setState((s) => (s ? { ...s, sites } : s));
  }, [orgId]);

  useEffect(() => {
    (async () => {
      try {
        const r = await api<{ organization: OrgCtx['org']; membership: { role: string; role_label: string; permissions: string[]; site_ids: string[] } }>(`/orgs/${orgId}`);
        const sites = (await api<Site[]>(`/orgs/${orgId}/sites`)).filter((s) => s.status === 'active');
        setState({ org: r.organization, role: r.membership.role, roleLabel: r.membership.role_label, permissions: r.membership.permissions, siteIds: r.membership.site_ids, sites });
        let saved: string | null = null;
        try { saved = localStorage.getItem(key); } catch { /* приватный режим */ }
        setSite(sites.find((s) => s.id === saved)?.id || sites[0]?.id || null);
      } catch (e) { setErr((e as Error).message); }
    })();
  }, [orgId, key]);

  if (err) return <div className="err">{err}</div>;
  if (!state) return <p className="muted">Загрузка…</p>;
  const value: OrgCtx = {
    ...state, me, siteId,
    setSiteId: (id) => { setSite(id); try { localStorage.setItem(key, id); } catch { /* ignore */ } },
    can: (p) => state.permissions.includes(p), reloadSites,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
