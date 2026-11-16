import { handler, requireSession } from '@/server/http/route';
import { createProductFromReference } from '@/server/ops/reference';

type P = { orgId: string };

export const POST = handler<P>(async (c) => createProductFromReference(requireSession(c).user.id, c.params.orgId, await c.body()));
