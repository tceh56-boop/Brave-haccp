import { handler, requireSession } from '@/server/http/route';
import { recordEvent } from '@/server/ops/equipment';

type P = { orgId: string; id: string };

export const POST = handler<P>(async (c) => recordEvent(requireSession(c).user.id, c.params.orgId, c.params.id, await c.body()));
