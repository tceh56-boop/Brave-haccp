import { handler, requireSession } from '@/server/http/route';
import { confirmLotExpiry } from '@/server/ops/lots';

type P = { orgId: string; lotId: string };

export const POST = handler<P>(async (c) => confirmLotExpiry(requireSession(c).user.id, c.params.orgId, c.params.lotId, await c.body()));
