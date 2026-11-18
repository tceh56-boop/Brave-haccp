import { handler, requireSession } from '@/server/http/route';
import { listSupplierBalances } from '@/server/ops/money';

type P = { orgId: string };
/** Долги поставщикам на сегодня. */
export const GET = handler<P>(async (c) => listSupplierBalances(requireSession(c).user.id, c.params.orgId));
