import { handler, requireSession } from '@/server/http/route';
import { listCapas, createCapa } from '@/server/ops/capa';

type P = { orgId: string };

export const GET = handler<P>(async (c) => listCapas(requireSession(c).user.id, c.params.orgId, { open: c.req.nextUrl.searchParams.get('open') === '1' }));
export const POST = handler<P>(async (c) => createCapa(requireSession(c).user.id, c.params.orgId, await c.body()));
