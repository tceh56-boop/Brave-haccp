import { handler, requireSession } from '@/server/http/route';
import { submitVersion, returnVersion, approveVersion } from '@/server/ops/recipes';
import { Errors } from '@/server/http/errors';

type P = { orgId: string; versionId: string; op: string };

export const POST = handler<P>(async (c) => {
  const u = requireSession(c).user.id, { orgId, versionId, op } = c.params;
  if (op === 'submit') return submitVersion(u, orgId, versionId);
  if (op === 'approve') return approveVersion(u, orgId, versionId);
  if (op === 'return') return returnVersion(u, orgId, versionId, await c.body());
  throw Errors.notFound();
});
