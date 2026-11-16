import { handler, requireSession } from '@/server/http/route';
import { shiftCards } from '@/server/ops/shift';

type P = { orgId: string; siteId: string };

export const GET = handler<P>(async (c) => shiftCards(requireSession(c).user.id, c.params.orgId, c.params.siteId));
