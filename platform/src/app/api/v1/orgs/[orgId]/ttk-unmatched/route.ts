import { handler, requireSession } from '@/server/http/route';
import { unmatchedNames } from '@/server/ops/recipes';

type P = { orgId: string };

export const GET = handler<P>(async (c) => unmatchedNames(requireSession(c).user.id, c.params.orgId));
