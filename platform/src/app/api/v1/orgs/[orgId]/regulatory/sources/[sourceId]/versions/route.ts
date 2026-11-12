import { handler, requireSession } from '@/server/http/route';
import { addVersion } from '@/server/ops/regulatory';

type P = { orgId: string; sourceId: string };

export const POST = handler<P>(async (c) => addVersion(requireSession(c).user.id, c.params.orgId, c.params.sourceId, await c.body()));
