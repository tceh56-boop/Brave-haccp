import { handler, requireSession } from '@/server/http/route';
import { removeItem } from '@/server/ops/planmenu';

type P = { orgId: string; id: string; dishId: string };

export const DELETE = handler<P>(async (c) => removeItem(requireSession(c).user.id, c.params.orgId, c.params.id, c.params.dishId));
