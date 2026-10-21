import { handler, requireSession } from '@/server/http/route';
import { listSamples, takeSample } from '@/server/ops/lab';

type P = { orgId: string };

export const GET = handler<P>(async (c) => listSamples(requireSession(c).user.id, c.params.orgId, c.req.nextUrl.searchParams.get('siteId') || ''));
export const POST = handler<P>(async (c) => takeSample(requireSession(c).user.id, c.params.orgId, await c.body()));
