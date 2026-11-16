import { handler, requireSession } from '@/server/http/route';
import { setOpenedShelfLife } from '@/server/ops/labels';

type P = { orgId: string; productId: string };

export const POST = handler<P>(async (c) => setOpenedShelfLife(requireSession(c).user.id, c.params.orgId, c.params.productId, await c.body()));
