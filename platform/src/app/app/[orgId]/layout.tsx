'use client';
import { use } from 'react';
import { AppShell } from '@/components/AppShell';
import { OrgProvider } from '@/lib/org';
import { OrgNav } from '@/components/OrgNav';

export default function OrgLayout({ children, params }: { children: React.ReactNode; params: Promise<{ orgId: string }> }) {
  const { orgId } = use(params);
  return (
    <AppShell>
      {(me) => (
        <OrgProvider orgId={orgId} me={me}>
          <div className="with-bottomnav">{children}</div>
          <OrgNav />
        </OrgProvider>
      )}
    </AppShell>
  );
}
