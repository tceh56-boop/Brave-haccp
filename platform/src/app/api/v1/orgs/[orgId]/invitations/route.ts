import { handler, requireSession } from '@/server/http/route';
import { listInvitations, inviteMember } from '@/server/org/organizations';

type P = { orgId: string };
export const GET = handler<P>(async (c) => listInvitations(requireSession(c).user.id, c.params.orgId));
export const POST = handler<P>(async (c) => inviteMember(requireSession(c).user.id, c.params.orgId, await c.body()));
