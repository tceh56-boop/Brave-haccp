import { handler, requireSession } from '@/server/http/route';
import { correctEntry } from '@/server/ops/journals';

type P = { orgId: string; entryId: string };

export const POST = handler<P>(async (c) => correctEntry(requireSession(c).user.id, c.params.orgId, c.params.entryId, await c.body()));
