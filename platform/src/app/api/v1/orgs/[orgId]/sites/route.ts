import { handler, requireSession } from '@/server/http/route';
import { listSites, createSite } from '@/server/org/organizations';

type P = { orgId: string };
export const GET = handler<P>(async (c) => listSites(requireSession(c).user.id, c.params.orgId));
export const POST = handler<P>(async (c) => createSite(requireSession(c).user.id, c.params.orgId, await c.body()));
