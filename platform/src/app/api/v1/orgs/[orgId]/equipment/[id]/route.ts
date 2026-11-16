import { handler, requireSession } from '@/server/http/route';
import { getEquipment, updateEquipment } from '@/server/ops/equipment';

type P = { orgId: string; id: string };

export const GET = handler<P>(async (c) => getEquipment(requireSession(c).user.id, c.params.orgId, c.params.id));
export const PATCH = handler<P>(async (c) => updateEquipment(requireSession(c).user.id, c.params.orgId, c.params.id, await c.body()));
