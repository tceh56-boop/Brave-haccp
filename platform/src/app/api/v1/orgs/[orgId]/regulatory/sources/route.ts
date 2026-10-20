import { handler, requireSession } from '@/server/http/route';
import { listSources, createSource } from '@/server/ops/regulatory';

type P = { orgId: string };

export const GET = handler<P>(async (c) => listSources(requireSession(c).user.id, c.params.orgId));
export const POST = handler<P>(async (c) => createSource(requireSession(c).user.id, c.params.orgId, await c.body()));
