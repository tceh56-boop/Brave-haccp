import { handler, requireSession } from '@/server/http/route';
import { setIntegrationEnabled } from '@/server/ops/integrations';

type P = { orgId: string; system: string };

export const POST = handler<P>(async (c) => {
  const b = (await c.body()) as { enabled?: boolean } | null;
  return setIntegrationEnabled(requireSession(c).user.id, c.params.orgId, c.params.system, !!b?.enabled);
});
