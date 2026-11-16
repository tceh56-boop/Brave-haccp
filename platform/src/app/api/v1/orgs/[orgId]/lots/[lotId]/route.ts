import { handler, requireSession } from '@/server/http/route';
import { getLot } from '@/server/ops/lots';

type P = { orgId: string; lotId: string };

export const GET = handler<P>(async (c) => getLot(requireSession(c).user.id, c.params.orgId, c.params.lotId));
