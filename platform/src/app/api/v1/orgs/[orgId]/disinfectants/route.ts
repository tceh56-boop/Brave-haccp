import { handler, requireSession } from '@/server/http/route';
import { createDisinfectant } from '@/server/ops/sanitation';

type P = { orgId: string };

export const POST = handler<P>(async (c) => createDisinfectant(requireSession(c).user.id, c.params.orgId, await c.body()));
