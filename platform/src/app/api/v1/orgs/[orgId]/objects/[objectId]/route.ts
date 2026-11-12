import { handler, requireSession } from '@/server/http/route';
import { getControlObject } from '@/server/ops/control';

type P = { orgId: string; objectId: string };

export const GET = handler<P>(async (c) => getControlObject(requireSession(c).user.id, c.params.orgId, c.params.objectId));
