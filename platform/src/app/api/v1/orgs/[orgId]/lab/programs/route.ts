import { handler, requireSession } from '@/server/http/route';
import { createProgram } from '@/server/ops/lab';

type P = { orgId: string };

export const POST = handler<P>(async (c) => createProgram(requireSession(c).user.id, c.params.orgId, await c.body()));
