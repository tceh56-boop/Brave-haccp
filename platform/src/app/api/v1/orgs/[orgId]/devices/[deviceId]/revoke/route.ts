import { handler, requirePasswordSession } from '@/server/http/route';
import { revokeDevice } from '@/server/identity/kiosk';

type P = { orgId: string; deviceId: string };

export const POST = handler<P>(async (c) => revokeDevice(requirePasswordSession(c).user.id, c.params.orgId, c.params.deviceId));
