import { handler, requireSession } from '@/server/http/route';
import { listArchive } from '@/server/ops/recipes';

type P = { orgId: string };

export const GET = handler<P>(async (c) => {
  const q = c.req.nextUrl.searchParams;
  return listArchive(requireSession(c).user.id, c.params.orgId, { q: q.get('q'), category: q.get('category') });
});
