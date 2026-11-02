import { handler, requireSession } from '@/server/http/route';
import { acceptDeclaration } from '@/server/ops/declarations';

type P = { orgId: string; id: string };

export const POST = handler<P>(async (c) => acceptDeclaration(requireSession(c).user.id, c.params.orgId, c.params.id));
