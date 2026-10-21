import { handler, requireSession } from '@/server/http/route';
import { getResult } from '@/server/ops/lab';

type P = { orgId: string; id: string };

export const GET = handler<P>(async (c) => getResult(requireSession(c).user.id, c.params.orgId, c.params.id));
