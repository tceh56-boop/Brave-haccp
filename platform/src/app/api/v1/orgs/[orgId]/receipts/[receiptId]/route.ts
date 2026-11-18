import { handler, requireSession } from '@/server/http/route';
import { getReceipt, updateReceiptTerms } from '@/server/ops/receipts';

type P = { orgId: string; receiptId: string };

export const GET = handler<P>(async (c) => getReceipt(requireSession(c).user.id, c.params.orgId, c.params.receiptId));
/** Реквизиты и деньги черновика накладной: цены с НДС / без, итог документа, доп. расходы, причина расхождения. */
export const PATCH = handler<P>(async (c) => updateReceiptTerms(requireSession(c).user.id, c.params.orgId, c.params.receiptId, await c.body()));
