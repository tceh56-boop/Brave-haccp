import { handler, requireSession } from '@/server/http/route';
import { createLabels, getLabels } from '@/server/ops/labels';

type P = { orgId: string };

export const GET = handler<P>(async (c) => getLabels(requireSession(c).user.id, c.params.orgId, (c.req.nextUrl.searchParams.get('ids') || '').split(',').filter(Boolean)));
export const POST = handler<P>(async (c) => createLabels(requireSession(c).user.id, c.params.orgId, await c.body()));
