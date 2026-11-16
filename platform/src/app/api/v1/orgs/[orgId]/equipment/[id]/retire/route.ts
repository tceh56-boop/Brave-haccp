import { handler, requireSession } from '@/server/http/route';
import { retireEquipment } from '@/server/ops/equipment';

type P = { orgId: string; id: string };

export const POST = handler<P>(async (c) => retireEquipment(requireSession(c).user.id, c.params.orgId, c.params.id, await c.body()));
