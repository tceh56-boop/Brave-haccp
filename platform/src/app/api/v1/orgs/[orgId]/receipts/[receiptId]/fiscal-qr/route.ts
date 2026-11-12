import { handler, requireSession } from '@/server/http/route';
import { attachFiscalQr, listFiscalQr } from '@/server/ops/integrations';

type P = { orgId: string; receiptId: string };

export const GET = handler<P>(async (c) => listFiscalQr(requireSession(c).user.id, c.params.orgId, c.params.receiptId));
export const POST = handler<P>(async (c) => attachFiscalQr(requireSession(c).user.id, c.params.orgId, c.params.receiptId, await c.body()));
