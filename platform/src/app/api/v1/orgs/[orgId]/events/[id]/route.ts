import { handler, requireSession } from '@/server/http/route';
import { getEvent, updateEvent } from '@/server/ops/planmenu';

type P = { orgId: string; id: string };

export const GET = handler<P>(async (c) => getEvent(requireSession(c).user.id, c.params.orgId, c.params.id));
export const PATCH = handler<P>(async (c) => updateEvent(requireSession(c).user.id, c.params.orgId, c.params.id, await c.body()));
