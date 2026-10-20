import { handler, requireSession } from '@/server/http/route';
import { getIncident } from '@/server/ops/incidents';

type P = { orgId: string; incidentId: string };

export const GET = handler<P>(async (c) => getIncident(requireSession(c).user.id, c.params.orgId, c.params.incidentId));
