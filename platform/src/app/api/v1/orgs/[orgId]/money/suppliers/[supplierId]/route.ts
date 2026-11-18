import { handler, requireSession } from '@/server/http/route';
import { supplierLedger } from '@/server/ops/money';

type P = { orgId: string; supplierId: string };
/** Карточка расчётов с поставщиком: накладные, оплаты, возвраты и корректировки. */
export const GET = handler<P>(async (c) => supplierLedger(requireSession(c).user.id, c.params.orgId, c.params.supplierId));
