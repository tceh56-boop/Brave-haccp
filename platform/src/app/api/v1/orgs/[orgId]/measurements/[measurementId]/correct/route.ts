import { handler, requireSession } from '@/server/http/route';
import { correctMeasurement } from '@/server/ops/measurements';

type P = { orgId: string; measurementId: string };

export const POST = handler<P>(async (c) => correctMeasurement(requireSession(c).user.id, c.params.orgId, c.params.measurementId, await c.body()));
