import { handler, requireSession } from '@/server/http/route';
import { setItem } from '@/server/ops/planmenu';

type P = { orgId: string; id: string };

export const POST = handler<P>(async (c) => setItem(requireSession(c).user.id, c.params.orgId, c.params.id, await c.body()));
