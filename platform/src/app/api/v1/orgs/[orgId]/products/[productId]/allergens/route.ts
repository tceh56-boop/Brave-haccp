import { handler, requireSession } from '@/server/http/route';
import { setProductAllergens } from '@/server/ops/techspec';

type P = { orgId: string; productId: string };

export const POST = handler<P>(async (c) => setProductAllergens(requireSession(c).user.id, c.params.orgId, c.params.productId, await c.body()));
