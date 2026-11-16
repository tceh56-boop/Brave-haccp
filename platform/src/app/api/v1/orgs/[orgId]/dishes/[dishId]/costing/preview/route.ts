import { handler, requireSession } from '@/server/http/route';
import { previewCosting } from '@/server/ops/costing';

type P = { orgId: string; dishId: string };

export const GET = handler<P>(async (c) => previewCosting(requireSession(c).user.id, c.params.orgId, c.params.dishId));
