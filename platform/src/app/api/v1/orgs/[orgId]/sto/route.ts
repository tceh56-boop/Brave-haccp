import { handler, requireSession } from '@/server/http/route';
import { listSto, createSto } from '@/server/ops/sto';

type P = { orgId: string };

export const GET = handler<P>(async (c) => listSto(requireSession(c).user.id, c.params.orgId));
export const POST = handler<P>(async (c) => createSto(requireSession(c).user.id, c.params.orgId, await c.body()));
