import { handler, requirePasswordSession } from '@/server/http/route';
import { resetPin } from '@/server/identity/kiosk';

type P = { orgId: string; userId: string };

export const POST = handler<P>(async (c) => resetPin(requirePasswordSession(c).user.id, c.params.orgId, c.params.userId));
