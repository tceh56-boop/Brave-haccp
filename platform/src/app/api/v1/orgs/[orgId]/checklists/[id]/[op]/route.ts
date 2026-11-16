import { handler, requireSession } from '@/server/http/route';
import { Errors } from '@/server/http/errors';
import { approveChecklist, startRun } from '@/server/ops/checklists';

type P = { orgId: string; id: string; op: string };

export const POST = handler<P>(async (c) => {
  const uid = requireSession(c).user.id, { orgId, id, op } = c.params;
  if (op === 'approve') return approveChecklist(uid, orgId, id);
  if (op === 'run') return startRun(uid, orgId, id);
  throw Errors.notFound();
});
