import { handler, requireSession } from '@/server/http/route';
import { getTtkDoc } from '@/server/ops/ttkdoc';

type P = { orgId: string; dishId: string };

export const GET = handler<P>(async (c) => getTtkDoc(requireSession(c).user.id, c.params.orgId, c.params.dishId, c.req.nextUrl.searchParams.get('versionId')));
