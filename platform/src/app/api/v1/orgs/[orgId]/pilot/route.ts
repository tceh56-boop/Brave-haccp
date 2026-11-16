import { handler, requireSession } from '@/server/http/route';
import { getReadiness } from '@/server/ops/readiness';

type P = { orgId: string };

export const GET = handler<P>(async (c) => getReadiness(requireSession(c).user.id, c.params.orgId, c.req.nextUrl.searchParams.get('siteId') || undefined));
