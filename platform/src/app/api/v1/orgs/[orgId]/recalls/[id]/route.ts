import { handler, requireSession } from '@/server/http/route';
import { getRecall } from '@/server/ops/recalls';

type P = { orgId: string; id: string };

export const GET = handler<P>(async (c) => getRecall(requireSession(c).user.id, c.params.orgId, c.params.id));
