import { handler, requireSession, requirePasswordSession } from '@/server/http/route';
import { myPinState, setMyPin } from '@/server/identity/kiosk';

type P = { orgId: string };

export const GET = handler<P>(async (c) => myPinState(requireSession(c).user.id, c.params.orgId));
export const PUT = handler<P>(async (c) => setMyPin(requirePasswordSession(c).user.id, c.params.orgId, await c.body()));
