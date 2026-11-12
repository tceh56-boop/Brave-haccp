import { handler, requireSession } from '@/server/http/route';
import { createControlObject } from '@/server/ops/control';

type P = { orgId: string };

export const POST = handler<P>(async (c) => createControlObject(requireSession(c).user.id, c.params.orgId, await c.body()));
