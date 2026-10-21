import { handler, requireSession } from '@/server/http/route';
import { producibleDishes } from '@/server/ops/production';

type P = { orgId: string };

export const GET = handler<P>(async (c) => producibleDishes(requireSession(c).user.id, c.params.orgId));
