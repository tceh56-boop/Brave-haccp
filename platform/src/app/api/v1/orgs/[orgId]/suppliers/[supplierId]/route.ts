import { handler, requireSession } from '@/server/http/route';
import { updateSupplier } from '@/server/ops/purchasing';

type P = { orgId: string; supplierId: string };

export const PATCH = handler<P>(async (c) => updateSupplier(requireSession(c).user.id, c.params.orgId, c.params.supplierId, await c.body()));
