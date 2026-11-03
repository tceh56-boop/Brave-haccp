import { handler, requireSession } from '@/server/http/route';
import { getRun } from '@/server/ops/checklists';

type P = { orgId: string; runId: string };

export const GET = handler<P>(async (c) => getRun(requireSession(c).user.id, c.params.orgId, c.params.runId));
