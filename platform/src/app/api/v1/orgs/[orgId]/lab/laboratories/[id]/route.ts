import { handler, requireSession } from '@/server/http/route';
import { saveLaboratory } from '@/server/ops/lab';

type P = { orgId: string; id: string };

export const PATCH = handler<P>(async (c) => saveLaboratory(requireSession(c).user.id, c.params.orgId, c.params.id, await c.body()));
