import { handler, requireSession } from '@/server/http/route';
import { archiveProgram } from '@/server/ops/lab';

type P = { orgId: string; id: string };

export const POST = handler<P>(async (c) => archiveProgram(requireSession(c).user.id, c.params.orgId, c.params.id, await c.body()));
