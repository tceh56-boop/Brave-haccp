import { handler, requireSession } from '@/server/http/route';
import { addRequirement } from '@/server/ops/regulatory';

type P = { orgId: string; versionId: string };

export const POST = handler<P>(async (c) => addRequirement(requireSession(c).user.id, c.params.orgId, c.params.versionId, await c.body()));
