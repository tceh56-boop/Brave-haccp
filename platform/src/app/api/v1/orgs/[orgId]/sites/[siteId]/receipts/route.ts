import { handler, requireSession } from '@/server/http/route';
import { listReceipts } from '@/server/ops/receipts';

type P = { orgId: string; siteId: string };

export const GET = handler<P>(async (c) => listReceipts(requireSession(c).user.id, c.params.orgId, c.params.siteId));
