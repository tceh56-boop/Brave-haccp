import { handler, requireSession } from '@/server/http/route';
import { getProblems } from '@/server/ops/dashboard';

type P = { orgId: string };

export const GET = handler<P>(async (c) => getProblems(requireSession(c).user.id, c.params.orgId, c.req.nextUrl.searchParams.get('siteId')));
