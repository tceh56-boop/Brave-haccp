import { handler, requireSession } from '@/server/http/route';
import { lotsBySupplier } from '@/server/ops/stock';

type P = { orgId: string; supplierId: string };

export const GET = handler<P>(async (c) => lotsBySupplier(requireSession(c).user.id, c.params.orgId, c.params.supplierId));
