import { handler, requireSession } from '@/server/http/route';
import { rememberAlias } from '@/server/ops/recognition';

type P = { orgId: string };

export const POST = handler<P>(async (c) => rememberAlias(requireSession(c).user.id, c.params.orgId, await c.body()));
