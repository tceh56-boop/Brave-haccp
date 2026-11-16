import { handler, requireSession } from '@/server/http/route';
import { logPrint } from '@/server/ops/labels';

type P = { orgId: string };

export const POST = handler<P>(async (c) => logPrint(requireSession(c).user.id, c.params.orgId, await c.body()));
