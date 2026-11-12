import { handler, requireSession } from '@/server/http/route';
import { getCompliance } from '@/server/ops/compliance';

type P = { orgId: string };

export const GET = handler<P>(async (c) => getCompliance(requireSession(c).user.id, c.params.orgId, c.req.nextUrl.searchParams.get('siteId') || undefined));
