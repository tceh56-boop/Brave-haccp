import { handler, requireSession } from '@/server/http/route';
import { markChecked } from '@/server/ops/regulatory';

type P = { orgId: string; versionId: string };

export const POST = handler<P>(async (c) => markChecked(requireSession(c).user.id, c.params.orgId, c.params.versionId, await c.body()));
