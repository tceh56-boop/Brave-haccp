import { handler, requireSession } from '@/server/http/route';
import { getProduction } from '@/server/ops/production';

type P = { orgId: string; id: string };

export const GET = handler<P>(async (c) => getProduction(requireSession(c).user.id, c.params.orgId, c.params.id));
