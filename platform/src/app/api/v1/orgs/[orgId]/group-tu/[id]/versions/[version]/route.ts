import { handler, requireSession } from '@/server/http/route';
import { getGroupTechSpecVersion } from '@/server/ops/groupTechSpec';

type P = { orgId: string; id: string; version: string };

export const GET = handler<P>(async (c) => getGroupTechSpecVersion(requireSession(c).user.id, c.params.orgId, c.params.id, Number(c.params.version)));
