import { handler, requireSession } from '@/server/http/route';
import { updateSite } from '@/server/org/organizations';

type P = { orgId: string; siteId: string };
export const PATCH = handler<P>(async (c) => updateSite(requireSession(c).user.id, c.params.orgId, c.params.siteId, await c.body()));
