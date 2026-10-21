import { handler, requireSession } from '@/server/http/route';
import { listEquipment, createEquipment } from '@/server/ops/equipment';

type P = { orgId: string };

export const GET = handler<P>(async (c) => listEquipment(requireSession(c).user.id, c.params.orgId, c.req.nextUrl.searchParams.get('siteId') || ''));
export const POST = handler<P>(async (c) => createEquipment(requireSession(c).user.id, c.params.orgId, await c.body()));
