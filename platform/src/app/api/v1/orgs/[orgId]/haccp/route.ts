import { handler, requireSession } from '@/server/http/route';
import { getPlan, createPlan } from '@/server/ops/haccp';

type P = { orgId: string };

export const GET = handler<P>(async (c) => getPlan(requireSession(c).user.id, c.params.orgId, c.req.nextUrl.searchParams.get('planId')));
export const POST = handler<P>(async (c) => createPlan(requireSession(c).user.id, c.params.orgId, await c.body()));
