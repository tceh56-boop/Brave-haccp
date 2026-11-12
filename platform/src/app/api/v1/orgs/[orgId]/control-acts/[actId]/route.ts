import { handler, requireSession } from '@/server/http/route';
import { getAct, updateAct, deleteAct } from '@/server/ops/controlacts';

type P = { orgId: string; actId: string };

export const GET = handler<P>(async (c) => getAct(requireSession(c).user.id, c.params.orgId, c.params.actId));
export const PATCH = handler<P>(async (c) => updateAct(requireSession(c).user.id, c.params.orgId, c.params.actId, await c.body()));
export const DELETE = handler<P>(async (c) => deleteAct(requireSession(c).user.id, c.params.orgId, c.params.actId));
