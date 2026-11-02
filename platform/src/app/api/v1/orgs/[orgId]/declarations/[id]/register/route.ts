import { handler, requireSession } from '@/server/http/route';
import { registerDeclaration } from '@/server/ops/declarations';

type P = { orgId: string; id: string };

export const POST = handler<P>(async (c) => registerDeclaration(requireSession(c).user.id, c.params.orgId, c.params.id, await c.body()));
