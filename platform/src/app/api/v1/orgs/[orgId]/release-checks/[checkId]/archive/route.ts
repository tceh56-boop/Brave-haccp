import { handler, requireSession } from '@/server/http/route';
import { archiveReleaseCheck } from '@/server/ops/production';

type P = { orgId: string; checkId: string };

export const POST = handler<P>(async (c) => archiveReleaseCheck(requireSession(c).user.id, c.params.orgId, c.params.checkId, await c.body()));
