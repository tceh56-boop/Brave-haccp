import { handler, requireSession } from '@/server/http/route';
import { setMonitoring } from '@/server/ops/haccp';

type P = { orgId: string; hazardId: string };

export const POST = handler<P>(async (c) => setMonitoring(requireSession(c).user.id, c.params.orgId, c.params.hazardId, await c.body()));
