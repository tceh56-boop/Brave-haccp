import { handler, requireSession } from '@/server/http/route';
import { importFromArchive } from '@/server/ops/recipes';

type P = { orgId: string };

export const POST = handler<P>(async (c) => importFromArchive(requireSession(c).user.id, c.params.orgId, await c.body()));
