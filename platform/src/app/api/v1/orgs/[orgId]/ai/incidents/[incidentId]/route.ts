import { handler, requireSession } from '@/server/http/route';
import { explainIncident } from '@/server/ops/ai';

type P = { orgId: string; incidentId: string };

export const POST = handler<P>(async (c) => explainIncident(requireSession(c).user.id, c.params.orgId, c.params.incidentId));
