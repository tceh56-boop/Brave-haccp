import { handler, requireSession } from '@/server/http/route';
import { approveVersion } from '@/server/ops/regulatory';

type P = { orgId: string; versionId: string };

export const POST = handler<P>(async (c) => approveVersion(requireSession(c).user.id, c.params.orgId, c.params.versionId));
