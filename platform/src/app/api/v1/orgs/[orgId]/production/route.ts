import { handler, requireSession } from '@/server/http/route';
import { listProduction, createProduction } from '@/server/ops/production';

type P = { orgId: string };

export const GET = handler<P>(async (c) => {
  const q = c.req.nextUrl.searchParams;
  return listProduction(requireSession(c).user.id, c.params.orgId, q.get('siteId') || '', q.get('date'));
});
export const POST = handler<P>(async (c) => createProduction(requireSession(c).user.id, c.params.orgId, await c.body()));
