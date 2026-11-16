import { handler, requireSession } from '@/server/http/route';
import { listOrders, createOrder } from '@/server/ops/purchasing';

type P = { orgId: string };

export const GET = handler<P>(async (c) => listOrders(requireSession(c).user.id, c.params.orgId, c.req.nextUrl.searchParams.get('siteId') || ''));
export const POST = handler<P>(async (c) => createOrder(requireSession(c).user.id, c.params.orgId, await c.body()));
