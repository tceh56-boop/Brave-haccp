import { handler, requireSession } from '@/server/http/route';
import { archiveTopic } from '@/server/ops/staff';

type P = { orgId: string; id: string };

export const POST = handler<P>(async (c) => archiveTopic(requireSession(c).user.id, c.params.orgId, c.params.id));
