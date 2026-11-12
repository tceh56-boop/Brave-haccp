import { handler, requireSession } from '@/server/http/route';
import { linkProductToReference } from '@/server/ops/reference';

type P = { orgId: string; productId: string };

export const POST = handler<P>(async (c) => linkProductToReference(requireSession(c).user.id, c.params.orgId, c.params.productId, await c.body()));
