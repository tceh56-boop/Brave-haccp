import { handler, requireSession } from '@/server/http/route';
import { setStaffSettings } from '@/server/ops/staff';

type P = { orgId: string };

export const POST = handler<P>(async (c) => setStaffSettings(requireSession(c).user.id, c.params.orgId, await c.body()));
