import { handler, requireSession } from '@/server/http/route';
import { saveIntegration } from '@/server/ops/integrations';

type P = { orgId: string; system: string };

export const PUT = handler<P>(async (c) => saveIntegration(requireSession(c).user.id, c.params.orgId, c.params.system, await c.body()));
