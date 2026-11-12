import { handler, requireSession } from '@/server/http/route';
import { getTechSpecVersion } from '@/server/ops/techspec';

type P = { orgId: string; dishId: string; version: string };

export const GET = handler<P>(async (c) => getTechSpecVersion(requireSession(c).user.id, c.params.orgId, c.params.dishId, Number(c.params.version) || 0));
