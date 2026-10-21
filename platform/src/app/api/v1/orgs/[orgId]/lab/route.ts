import { handler, requireSession } from '@/server/http/route';
import { listLab } from '@/server/ops/lab';

type P = { orgId: string };

export const GET = handler<P>(async (c) => listLab(requireSession(c).user.id, c.params.orgId, c.req.nextUrl.searchParams.get('siteId') || ''));
