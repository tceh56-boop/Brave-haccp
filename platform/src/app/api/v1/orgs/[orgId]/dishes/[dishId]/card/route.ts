import { handler, requireSession } from '@/server/http/route';
import { getProductCard } from '@/server/ops/productCard';

type P = { orgId: string; dishId: string };

export const GET = handler<P>(async (c) => getProductCard(requireSession(c).user.id, c.params.orgId, c.params.dishId));
