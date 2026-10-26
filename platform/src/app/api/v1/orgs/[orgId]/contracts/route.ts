import { handler, requireSession } from '@/server/http/route';
import { listContracts, createContract } from '@/server/ops/contracts';

type P = { orgId: string };

export const GET = handler<P>(async (c) => listContracts(requireSession(c).user.id, c.params.orgId, c.req.nextUrl.searchParams.get('siteId') || undefined));
export const POST = handler<P>(async (c) => createContract(requireSession(c).user.id, c.params.orgId, await c.body()));
