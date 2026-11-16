import { handler, requireSession } from '@/server/http/route';
import { getDeclaration, updateDeclaration } from '@/server/ops/declarations';

type P = { orgId: string; id: string };

export const GET = handler<P>(async (c) => getDeclaration(requireSession(c).user.id, c.params.orgId, c.params.id));
export const PATCH = handler<P>(async (c) => updateDeclaration(requireSession(c).user.id, c.params.orgId, c.params.id, await c.body()));
