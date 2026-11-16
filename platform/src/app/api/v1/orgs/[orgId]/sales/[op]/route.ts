import { handler, requireSession } from '@/server/http/route';
import { importSales, mapSaleName, salesQueue, retryQueue } from '@/server/ops/pos';
import { Errors } from '@/server/http/errors';

type P = { orgId: string; op: string };

export const GET = handler<P>(async (c) => {
  if (c.params.op !== 'queue') throw Errors.notFound();
  return salesQueue(requireSession(c).user.id, c.params.orgId, c.req.nextUrl.searchParams.get('siteId'));
});
export const POST = handler<P>(async (c) => {
  const u = requireSession(c).user.id, o = c.params.orgId;
  if (c.params.op === 'import') return importSales(u, o, await c.body());
  if (c.params.op === 'map') return mapSaleName(u, o, await c.body());
  if (c.params.op === 'retry') return retryQueue(u, o, await c.body());
  throw Errors.notFound();
});
