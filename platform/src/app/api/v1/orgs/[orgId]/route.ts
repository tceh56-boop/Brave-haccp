import { handler, requireSession } from '@/server/http/route';
import { getOrganization, updateOrganization } from '@/server/org/organizations';

type P = { orgId: string };
export const GET = handler<P>(async (c) => getOrganization(requireSession(c).user.id, c.params.orgId));
export const PATCH = handler<P>(async (c) => updateOrganization(requireSession(c).user.id, c.params.orgId, await c.body()));
