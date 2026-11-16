import { handler, requireSession } from '@/server/http/route';
import { listRecalls } from '@/server/ops/recalls';

type P = { orgId: string };

export const GET = handler<P>(async (c) => listRecalls(requireSession(c).user.id, c.params.orgId));
