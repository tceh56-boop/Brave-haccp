import { handler, requireSession } from '@/server/http/route';
import { verifyAudit } from '@/server/org/organizations';

type P = { orgId: string };
export const GET = handler<P>(async (c) => verifyAudit(requireSession(c).user.id, c.params.orgId));
