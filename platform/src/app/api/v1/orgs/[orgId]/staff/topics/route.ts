import { handler, requireSession } from '@/server/http/route';
import { createTopic } from '@/server/ops/staff';

type P = { orgId: string };

export const POST = handler<P>(async (c) => createTopic(requireSession(c).user.id, c.params.orgId, await c.body()));
