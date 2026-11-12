import { handler, requireSession } from '@/server/http/route';
import { Errors } from '@/server/http/errors';
import { approveDisinfectant, archiveDisinfectant } from '@/server/ops/sanitation';

type P = { orgId: string; id: string; step: string };

export const POST = handler<P>(async (c) => {
  const uid = requireSession(c).user.id, { orgId, id, step } = c.params;
  if (step === 'approve') return approveDisinfectant(uid, orgId, id);
  if (step === 'archive') return archiveDisinfectant(uid, orgId, id);
  throw Errors.notFound();
});
