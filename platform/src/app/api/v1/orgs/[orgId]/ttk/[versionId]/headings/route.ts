import { handler, requireSession } from '@/server/http/route';
import { addHeading } from '@/server/ops/recipes';

type P = { orgId: string; versionId: string };

export const POST = handler<P>(async (c) => addHeading(requireSession(c).user.id, c.params.orgId, c.params.versionId, await c.body()));
