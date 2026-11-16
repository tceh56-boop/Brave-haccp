import { handler, requireSession } from '@/server/http/route';
import { approveNorm, archiveNorm, setNormDefault, applyNormToDrafts } from '@/server/ops/processing';
import { Errors } from '@/server/http/errors';

type P = { orgId: string; normId: string; op: string };

export const POST = handler<P>(async (c) => {
  const u = requireSession(c).user.id, { orgId, normId, op } = c.params;
  if (op === 'approve') return approveNorm(u, orgId, normId);
  if (op === 'archive') return archiveNorm(u, orgId, normId, await c.body());
  if (op === 'default') return setNormDefault(u, orgId, normId, await c.body());
  if (op === 'apply-drafts') return applyNormToDrafts(u, orgId, normId);
  throw Errors.notFound();
});
