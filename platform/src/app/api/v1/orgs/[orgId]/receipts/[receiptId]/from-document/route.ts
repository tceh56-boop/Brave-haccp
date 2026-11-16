import { handler, requireSession } from '@/server/http/route';
import { acceptFromDocument, receiptDocument } from '@/server/ops/receipts';

type P = { orgId: string; receiptId: string };

export const GET = handler<P>(async (c) => receiptDocument(requireSession(c).user.id, c.params.orgId, c.params.receiptId));
/** Принять строки распознанной накладной одним действием (проверки — для всей поставки). */
export const POST = handler<P>(async (c) => acceptFromDocument(requireSession(c).user.id, c.params.orgId, c.params.receiptId, await c.body()));
