import { handler, requireSession } from '@/server/http/route';
import { addReceiptLine } from '@/server/ops/receipts';

type P = { orgId: string; receiptId: string };

export const POST = handler<P>(async (c) => addReceiptLine(requireSession(c).user.id, c.params.orgId, c.params.receiptId, await c.body()));
