import { handler, requireSession } from '@/server/http/route';
import { takeIncident, recordIncidentAction, confirmIncident, returnIncident } from '@/server/ops/incidents';
import { Errors } from '@/server/http/errors';

type P = { orgId: string; incidentId: string; op: string };

export const POST = handler<P>(async (c) => {
  const u = requireSession(c).user.id, { orgId, incidentId, op } = c.params;
  if (op === 'take') return takeIncident(u, orgId, incidentId);
  if (op === 'action') return recordIncidentAction(u, orgId, incidentId, await c.body());
  if (op === 'confirm') return confirmIncident(u, orgId, incidentId, await c.body());
  if (op === 'return') return returnIncident(u, orgId, incidentId, await c.body());
  throw Errors.notFound();
});
