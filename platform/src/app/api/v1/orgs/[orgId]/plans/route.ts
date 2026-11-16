import { handler, requireSession } from '@/server/http/route';
import { listPlans, createPlan } from '@/server/ops/floorplan';

type P = { orgId: string };

export const GET = handler<P>(async (c) => listPlans(requireSession(c).user.id, c.params.orgId, c.req.nextUrl.searchParams.get('siteId') || ''));
export const POST = handler<P>(async (c) => createPlan(requireSession(c).user.id, c.params.orgId, await c.body()));
