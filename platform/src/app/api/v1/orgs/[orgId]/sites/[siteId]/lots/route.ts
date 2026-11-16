import { handler, requireSession } from '@/server/http/route';
import { listLots, type ExpiryState } from '@/server/ops/lots';

type P = { orgId: string; siteId: string };

export const GET = handler<P>(async (c) => listLots(requireSession(c).user.id, c.params.orgId, c.params.siteId, { state: (c.req.nextUrl.searchParams.get('state') || undefined) as ExpiryState | 'quarantine' | undefined }));
