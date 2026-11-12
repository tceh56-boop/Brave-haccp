import { handler, requireSession } from '@/server/http/route';
import { listSuppliers, createSupplier } from '@/server/ops/catalog';

type P = { orgId: string };

export const GET = handler<P>(async (c) => listSuppliers(requireSession(c).user.id, c.params.orgId));
export const POST = handler<P>(async (c) => createSupplier(requireSession(c).user.id, c.params.orgId, await c.body()));
