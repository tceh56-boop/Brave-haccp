import { handler, requireSession } from '@/server/http/route';
import { getStoVersion } from '@/server/ops/sto';

type P = { orgId: string; stoId: string; version: string };

export const GET = handler<P>(async (c) => getStoVersion(requireSession(c).user.id, c.params.orgId, c.params.stoId, Number(c.params.version)));
