import { handler, requireSession } from '@/server/http/route';
import { listNotifications, markNotificationsRead } from '@/server/ops/dashboard';

type P = { orgId: string };

export const GET = handler<P>(async (c) => listNotifications(requireSession(c).user.id, c.params.orgId));
export const POST = handler<P>(async (c) => markNotificationsRead(requireSession(c).user.id, c.params.orgId, (((await c.body()) as { ids?: string[] })?.ids || []).filter((x) => typeof x === 'string')));
