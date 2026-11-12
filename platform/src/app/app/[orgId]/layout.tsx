'use client';
import { use } from 'react';
import { AppShell } from '@/components/AppShell';
import { OrgProvider } from '@/lib/org';
import { OrgChrome } from '@/components/OrgNav';

export default function OrgLayout({ children, params }: { children: React.ReactNode; params: Promise<{ orgId: string }> }) {
  const { orgId } = use(params);
  return (
    <AppShell bare>
      {(me) => (
        <OrgProvider orgId={orgId} me={me}>
          <OrgChrome>{children}</OrgChrome>
        </OrgProvider>
      )}
    </AppShell>
  );
}
