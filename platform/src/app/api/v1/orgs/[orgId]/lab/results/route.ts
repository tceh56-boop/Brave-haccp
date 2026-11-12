import { handler, requireSession } from '@/server/http/route';
import { recordResult } from '@/server/ops/lab';

type P = { orgId: string };

export const POST = handler<P>(async (c) => recordResult(requireSession(c).user.id, c.params.orgId, await c.body()));
