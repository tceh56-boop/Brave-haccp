import { handler, requireSession } from '@/server/http/route';
import { approveSto } from '@/server/ops/sto';

type P = { orgId: string; stoId: string };

export const POST = handler<P>(async (c) => approveSto(requireSession(c).user.id, c.params.orgId, c.params.stoId, await c.body()));
