import { handler, requireSession } from '@/server/http/route';
import { paySupplier } from '@/server/ops/money';

type P = { orgId: string };
export const POST = handler<P>(async (c) => paySupplier(requireSession(c).user.id, c.params.orgId, await c.body()));
