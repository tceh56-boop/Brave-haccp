import { handler, requireSession } from '@/server/http/route';
import { adoptSbornik, sbornikMatches } from '@/server/ops/sbornik';

type P = { orgId: string };

export const GET = handler<P>(async (c) => sbornikMatches(requireSession(c).user.id, c.params.orgId));
export const POST = handler<P>(async (c) => adoptSbornik(requireSession(c).user.id, c.params.orgId, await c.body()));
