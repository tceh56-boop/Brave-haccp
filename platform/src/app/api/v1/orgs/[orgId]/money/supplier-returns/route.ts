import { handler, requireSession } from '@/server/http/route';
import { returnToSupplier } from '@/server/ops/money';

type P = { orgId: string };
/** Возврат товара поставщику: движение по партии и уменьшение долга. */
export const POST = handler<P>(async (c) => returnToSupplier(requireSession(c).user.id, c.params.orgId, await c.body()));
