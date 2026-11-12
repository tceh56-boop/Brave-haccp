import { handler, requireSession } from '@/server/http/route';
import { acknowledgeBriefing } from '@/server/ops/staff';

type P = { orgId: string; id: string };

export const POST = handler<P>(async (c) => acknowledgeBriefing(requireSession(c).user.id, c.params.orgId, c.params.id));
