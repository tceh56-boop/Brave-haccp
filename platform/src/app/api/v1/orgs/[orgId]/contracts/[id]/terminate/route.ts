import { handler, requireSession } from '@/server/http/route';
import { terminateContract } from '@/server/ops/contracts';

type P = { orgId: string; id: string };

export const POST = handler<P>(async (c) => terminateContract(requireSession(c).user.id, c.params.orgId, c.params.id, await c.body()));
