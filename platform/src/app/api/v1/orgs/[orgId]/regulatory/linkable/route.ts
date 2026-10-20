import { handler, requireSession } from '@/server/http/route';
import { linkableRequirements } from '@/server/ops/regulatory';

type P = { orgId: string };

export const GET = handler<P>(async (c) => linkableRequirements(requireSession(c).user.id, c.params.orgId));
