import { handler, requireSession } from '@/server/http/route';
import { recordMeasurement } from '@/server/ops/measurements';

type P = { orgId: string };

export const POST = handler<P>(async (c) => recordMeasurement(requireSession(c).user.id, c.params.orgId, await c.body()));
