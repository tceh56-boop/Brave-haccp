import { handler, requireSession } from '@/server/http/route';
import { supplierCorrection } from '@/server/ops/money';

type P = { orgId: string };
export const POST = handler<P>(async (c) => supplierCorrection(requireSession(c).user.id, c.params.orgId, await c.body()));
