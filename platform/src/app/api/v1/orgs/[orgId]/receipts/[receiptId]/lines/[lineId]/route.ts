import { handler, requireSession } from '@/server/http/route';
import { removeReceiptLine } from '@/server/ops/receipts';

type P = { orgId: string; receiptId: string; lineId: string };

export const DELETE = handler<P>(async (c) => removeReceiptLine(requireSession(c).user.id, c.params.orgId, c.params.receiptId, c.params.lineId));
