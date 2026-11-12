import { handler, requireSession } from '@/server/http/route';
import { menuCosts } from '@/server/ops/priceImpact';

type P = { orgId: string };

export const GET = handler<P>(async (c) => menuCosts(requireSession(c).user.id, c.params.orgId));
