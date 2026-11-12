import { handler, requireSession } from '@/server/http/route';
import { listProducts, createProduct } from '@/server/ops/catalog';

type P = { orgId: string };

export const GET = handler<P>(async (c) => listProducts(requireSession(c).user.id, c.params.orgId, c.req.nextUrl.searchParams.get('q')));
export const POST = handler<P>(async (c) => createProduct(requireSession(c).user.id, c.params.orgId, await c.body()));
