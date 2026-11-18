import { handler, requireSession } from '@/server/http/route';
import { listEventPayments, addEventPayment } from '@/server/ops/money';

type P = { orgId: string; id: string };
/** Оплаты мероприятия: предоплата, доплата, возврат; остаток к оплате. */
export const GET = handler<P>(async (c) => listEventPayments(requireSession(c).user.id, c.params.orgId, c.params.id));
export const POST = handler<P>(async (c) => addEventPayment(requireSession(c).user.id, c.params.orgId, c.params.id, await c.body()));
