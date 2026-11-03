import { handler, requireSession } from '@/server/http/route';
import { listLaboratories, saveLaboratory } from '@/server/ops/lab';

type P = { orgId: string };

export const GET = handler<P>(async (c) => listLaboratories(requireSession(c).user.id, c.params.orgId));
export const POST = handler<P>(async (c) => saveLaboratory(requireSession(c).user.id, c.params.orgId, null, await c.body()));
