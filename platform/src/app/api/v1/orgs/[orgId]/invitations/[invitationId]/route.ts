import { handler, requireSession } from '@/server/http/route';
import { revokeInvitation } from '@/server/org/organizations';

type P = { orgId: string; invitationId: string };
export const DELETE = handler<P>(async (c) => revokeInvitation(requireSession(c).user.id, c.params.orgId, c.params.invitationId));
