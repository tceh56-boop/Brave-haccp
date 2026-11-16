import { handler, requireSession } from '@/server/http/route';
import { listInstruments } from '@/server/ops/equipment';

type P = { orgId: string };

export const GET = handler<P>(async (c) => listInstruments(requireSession(c).user.id, c.params.orgId, c.req.nextUrl.searchParams.get('siteId') || ''));
