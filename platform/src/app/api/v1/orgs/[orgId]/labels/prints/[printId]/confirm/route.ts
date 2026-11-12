import { handler, requireSession } from '@/server/http/route';
import { confirmReprint } from '@/server/ops/labels';

type P = { orgId: string; printId: string };

export const POST = handler<P>(async (c) => confirmReprint(requireSession(c).user.id, c.params.orgId, c.params.printId, await c.body()));
