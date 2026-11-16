import { handler, requireSession } from '@/server/http/route';
import { listSanitation } from '@/server/ops/sanitation';

type P = { orgId: string };

export const GET = handler<P>(async (c) => listSanitation(requireSession(c).user.id, c.params.orgId, c.req.nextUrl.searchParams.get('siteId') || ''));
