import { handler, requireSession } from '@/server/http/route';
import { approvePpk } from '@/server/ops/ppk';

type P = { orgId: string };

export const POST = handler<P>(async (c) => approvePpk(requireSession(c).user.id, c.params.orgId, await c.body()));
