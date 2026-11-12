import { handler, requireSession } from '@/server/http/route';
import { acceptInvitation } from '@/server/org/organizations';

export const POST = handler(async (c) => acceptInvitation(requireSession(c).user, ((await c.body()) as { token?: unknown })?.token));
