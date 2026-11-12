import { handler, requireSession } from '@/server/http/route';
import { updateAgent } from '@/server/ops/disinfectants';

type P = { orgId: string; id: string };

export const PATCH = handler<P>(async (c) => updateAgent(requireSession(c).user.id, c.params.orgId, c.params.id, await c.body()));
