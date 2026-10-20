import { handler, requireSession } from '@/server/http/route';
import { seedStartList } from '@/server/ops/regulatory';

type P = { orgId: string };

export const POST = handler<P>(async (c) => seedStartList(requireSession(c).user.id, c.params.orgId));
