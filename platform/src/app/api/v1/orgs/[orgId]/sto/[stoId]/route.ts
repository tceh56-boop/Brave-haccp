import { handler, requireSession } from '@/server/http/route';
import { getSto, updateSto } from '@/server/ops/sto';

type P = { orgId: string; stoId: string };

export const GET = handler<P>(async (c) => getSto(requireSession(c).user.id, c.params.orgId, c.params.stoId));
export const PATCH = handler<P>(async (c) => updateSto(requireSession(c).user.id, c.params.orgId, c.params.stoId, await c.body()));
