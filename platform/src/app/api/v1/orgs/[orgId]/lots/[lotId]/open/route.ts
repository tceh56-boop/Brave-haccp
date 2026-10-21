import { handler, requireSession } from '@/server/http/route';
import { openLot } from '@/server/ops/labels';

type P = { orgId: string; lotId: string };

export const POST = handler<P>(async (c) => openLot(requireSession(c).user.id, c.params.orgId, c.params.lotId, await c.body()));
