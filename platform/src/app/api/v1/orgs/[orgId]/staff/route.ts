import { handler, requireSession } from '@/server/http/route';
import { listStaff } from '@/server/ops/staff';

type P = { orgId: string };

export const GET = handler<P>(async (c) => listStaff(requireSession(c).user.id, c.params.orgId, c.req.nextUrl.searchParams.get('siteId') || null));
