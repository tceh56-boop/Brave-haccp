import { handler, requireSession } from '@/server/http/route';
import { listMethods } from '@/server/ops/processing';

type P = { orgId: string };

export const GET = handler<P>(async (c) => listMethods(requireSession(c).user.id, c.params.orgId));
