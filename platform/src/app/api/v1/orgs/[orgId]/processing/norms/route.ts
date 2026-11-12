import { handler, requireSession } from '@/server/http/route';
import { listNorms, createNorm } from '@/server/ops/processing';

type P = { orgId: string };

export const GET = handler<P>(async (c) => {
  const q = c.req.nextUrl.searchParams;
  return listNorms(requireSession(c).user.id, c.params.orgId, { productId: q.get('productId'), archived: q.get('archived') === '1' });
});
export const POST = handler<P>(async (c) => createNorm(requireSession(c).user.id, c.params.orgId, await c.body()));
