import { handler, requireSession } from '@/server/http/route';
import { listMyOrganizations, createOrganization } from '@/server/org/organizations';

export const GET = handler(async (c) => listMyOrganizations(requireSession(c).user.id));
export const POST = handler(async (c) => createOrganization(requireSession(c).user, await c.body()));
