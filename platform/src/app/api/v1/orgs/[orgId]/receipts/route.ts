import { handler, requireSession } from '@/server/http/route';
import { createReceipt } from '@/server/ops/receipts';

type P = { orgId: string };

export const POST = handler<P>(async (c) => createReceipt(requireSession(c).user.id, c.params.orgId, await c.body()));
