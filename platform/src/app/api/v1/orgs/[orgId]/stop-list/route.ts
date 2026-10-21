import { handler, requireSession } from '@/server/http/route';
import { setStop } from '@/server/ops/pos';

type P = { orgId: string };

export const POST = handler<P>(async (c) => setStop(requireSession(c).user.id, c.params.orgId, await c.body()));
