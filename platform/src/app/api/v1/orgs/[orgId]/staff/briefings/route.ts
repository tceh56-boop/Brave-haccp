import { handler, requireSession } from '@/server/http/route';
import { recordBriefing } from '@/server/ops/staff';

type P = { orgId: string };

export const POST = handler<P>(async (c) => recordBriefing(requireSession(c).user.id, c.params.orgId, await c.body()));
