import { handler, requireSession } from '@/server/http/route';
import { listControlObjects } from '@/server/ops/control';

type P = { orgId: string; siteId: string };

export const GET = handler<P>(async (c) => listControlObjects(requireSession(c).user.id, c.params.orgId, c.params.siteId));
