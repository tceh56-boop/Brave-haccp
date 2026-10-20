import { handler, requireSession } from '@/server/http/route';
import { regulatoryProfile } from '@/server/ops/regulatory';

type P = { orgId: string };

export const GET = handler<P>(async (c) => regulatoryProfile(requireSession(c).user.id, c.params.orgId));
