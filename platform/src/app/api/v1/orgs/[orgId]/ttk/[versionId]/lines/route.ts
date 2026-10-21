import { handler, requireSession } from '@/server/http/route';
import { addLine } from '@/server/ops/recipes';

type P = { orgId: string; versionId: string };

export const POST = handler<P>(async (c) => addLine(requireSession(c).user.id, c.params.orgId, c.params.versionId, await c.body()));
