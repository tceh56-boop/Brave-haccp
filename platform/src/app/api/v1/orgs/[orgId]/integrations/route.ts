import { handler, requireSession } from '@/server/http/route';
import { listIntegrations } from '@/server/ops/integrations';

type P = { orgId: string };

export const GET = handler<P>(async (c) => listIntegrations(requireSession(c).user.id, c.params.orgId));
