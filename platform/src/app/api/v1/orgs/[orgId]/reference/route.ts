import { handler, requireSession } from '@/server/http/route';
import { searchReference } from '@/server/ops/reference';

type P = { orgId: string };

export const GET = handler<P>(async (c) => searchReference(requireSession(c).user.id, c.params.orgId, c.req.nextUrl.searchParams.get('q') || ''));
