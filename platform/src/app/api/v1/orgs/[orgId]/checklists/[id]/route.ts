import { handler, requireSession } from '@/server/http/route';
import { getChecklist } from '@/server/ops/checklists';

type P = { orgId: string; id: string };

export const GET = handler<P>(async (c) => getChecklist(requireSession(c).user.id, c.params.orgId, c.params.id));
