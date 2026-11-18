import { handler, requireSession } from '@/server/http/route';
import { listCashOps, registerCashOp } from '@/server/ops/money';

type P = { orgId: string };
/** Наличные открытой смены: операции и ожидаемый остаток. */
export const GET = handler<P>(async (c) => listCashOps(requireSession(c).user.id, c.params.orgId, c.req.nextUrl.searchParams.get('siteId') || ''));
/** Внесение, выемка, инкассация. */
export const POST = handler<P>(async (c) => registerCashOp(requireSession(c).user.id, c.params.orgId, await c.body()));
