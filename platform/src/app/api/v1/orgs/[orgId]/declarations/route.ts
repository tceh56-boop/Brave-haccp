import { handler, requireSession } from '@/server/http/route';
import { listDeclarations, createDeclaration } from '@/server/ops/declarations';

type P = { orgId: string };

export const GET = handler<P>(async (c) => listDeclarations(requireSession(c).user.id, c.params.orgId));
export const POST = handler<P>(async (c) => createDeclaration(requireSession(c).user.id, c.params.orgId, await c.body()));
