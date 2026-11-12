import { handler, requireSession } from '@/server/http/route';
import { signJournal } from '@/server/ops/journals';

type P = { orgId: string; code: string };

export const POST = handler<P>(async (c) => signJournal(requireSession(c).user.id, c.params.orgId, c.params.code.toUpperCase(), await c.body()));
