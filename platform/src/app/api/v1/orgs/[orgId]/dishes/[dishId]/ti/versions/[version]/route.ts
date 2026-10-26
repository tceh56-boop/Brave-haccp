import { handler, requireSession } from '@/server/http/route';
import { getTiVersion } from '@/server/ops/techinstr';

type P = { orgId: string; dishId: string; version: string };

export const GET = handler<P>(async (c) => getTiVersion(requireSession(c).user.id, c.params.orgId, c.params.dishId, Number(c.params.version)));
