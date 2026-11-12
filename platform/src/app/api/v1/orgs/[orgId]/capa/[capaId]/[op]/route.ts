import { handler, requireSession } from '@/server/http/route';
import { completeCapa, verifyCapa } from '@/server/ops/capa';
import { Errors } from '@/server/http/errors';

type P = { orgId: string; capaId: string; op: string };

const OPS = { complete: completeCapa, verify: verifyCapa } as const;

export const POST = handler<P>(async (c) => {
  const fn = OPS[c.params.op as keyof typeof OPS];
  if (!fn) throw Errors.notFound();
  return fn(requireSession(c).user.id, c.params.orgId, c.params.capaId, await c.body());
});
