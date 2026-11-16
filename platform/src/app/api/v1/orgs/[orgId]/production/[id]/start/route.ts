import { handler, requireSession } from '@/server/http/route';
import { startProduction } from '@/server/ops/production';

type P = { orgId: string; id: string };

export const POST = handler<P>(async (c) => startProduction(requireSession(c).user.id, c.params.orgId, c.params.id));
