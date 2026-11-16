import { handler, requireSession } from '@/server/http/route';
import { Errors } from '@/server/http/errors';
import { recordItem, closeRun } from '@/server/ops/checklists';

type P = { orgId: string; runId: string; op: string };

export const POST = handler<P>(async (c) => {
  const uid = requireSession(c).user.id, { orgId, runId, op } = c.params;
  if (op === 'item') return recordItem(uid, orgId, runId, await c.body());
  if (op === 'close') return closeRun(uid, orgId, runId);
  throw Errors.notFound();
});
