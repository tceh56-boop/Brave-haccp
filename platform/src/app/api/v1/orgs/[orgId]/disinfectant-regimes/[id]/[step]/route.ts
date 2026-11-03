import { handler, requireSession } from '@/server/http/route';
import { Errors } from '@/server/http/errors';
import { approveRegime, archiveRegime } from '@/server/ops/disinfectants';

type P = { orgId: string; id: string; step: string };

export const POST = handler<P>(async (c) => {
  const uid = requireSession(c).user.id, { orgId, id, step } = c.params;
  if (step === 'approve') return approveRegime(uid, orgId, id);
  if (step === 'archive') return archiveRegime(uid, orgId, id, await c.body());
  throw Errors.notFound();
});
