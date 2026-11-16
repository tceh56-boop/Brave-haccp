import { handler, requireSession } from '@/server/http/route';
import { addHazard } from '@/server/ops/haccp';

type P = { orgId: string; planId: string };

export const POST = handler<P>(async (c) => addHazard(requireSession(c).user.id, c.params.orgId, c.params.planId, await c.body()));
