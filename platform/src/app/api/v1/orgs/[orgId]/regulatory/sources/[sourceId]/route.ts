import { handler, requireSession } from '@/server/http/route';
import { getSource } from '@/server/ops/regulatory';

type P = { orgId: string; sourceId: string };

export const GET = handler<P>(async (c) => getSource(requireSession(c).user.id, c.params.orgId, c.params.sourceId));
