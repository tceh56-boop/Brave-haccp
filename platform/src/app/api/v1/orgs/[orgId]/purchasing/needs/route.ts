import { handler, requireSession } from '@/server/http/route';
import { purchaseNeeds } from '@/server/ops/purchasing';

type P = { orgId: string };

export const GET = handler<P>(async (c) => purchaseNeeds(requireSession(c).user.id, c.params.orgId, c.req.nextUrl.searchParams.get('siteId') || ''));
