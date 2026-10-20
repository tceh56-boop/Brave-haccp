import { handler, requireSession } from '@/server/http/route';
import { getReference } from '@/server/ops/reference';

type P = { orgId: string; referenceId: string };

export const GET = handler<P>(async (c) => getReference(requireSession(c).user.id, c.params.orgId, c.params.referenceId));
