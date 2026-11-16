import { handler, requireSession } from '@/server/http/route';
import { listTasks } from '@/server/ops/tasks';

type P = { orgId: string };

export const GET = handler<P>(async (c) => listTasks(requireSession(c).user.id, c.params.orgId, { siteId: c.req.nextUrl.searchParams.get('siteId'), all: c.req.nextUrl.searchParams.get('all') === '1' }));
