import { handler, requireSession } from '@/server/http/route';
import { completeReceipt } from '@/server/ops/receipts';

type P = { orgId: string; receiptId: string };

export const POST = handler<P>(async (c) => completeReceipt(requireSession(c).user.id, c.params.orgId, c.params.receiptId));
