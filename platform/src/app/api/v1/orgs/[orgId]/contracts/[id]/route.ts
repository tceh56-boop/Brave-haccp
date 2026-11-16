import { handler, requireSession } from '@/server/http/route';
import { getContract, updateContract } from '@/server/ops/contracts';

type P = { orgId: string; id: string };

export const GET = handler<P>(async (c) => getContract(requireSession(c).user.id, c.params.orgId, c.params.id));
export const PATCH = handler<P>(async (c) => updateContract(requireSession(c).user.id, c.params.orgId, c.params.id, await c.body()));
