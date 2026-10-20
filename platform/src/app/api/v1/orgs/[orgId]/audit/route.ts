import { handler, requireSession } from '@/server/http/route';
import { listAudit } from '@/server/org/organizations';

type P = { orgId: string };
export const GET = handler<P>(async (c) => listAudit(requireSession(c).user.id, c.params.orgId, {
  beforeId: Number(c.req.nextUrl.searchParams.get('before')) || undefined,
  limit: Number(c.req.nextUrl.searchParams.get('limit')) || undefined,
}));
