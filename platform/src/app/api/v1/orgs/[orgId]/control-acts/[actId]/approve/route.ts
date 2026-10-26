import { handler, requireSession } from '@/server/http/route';
import { approveAct } from '@/server/ops/controlacts';

type P = { orgId: string; actId: string };

export const POST = handler<P>(async (c) => approveAct(requireSession(c).user.id, c.params.orgId, c.params.actId));
