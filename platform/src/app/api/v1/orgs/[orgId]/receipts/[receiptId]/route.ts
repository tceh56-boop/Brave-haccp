import { handler, requireSession } from '@/server/http/route';
import { getReceipt } from '@/server/ops/receipts';

type P = { orgId: string; receiptId: string };

export const GET = handler<P>(async (c) => getReceipt(requireSession(c).user.id, c.params.orgId, c.params.receiptId));
