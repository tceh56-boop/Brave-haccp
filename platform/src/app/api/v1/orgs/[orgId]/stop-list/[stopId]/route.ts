import { handler, requireSession } from '@/server/http/route';
import { liftStop } from '@/server/ops/pos';

type P = { orgId: string; stopId: string };

export const DELETE = handler<P>(async (c) => liftStop(requireSession(c).user.id, c.params.orgId, c.params.stopId));
