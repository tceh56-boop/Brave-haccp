import { handler, requireSession } from '@/server/http/route';
import { getRequisition } from '@/server/ops/planmenu';

type P = { orgId: string; id: string };

export const GET = handler<P>(async (c) => getRequisition(requireSession(c).user.id, c.params.orgId, c.params.id));
