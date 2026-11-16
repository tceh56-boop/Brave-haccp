import { handler, requireSession } from '@/server/http/route';
import { createConsumerLabel, previewConsumerLabel } from '@/server/ops/consumerLabels';

type P = { orgId: string; lotId: string };

export const GET = handler<P>(async (c) => previewConsumerLabel(requireSession(c).user.id, c.params.orgId, c.params.lotId, c.req.nextUrl.searchParams.get('netMassG') || null));
export const POST = handler<P>(async (c) => createConsumerLabel(requireSession(c).user.id, c.params.orgId, c.params.lotId, await c.body()));
